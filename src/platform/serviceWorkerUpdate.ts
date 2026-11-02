const RELOAD_TIMESTAMP_KEY = 'salah:service-worker-reload-at'
const DEFAULT_GUARD_WINDOW_MS = 10_000

type ReloadTimestampStorage = Pick<Storage, 'getItem' | 'setItem'>

export interface ServiceWorkerReloadMemory {
  lastReloadAt?: number
}

interface ServiceWorkerReloadGuardOptions {
  reload?: () => void
  now?: () => number
  storage?: ReloadTimestampStorage
  memory?: ServiceWorkerReloadMemory
  guardWindowMs?: number
}

const pageMemory: ServiceWorkerReloadMemory = {}
let activeReloadDeferrals = 0
const deferredReloadCallbacks = new Set<() => void>()

/**
 * Keep auto-updates from reloading the application while the monthly export
 * screen is open. The pending update is applied when the screen is left.
 */
export function deferServiceWorkerReload(): () => void {
  activeReloadDeferrals += 1
  let released = false
  return () => {
    if (released) return
    released = true
    activeReloadDeferrals -= 1
    if (activeReloadDeferrals !== 0) return
    const callbacks = [...deferredReloadCallbacks]
    deferredReloadCallbacks.clear()
    for (const callback of callbacks) callback()
  }
}

function defaultStorage(): ReloadTimestampStorage | undefined {
  try {
    return globalThis.sessionStorage
  } catch {
    return undefined
  }
}

function readTimestamp(
  storage: ReloadTimestampStorage | undefined,
): number | undefined {
  try {
    const value = storage?.getItem(RELOAD_TIMESTAMP_KEY)
    if (value === null || value === undefined) return undefined
    const timestamp = Number(value)
    return Number.isFinite(timestamp) ? timestamp : undefined
  } catch {
    return undefined
  }
}

function writeTimestamp(
  storage: ReloadTimestampStorage | undefined,
  timestamp: number,
): void {
  try {
    storage?.setItem(RELOAD_TIMESTAMP_KEY, String(timestamp))
  } catch {
    // In-memory защита остаётся активной, даже если storage запрещён браузером.
  }
}

function isWithinWindow(
  timestamp: number | undefined,
  now: number,
  guardWindowMs: number,
): boolean {
  return timestamp !== undefined
    && timestamp <= now
    && now - timestamp < guardWindowMs
}

export function createServiceWorkerReloadGuard(
  options: ServiceWorkerReloadGuardOptions = {},
): () => void {
  const reload = options.reload ?? (() => globalThis.location.reload())
  const now = options.now ?? Date.now
  const storage = options.storage ?? defaultStorage()
  const memory = options.memory ?? pageMemory
  const guardWindowMs = options.guardWindowMs ?? DEFAULT_GUARD_WINDOW_MS

  const requestReload = () => {
    if (activeReloadDeferrals > 0) {
      deferredReloadCallbacks.add(requestReload)
      return
    }
    const timestamp = now()
    if (isWithinWindow(memory.lastReloadAt, timestamp, guardWindowMs)) return

    const storedTimestamp = readTimestamp(storage)
    if (
      storedTimestamp !== undefined
      && isWithinWindow(storedTimestamp, timestamp, guardWindowMs)
    ) {
      memory.lastReloadAt = storedTimestamp
      return
    }

    memory.lastReloadAt = timestamp
    writeTimestamp(storage, timestamp)
    reload()
  }
}
