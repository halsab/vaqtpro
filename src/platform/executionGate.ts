const LOCK_NAME = 'salah-foreground-execution-v1'
const CHANNEL_NAME = 'salah-execution-gate-v1'
const LOCK_ACQUISITION_TIMEOUT_MS = 10_000
const QUIESCENCE_TIMEOUT_MS = 10_000
let quiescence: () => Promise<void> = async () => {}

export function setExecutionQuiescence(operation: Promise<unknown> | (() => Promise<unknown>)) {
  quiescence = typeof operation === 'function'
    ? () => operation().then(() => undefined)
    : () => operation.then(() => undefined)
}

export function waitForExecutionQuiescence() { return quiescence() }

function withDeadline<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs)
    operation.then(value => { window.clearTimeout(timer); resolve(value) }, (error: unknown) => {
      window.clearTimeout(timer)
      reject(error instanceof Error ? error : new Error(String(error)))
    })
  })
}

function createEphemeralId(): string | null {
  try {
    return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : null
  } catch { return null }
}

type Message =
  | { version: 1; type: 'probe'; requestId: string; requesterId: string }
  | { version: 1; type: 'owner'; requestId: string; ownerId: string }
  | { version: 1; type: 'takeover'; requestId: string; requesterId: string; targetOwnerId: string }
  | { version: 1; type: 'refused'; requestId: string; ownerId: string }

export type ExecutionGate = {
  supported: boolean
  hasError: () => boolean
  start: () => Promise<boolean>
  requestOwnership: () => Promise<boolean>
  close: () => void
  relinquish: () => Promise<void>
  onTakeover: (callback: () => Promise<void>) => void
}

