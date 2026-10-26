const PREFERENCE_KEY = 'vaqtpro.analytics.enabled'
const CHANNEL_NAME = 'vaqtpro-analytics-preference-v1'
const BEACON_URL = 'https://static.cloudflareinsights.com/beacon.min.js'
const SITE_TOKEN = '15bf5313136244258ca53033e848e00a'

export interface AnalyticsPreferenceState {
  enabled: boolean
  error: 'read' | 'write' | null
}

type AnalyticsRuntime = {
  window: Window
  document: Document
  productionBuild: boolean
  siteToken: string
}

const listeners = new Set<() => void>()
let state: AnalyticsPreferenceState = { enabled: true, error: null }
let initialized = false
let reloadRequested = false
let channel: BroadcastChannel | null = null

function publish(next: AnalyticsPreferenceState) {
  state = next
  for (const listener of listeners) listener()
}

function browserStorage(): Storage | null {
  try { return globalThis.localStorage }
  catch { return null }
}

export function readAnalyticsPreference(storage: Pick<Storage, 'getItem'> | null = browserStorage()): AnalyticsPreferenceState {
  if (!storage) return { enabled: false, error: 'read' }
  try {
    const value = storage.getItem(PREFERENCE_KEY)
    if (value === null || value === 'true') return { enabled: true, error: null }
    if (value === 'false') return { enabled: false, error: null }
    return { enabled: false, error: 'read' }
  } catch {
    return { enabled: false, error: 'read' }
  }
}

export function canLoadCloudflareAnalytics(input: {
  productionBuild: boolean
  protocol: string
  hostname: string
  enabled: boolean
  preferenceError: boolean
  siteToken: string
}): boolean {
  return input.productionBuild && input.protocol === 'https:' && input.hostname === 'vaqt.pro'
    && input.enabled && !input.preferenceError && input.siteToken.length > 0
}

function getRuntime(): AnalyticsRuntime | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null
  return { window, document, productionBuild: import.meta.env.PROD, siteToken: SITE_TOKEN }
}

function requestReload(target: Window) {
  if (reloadRequested) return
  reloadRequested = true
  target.location.reload()
}

function reloadForChangedPreference(target: Window) {
  const fresh = readAnalyticsPreference()
  const changed = fresh.enabled !== state.enabled || fresh.error !== state.error
  publish(fresh)
  if (changed) requestReload(target)
}

export function initializeCloudflareAnalytics(runtime: AnalyticsRuntime | null = getRuntime()): void {
  if (initialized || !runtime) return
  initialized = true
  const { window: target, document: page, productionBuild, siteToken } = runtime
  const initial = readAnalyticsPreference()
  publish(initial)

  target.addEventListener('storage', event => {
    if (event.key === PREFERENCE_KEY || event.key === null) reloadForChangedPreference(target)
  })

  const openChannel = () => {
    if (channel || typeof BroadcastChannel === 'undefined') return
    try {
      channel = new BroadcastChannel(CHANNEL_NAME)
      channel.addEventListener('message', (event: MessageEvent<unknown>) => {
        if (typeof event.data === 'object' && event.data !== null && 'type' in event.data
          && event.data.type === 'preference-changed') reloadForChangedPreference(target)
      })
    } catch { channel = null }
  }
  const closeChannel = () => { channel?.close(); channel = null }
  target.addEventListener('pagehide', closeChannel)
  target.addEventListener('pageshow', (event: Event) => {
    openChannel()
    if ((event as PageTransitionEvent).persisted) reloadForChangedPreference(target)
  })
  openChannel()

  if (!canLoadCloudflareAnalytics({ productionBuild, protocol: target.location.protocol,
    hostname: target.location.hostname, enabled: initial.enabled, preferenceError: initial.error !== null, siteToken })) return
  if (page.querySelector('script[data-vaqtpro-cloudflare-analytics]')) return

  const script = page.createElement('script')
  script.type = 'module'
  script.src = BEACON_URL
  script.async = true
  script.dataset.vaqtproCloudflareAnalytics = 'true'
  script.setAttribute('data-cf-beacon', JSON.stringify({ token: siteToken, spa: false }))
  page.head.append(script)
}

export function getAnalyticsPreferenceSnapshot(): AnalyticsPreferenceState {
  return state
}

export function subscribeToAnalyticsPreference(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function saveAnalyticsPreference(enabled: boolean): boolean {
  const storage = browserStorage()
  if (!storage) {
    publish({ enabled: state.enabled, error: 'write' })
    return false
  }

  try {
    storage.setItem(PREFERENCE_KEY, String(enabled))
  } catch {
    publish({ enabled: state.enabled, error: 'write' })
    return false
  }

  publish({ enabled, error: null })
  try { channel?.postMessage({ type: 'preference-changed', enabled }) } catch { /* Перезагрузка текущей вкладки сохраняет выбранное значение. */ }
  if (typeof window !== 'undefined') requestReload(window)
  return true
}

export function isCloudflareAnalyticsAvailableHere(): boolean {
  const runtime = getRuntime()
  return Boolean(runtime && runtime.productionBuild && runtime.siteToken.length > 0
    && runtime.window.location.protocol === 'https:' && runtime.window.location.hostname === 'vaqt.pro')
}
