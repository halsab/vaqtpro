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






  it('recovers from a prior lock API error and completes a safe ownership handoff', async () => {
    const locks = setup()
    const owner = createExecutionGate()
    expect(await owner.start()).toBe(true)

    const request = locks.request.bind(locks)
    let failOnce = true
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: (_name: string, _options: LockOptions, callback: (lock: Lock | null) => Promise<void>) => {
        if (failOnce) {
          failOnce = false
          return Promise.reject(new Error('transient lock acquisition error'))
        }
        return request(_name, _options, callback)
      },
    } })
    const requester = createExecutionGate()
    expect(await requester.requestOwnership()).toBe(false)
    expect(requester.hasError()).toBe(true)

    expect(await requester.requestOwnership()).toBe(true)
    expect(requester.hasError()).toBe(false)
    expect(locks.held).toBe(true)
    await requester.relinquish()
    owner.close()
  })


  it('ignores a late rejection from a timed-out acquisition after a retry owns the lock', async () => {
    const locks = setup()
    const owner = createExecutionGate()
    expect(await owner.start()).toBe(true)
    const request = locks.request.bind(locks)
    let rejectObsolete!: (error: Error) => void
    let delayNext = true
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: (name: string, options: LockOptions, callback: (lock: Lock | null) => Promise<void>) => {
        if (delayNext) {
          delayNext = false
          return new Promise<void>((_resolve, reject) => { rejectObsolete = reject })
        }
        return request(name, options, callback)
      },
    } })
    const gate = createExecutionGate()
    vi.useFakeTimers()
    try {
      const timedOut = gate.requestOwnership()
      await vi.advanceTimersByTimeAsync(10_000)
      await expect(timedOut).resolves.toBe(false)
      expect(gate.hasError()).toBe(true)

      const retry = gate.requestOwnership()
      await vi.advanceTimersByTimeAsync(1_000)
      await expect(retry).resolves.toBe(true)
      expect(gate.hasError()).toBe(false)
      rejectObsolete(new Error('obsolete acquisition rejected late'))
      await Promise.resolve()
      await Promise.resolve()

      expect(gate.hasError()).toBe(false)
      expect(locks.held).toBe(true)
    } finally {
      vi.useRealTimers()
    }
    await gate.relinquish()
    expect(locks.held).toBe(false)
    owner.close()
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