export function createExecutionGate(): ExecutionGate {
  let coordinationError = false
  let coordinationFailureGeneration = 0
  const markCoordinationError = () => { coordinationError = true; coordinationFailureGeneration += 1 }
  let locks: LockManager | undefined
  try { locks = (navigator as Omit<Navigator, 'locks'> & { locks?: LockManager }).locks }
  catch { markCoordinationError() }
  let channel: BroadcastChannel | null = null
  try {
    if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(CHANNEL_NAME)
  } catch {
    // Без канала вкладка не может безопасно запросить явную передачу.
  }

  const contextId = createEphemeralId()
  if (!contextId) markCoordinationError()
  let stopped = false
  let suspended = false
  let held = false
  let serving = false
  let releaseLock: (() => void) | null = null
  let lockOwner: symbol | null = null
  let lockTask: Promise<void> | null = null
  let acquisition: Promise<{ acquired: boolean; owner?: symbol }> | null = null
  let acquisitionGeneration = 0
  let request: Promise<boolean> | null = null
  let takeover: Promise<void> | null = null
  let takeoverRequestId: string | null = null
  let closing = false
  let deactivate: () => Promise<void> = waitForExecutionQuiescence
  let cancelRequest: (() => void) | null = null
  let activeRequestId: string | null = null
  let targetOwnerId: string | null = null
  let refusedRequestId: string | null = null
  const isHeld = () => held
  const isStopped = () => stopped
  const isSuspended = () => suspended
  const shouldClose = () => closing

  const release = (owner: symbol | null = lockOwner) => {
    if (!owner || lockOwner !== owner) return
    serving = false
    releaseLock?.()
  }

  const acquire = (isCurrent: () => boolean = () => !stopped): Promise<{ acquired: boolean; owner?: symbol }> => {
    if (stopped || !locks || !channel || !contextId) return Promise.resolve({ acquired: false })
    if (held) return Promise.resolve(lockOwner ? { acquired: serving, owner: lockOwner } : { acquired: serving })
    if (acquisition) return acquisition

    let finish!: (acquired: { acquired: boolean; owner?: symbol }) => void
    const result = new Promise<{ acquired: boolean; owner?: symbol }>(resolve => { finish = resolve })
    acquisition = result
    const generation = ++acquisitionGeneration
    let settled = false
    const settle = (value: { acquired: boolean; owner?: symbol }) => {
      if (settled) return
      settled = true
      window.clearTimeout(acquisitionTimer)
      if (acquisition === result) acquisition = null
      finish(value)
    }
    const acquisitionTimer = window.setTimeout(() => {
      markCoordinationError()
      settle({ acquired: false })
    }, LOCK_ACQUISITION_TIMEOUT_MS)

    try {
      const task = locks.request(LOCK_NAME, { mode: 'exclusive', ifAvailable: true }, async lock => {
        if (settled || !lock || stopped || !isCurrent()) {
          settle({ acquired: false })
          return
        }

        let releaseHeld!: () => void
        const heldLock = new Promise<void>(resolve => { releaseHeld = resolve })
        const owner = Symbol('execution-lock-owner')
        held = true
        lockOwner = owner
        releaseLock = releaseHeld
        settle({ acquired: true, owner })
        await heldLock
        if (lockOwner === owner) {
          held = false
          lockOwner = null
          releaseLock = null
        }
      })
      lockTask = task.then(() => undefined, () => {
        if (generation !== acquisitionGeneration || acquisition !== result || settled) return
        markCoordinationError()
        settle({ acquired: false })
      })
    } catch {
      markCoordinationError()
      settle({ acquired: false })
    }
    return result
  }

  const finishRequester = (resolve: (value: boolean) => void, value: boolean, timers: number[]) => {
    if (cancelRequest) cancelRequest = null
    for (const timer of timers) {
      window.clearInterval(timer)
      window.clearTimeout(timer)
    }
    resolve(value)
  }

  if (channel) channel.onmessage = event => {
    const message = event.data as Partial<Message> | null
    if (!message || message.version !== 1 || stopped || !contextId) return

    if (message.type === 'probe' && typeof message.requestId === 'string'
      && typeof message.requesterId === 'string' && held) {
      channel.postMessage({ version: 1, type: 'owner', requestId: message.requestId, ownerId: contextId } satisfies Message)
      return
    }

    if (message.type === 'owner' && typeof message.requestId === 'string'
      && typeof message.ownerId === 'string' && message.requestId === activeRequestId) {
      targetOwnerId = message.ownerId
      if (targetOwnerId !== contextId) {
        channel.postMessage({ version: 1, type: 'takeover', requestId: message.requestId,
          requesterId: contextId, targetOwnerId } satisfies Message)
      }
      return
    }

    if (message.type === 'takeover' && typeof message.requestId === 'string'
      && typeof message.requesterId === 'string' && message.targetOwnerId === contextId) {
      if (takeover) {
        if (takeoverRequestId !== message.requestId) {
          channel.postMessage({ version: 1, type: 'refused', requestId: message.requestId, ownerId: contextId } satisfies Message)
        }
        return
      }
      if (!held || closing) {
        channel.postMessage({ version: 1, type: 'refused', requestId: message.requestId, ownerId: contextId } satisfies Message)
        return
      }
      const requestId = message.requestId
      takeoverRequestId = requestId
      serving = false
      takeover = (async () => {
        try {
          await withDeadline(deactivate(), QUIESCENCE_TIMEOUT_MS, 'Execution quiescence timed out')
          if (!isHeld()) return
          release()
          if (shouldClose()) { stopped = true; channel.close() }
        } catch {
          closing = false
          markCoordinationError()
          channel.postMessage({ version: 1, type: 'refused', requestId, ownerId: contextId } satisfies Message)
        }
      })().finally(() => { takeover = null; takeoverRequestId = null })
      return
    }

    if (message.type === 'refused' && typeof message.requestId === 'string'
      && message.requestId === activeRequestId) refusedRequestId = message.requestId
  }

  return {
    supported: Boolean(locks && channel && contextId),
    hasError: () => coordinationError,
    start: async () => {
      if (suspended) return false
      if (held) return serving
      const acquired = await acquire(() => !stopped && !isSuspended())
      if (!acquired.acquired || stopped || isSuspended()) return false
      coordinationError = false
      serving = true
      return true
    },
    requestOwnership: () => {
      if (request) return request
      if (stopped || !locks || !channel || !contextId) return Promise.resolve(false)
      suspended = false
      if (held && !serving) {
        const recovery = (async () => {
          try {
            await withDeadline(deactivate(), QUIESCENCE_TIMEOUT_MS, 'Execution quiescence timed out')
            if (isStopped() || isSuspended()) return false
            release()
            await withDeadline(lockTask ?? Promise.resolve(), QUIESCENCE_TIMEOUT_MS, 'Execution lock release timed out')
            const acquired = await acquire(() => !isStopped() && !isSuspended())
            if (acquired.acquired && isHeld() && !isStopped() && !isSuspended()) {
              coordinationError = false
              serving = true
              return true
            }
          } catch {
            // Ошибка quiescence оставляет lock у текущего контекста до успешного повтора.
            markCoordinationError()
          }
          return false
        })()
        request = recovery.finally(() => { request = null })
        return request
      }

      const uniqueRequestId = createEphemeralId()
      if (!uniqueRequestId) {
        markCoordinationError()
        return Promise.resolve(false)
      }

      let resolveRequest!: (value: boolean) => void
      const currentRequest = new Promise<boolean>(resolve => { resolveRequest = resolve })
      request = currentRequest
      const requestId = `${contextId}:${uniqueRequestId}`
      const failureGenerationAtStart = coordinationFailureGeneration
      activeRequestId = requestId
      targetOwnerId = null
      refusedRequestId = null
      let completed = false
      const isRequestActive = () => !completed && !stopped && !isSuspended()
      const timers: number[] = []
      const finish = (value: boolean) => {
        if (completed) return
        completed = true
        finishRequester(resolveRequest, value, timers)
        if (request === currentRequest) request = null
        if (activeRequestId === requestId) activeRequestId = null
        targetOwnerId = null
        refusedRequestId = null
      }
      cancelRequest = () => finish(false)

      const attempt = async () => {
        if (!isRequestActive()) return
        const acquired = await acquire(isRequestActive)
        if (!isRequestActive()) {
          if (acquired.acquired && !serving) release(acquired.owner ?? null)
          return
        }
        if (acquired.acquired && held) {
          coordinationError = false
          serving = true
          finish(true)
          return
        }
        if (coordinationFailureGeneration !== failureGenerationAtStart) {
          finish(false)
          return
        }
        if (refusedRequestId === requestId) {
          finish(false)
          return
        }
        if (!targetOwnerId) {
          channel.postMessage({ version: 1, type: 'probe', requestId, requesterId: contextId } satisfies Message)
        } else {
          channel.postMessage({ version: 1, type: 'takeover', requestId, requesterId: contextId,
            targetOwnerId } satisfies Message)
        }
      }

      void attempt()
      timers.push(window.setInterval(() => { void attempt() }, 250))
      timers.push(window.setTimeout(() => finish(false), 15_000))
      return currentRequest
    },
    close: () => {
      if (stopped) return
      cancelRequest?.()
      closing = true
      if (held && !takeover) {
        serving = false
        void deactivate().then(() => {
          release()
          stopped = true
          channel?.close()
        }).catch(() => { closing = false })
      } else if (!held) {
        release()
        stopped = true
        channel?.close()
      }
    },
    relinquish: async () => {
      suspended = true
      cancelRequest?.()
      if (!held) return
      serving = false
      try {
        await withDeadline(deactivate(), QUIESCENCE_TIMEOUT_MS, 'Execution quiescence timed out')
        release()
        await withDeadline(lockTask ?? Promise.resolve(), QUIESCENCE_TIMEOUT_MS, 'Execution lock release timed out')
        channel?.close()
        coordinationError = false
      } catch (error) {
        markCoordinationError()
        throw error
      }
    },
    onTakeover: callback => { deactivate = callback },
  }
}
