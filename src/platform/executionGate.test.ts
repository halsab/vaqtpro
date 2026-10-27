import { afterEach, describe, expect, it, vi } from 'vitest'
import { createExecutionGate, setExecutionQuiescence } from './executionGate'

class FakeLockManager {
  held = false
  requests = 0

  async request(_name: string, _options: LockOptions, callback: (lock: Lock | null) => Promise<void>) {
    this.requests += 1
    if (this.held) return callback(null)
    this.held = true
    const lock = { name: 'test-lock', mode: 'exclusive', pending: false } as Lock
    try { await callback(lock) }
    finally { this.held = false }
  }
}

class FakeBroadcastChannel {
  static channels = new Set<FakeBroadcastChannel>()
  onmessage: ((event: MessageEvent) => void) | null = null
  closed = false
  constructor(readonly name: string) { FakeBroadcastChannel.channels.add(this) }
  postMessage(data: unknown) {
    for (const channel of FakeBroadcastChannel.channels) {
      if (channel !== this && channel.name === this.name && !channel.closed) {
        queueMicrotask(() => channel.onmessage?.({ data } as MessageEvent))
      }
    }
  }
  close() { this.closed = true; FakeBroadcastChannel.channels.delete(this) }
}

function setup() {
  const locks = new FakeLockManager()
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
  Object.defineProperty(navigator, 'locks', { configurable: true, value: locks })
  return locks
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

afterEach(() => {
  FakeBroadcastChannel.channels.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  setExecutionQuiescence(Promise.resolve())
})

describe('execution gate', () => {
  it('fails closed when crypto cannot provide an ephemeral context ID', async () => {
    setup()
    vi.stubGlobal('crypto', {})
    const gate = createExecutionGate()

    expect(gate.supported).toBe(false)
    expect(await gate.start()).toBe(false)
    expect(gate.hasError()).toBe(true)
    expect(await gate.requestOwnership()).toBe(false)
  })

  it('does not treat missing coordination APIs as an available gate', async () => {
    vi.stubGlobal('BroadcastChannel', undefined)
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
    const gate = createExecutionGate()

    expect(gate.supported).toBe(false)
    expect(await gate.start()).toBe(false)
    expect(await gate.requestOwnership()).toBe(false)
  })

  it('bounds stalled initial lock acquisition and drops a late grant without owning it', async () => {
    setup()
    let grant!: (lock: Lock | null) => Promise<void>
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: (_name: string, _options: LockOptions, callback: (lock: Lock | null) => Promise<void>) => {
        grant = callback
        return new Promise<void>(() => {})
      },
    } })
    vi.useFakeTimers()
    try {
      const gate = createExecutionGate()
      const starting = gate.start()
      await vi.advanceTimersByTimeAsync(10_000)
      await expect(starting).resolves.toBe(false)
      expect(gate.hasError()).toBe(true)
      await grant({ name: 'test-lock', mode: 'exclusive', pending: false } as Lock)
      expect(gate.hasError()).toBe(true)
    } finally { vi.useRealTimers() }
  })

  it('keeps the lock when lifecycle quiescence exceeds its deadline', async () => {
    const locks = setup()
    const gate = createExecutionGate()
    const drain = deferred()
    gate.onTakeover(() => drain.promise)
    expect(await gate.start()).toBe(true)
    vi.useFakeTimers()
    try {
      const relinquishing = gate.relinquish()
      const timedOut = expect(relinquishing).rejects.toThrow('timed out')
      await vi.advanceTimersByTimeAsync(10_000)
      await timedOut
      expect(locks.held).toBe(true)
      drain.resolve()
      await Promise.resolve()
      expect(locks.held).toBe(true)
    } finally { vi.useRealTimers() }
  })

  it('settles ID generation failures without retaining a request and recovers on retry', async () => {
    setup()
    const randomUUID = vi.fn()
      .mockReturnValueOnce('context-id')
      .mockImplementationOnce(() => { throw new Error('temporary crypto failure') })
      .mockImplementationOnce(() => { throw new Error('temporary crypto failure') })
      .mockReturnValueOnce('request-id')
    vi.stubGlobal('crypto', { randomUUID })
    const gate = createExecutionGate()

    expect(gate.supported).toBe(true)
    await expect(gate.requestOwnership()).resolves.toBe(false)
    expect(gate.hasError()).toBe(true)
    await expect(gate.requestOwnership()).resolves.toBe(false)
    expect(randomUUID).toHaveBeenCalledTimes(3)

    await expect(gate.requestOwnership()).resolves.toBe(true)
    expect(randomUUID).toHaveBeenCalledTimes(4)
    expect(gate.hasError()).toBe(false)
    await gate.relinquish()
  })

  it('allows cancellation and disposal after request ID generation fails', async () => {
    const locks = setup()
    const randomUUID = vi.fn()
      .mockReturnValueOnce('cancelled-context')
      .mockImplementationOnce(() => { throw new Error('temporary crypto failure') })
      .mockReturnValueOnce('cancelled-request')
      .mockReturnValueOnce('disposed-context')
      .mockImplementationOnce(() => { throw new Error('temporary crypto failure') })
      .mockReturnValueOnce('next-owner-context')
    vi.stubGlobal('crypto', { randomUUID })
    const cancelled = createExecutionGate()
    await expect(cancelled.requestOwnership()).resolves.toBe(false)
    await expect(cancelled.relinquish()).resolves.toBeUndefined()
    expect(await cancelled.start()).toBe(false)
    await expect(cancelled.requestOwnership()).resolves.toBe(true)
    await cancelled.relinquish()

    const disposed = createExecutionGate()
    await expect(disposed.requestOwnership()).resolves.toBe(false)
    disposed.close()
    const nextOwner = createExecutionGate()
    expect(await nextOwner.start()).toBe(true)
    expect(locks.held).toBe(true)
    await nextOwner.relinquish()
  })

  it('keeps a delayed exclusive acquisition owned once despite overlapping polls', async () => {
    const lockManager = setup()
    const baseRequest = lockManager.request.bind(lockManager)
    let grant!: (lock: Lock | null) => Promise<void>
    let delayNext = false
    const request = vi.fn((_name: string, options: LockOptions, callback: (lock: Lock | null) => Promise<void>) => {
      if (!delayNext || lockManager.held) return baseRequest(_name, options, callback)
      delayNext = false
      return new Promise<void>(resolve => {
        grant = async lock => {
          lockManager.held = true
          try { await callback(lock) }
          finally { lockManager.held = false; resolve() }
        }
      })
    })
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } })
    const owner = createExecutionGate()
    const requester = createExecutionGate()
    expect(await owner.start()).toBe(true)

    delayNext = true
    const drain = deferred()
    owner.onTakeover(() => drain.promise)
    vi.useFakeTimers()
    try {
      const requestOwner = requester.requestOwnership()
      await vi.advanceTimersByTimeAsync(250)
      drain.resolve()
      await vi.advanceTimersByTimeAsync(250)
      expect(grant).toBeTypeOf('function')
      const acquisitionsBeforeOverlappingPolls = request.mock.calls.length
      await vi.advanceTimersByTimeAsync(750)
      expect(request.mock.calls.length).toBe(acquisitionsBeforeOverlappingPolls)

      void grant({ name: 'test-lock', mode: 'exclusive', pending: false } as Lock)
      expect(await requestOwner).toBe(true)
      expect(lockManager.held).toBe(true)
      const competitor = createExecutionGate()
      expect(await competitor.start()).toBe(false)

      await requester.relinquish()
      expect(lockManager.held).toBe(false)
      competitor.close()
      owner.close()
      requester.close()
    } finally { vi.useRealTimers() }
  })

  it('distinguishes a lock API failure from another active owner', async () => {
    setup()
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: vi.fn(() => Promise.reject(new Error('lock access denied'))),
    } })
    const gate = createExecutionGate()

    expect(await gate.start()).toBe(false)
    expect(gate.supported).toBe(true)
    expect(gate.hasError()).toBe(true)
    gate.close()
  })

  it('releases a lock granted after the gate was disposed', async () => {
    const locks = setup()
    let grant!: (lock: Lock | null) => Promise<void>
    let first = true
    const request = vi.fn((_name: string, options: LockOptions, callback: (lock: Lock | null) => Promise<void>) => {
      if (first) {
        first = false
        grant = callback
        return Promise.resolve()
      }
      return locks.request('test-lock', options, callback)
    })
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } })
    const gate = createExecutionGate()
    const started = gate.start()
    gate.close()

    await grant({ name: 'test-lock', mode: 'exclusive', pending: false } as Lock)

    expect(await started).toBe(false)
    const nextOwner = createExecutionGate()
    expect(await nextOwner.start()).toBe(true)
    nextOwner.close()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(locks.held).toBe(false)
  })

  it('does not accept a late initial acquisition after pagehide', async () => {
    const locks = setup()
    let grant!: (lock: Lock | null) => Promise<void>
    let first = true
    const request = vi.fn((_name: string, options: LockOptions, callback: (lock: Lock | null) => Promise<void>) => {
      if (first) {
        first = false
        grant = callback
        return Promise.resolve()
      }
      return locks.request('test-lock', options, callback)
    })
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } })
    const gate = createExecutionGate()
    const started = gate.start()
    await gate.relinquish()
    await grant({ name: 'test-lock', mode: 'exclusive', pending: false } as Lock)

    expect(await started).toBe(false)
    const nextOwner = createExecutionGate()
    expect(await nextOwner.start()).toBe(true)
    nextOwner.close()
  })

  it('does not keep a lock granted after a takeover request times out', async () => {
    const locks = setup()
    let lateGrant!: (lock: Lock | null) => Promise<void>
    let calls = 0
    const request = vi.fn((_name: string, options: LockOptions, callback: (lock: Lock | null) => Promise<void>) => {
      calls += 1
      if (calls === 1) return callback(null)
      if (calls === 2) { lateGrant = callback; return Promise.resolve() }
      return locks.request('test-lock', options, callback)
    })
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } })
    const gate = createExecutionGate()
    expect(await gate.start()).toBe(false)

    vi.useFakeTimers()
    try {
      const requestPromise = gate.requestOwnership()
      await vi.advanceTimersByTimeAsync(15_000)
      expect(await requestPromise).toBe(false)
      await lateGrant({ name: 'test-lock', mode: 'exclusive', pending: false } as Lock)
      const nextOwner = createExecutionGate()
      expect(await nextOwner.start()).toBe(true)
      nextOwner.close()
    } finally { vi.useRealTimers() }
  })

  it('transfers only after quiescence and keeps the lock when quiescence fails', async () => {
    const locks = setup()
    const owner = createExecutionGate()
    const requester = createExecutionGate()
    owner.onTakeover(() => Promise.reject(new Error('drain failed')))
    expect(await owner.start()).toBe(true)

    expect(await requester.requestOwnership()).toBe(false)
    expect(locks.held).toBe(true)
    expect(await createExecutionGate().start()).toBe(false)
  })

  it('marks quiescence failure as coordination error and allows a safe retry', async () => {
    setup()
    const owner = createExecutionGate()
    const requester = createExecutionGate()
    let fail = true
    owner.onTakeover(() => {
      if (fail) return Promise.reject(new Error('drain failed'))
      return Promise.resolve()
    })
    expect(await owner.start()).toBe(true)

    expect(await requester.requestOwnership()).toBe(false)
    expect(owner.hasError()).toBe(true)
    expect(await createExecutionGate().start()).toBe(false)

    fail = false
    expect(await requester.requestOwnership()).toBe(true)
    requester.close()
  })

  it('does not reject duplicate messages for the same slow takeover request', async () => {
    setup()
    const owner = createExecutionGate()
    const requester = createExecutionGate()
    const drain = deferred()
    owner.onTakeover(() => drain.promise)
    expect(await owner.start()).toBe(true)
    vi.useFakeTimers()
    try {
      const request = requester.requestOwnership()
      await vi.advanceTimersByTimeAsync(250)
      drain.resolve()
      await vi.advanceTimersByTimeAsync(250)
      expect(await request).toBe(true)
    } finally { vi.useRealTimers() }
  })

  it('ignores a takeover addressed to an owner that no longer holds the lock', async () => {
    setup()
    const oldOwner = createExecutionGate()
    const currentOwner = createExecutionGate()
    const requester = createExecutionGate()
    const deactivation = vi.fn(async () => {})
    const currentDeactivation = vi.fn(async () => {})
    oldOwner.onTakeover(deactivation)
    currentOwner.onTakeover(currentDeactivation)
    expect(await oldOwner.start()).toBe(true)
    await oldOwner.relinquish()
    deactivation.mockClear()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(await currentOwner.start()).toBe(true)

    const stale = new FakeBroadcastChannel('salah-execution-gate-v1')
    stale.postMessage({ version: 1, type: 'takeover', requestId: 'old-request', requesterId: 'old-tab', targetOwnerId: 'obsolete-owner' })
    await Promise.resolve()
    expect(deactivation).not.toHaveBeenCalled()
    expect(await requester.requestOwnership()).toBe(true)
    expect(deactivation).not.toHaveBeenCalled()
    expect(currentDeactivation).toHaveBeenCalledOnce()
    expect(await currentOwner.start()).toBe(false)
  })

  it('keeps a live retry path when disposal cannot quiesce the current owner', async () => {
    setup()
    const owner = createExecutionGate()
    const requester = createExecutionGate()
    owner.onTakeover(() => Promise.reject(new Error('drain failed')))
    expect(await owner.start()).toBe(true)

    owner.close()
    await new Promise(resolve => setTimeout(resolve, 0))
    owner.onTakeover(() => Promise.resolve())
    expect(await requester.requestOwnership()).toBe(true)
    requester.close()
  })

  it('keeps an actively held Web Lock until disposal quiescence completes', async () => {
    const locks = setup()
    const owner = createExecutionGate()
    const requester = createExecutionGate()
    const drain = deferred()
    owner.onTakeover(() => drain.promise)
    expect(await owner.start()).toBe(true)

    owner.close()
    const request = requester.requestOwnership()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(locks.held).toBe(true)
    expect(await createExecutionGate().start()).toBe(false)

    drain.resolve()
    expect(await request).toBe(true)
    expect(locks.held).toBe(true)
    requester.close()
  })
})
