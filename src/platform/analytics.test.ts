import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const PREFERENCE_KEY = 'vaqtpro.analytics.enabled'

function memoryStorage(initial: string | null = null) {
  let value = initial
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => { value = next }),
  }
}

function mockRuntime() {
  const script = {
    type: '', src: '', async: false, dataset: {} as Record<string, string>,
    setAttribute: vi.fn(), remove: vi.fn(),
  }
  const page = {
    querySelector: vi.fn(() => null),
    createElement: vi.fn(() => script),
    head: { append: vi.fn() },
  }
  const handlers = new Map<string, (event: Event) => void>()
  const target = {
    location: { protocol: 'https:', hostname: 'vaqt.pro', reload: vi.fn() },
    addEventListener: vi.fn((type: string, handler: (event: Event) => void) => handlers.set(type, handler)),
  }
  return { script, page, target, handlers }
}

describe('Cloudflare Web Analytics preference and bootstrap', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('BroadcastChannel', undefined)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('uses default ON, accepts only a stored boolean, and fails closed on invalid or unreadable storage', async () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    const analytics = await import('./analytics')
    expect(analytics.readAnalyticsPreference()).toEqual({ enabled: true, error: null })
    storage.getItem.mockReturnValue('true')
    expect(analytics.readAnalyticsPreference()).toEqual({ enabled: true, error: null })
    storage.getItem.mockReturnValue('false')
    expect(analytics.readAnalyticsPreference()).toEqual({ enabled: false, error: null })
    storage.getItem.mockReturnValue('yes')
    expect(analytics.readAnalyticsPreference()).toEqual({ enabled: false, error: 'read' })
    storage.getItem.mockImplementation(() => { throw new Error('storage denied') })
    expect(analytics.readAnalyticsPreference()).toEqual({ enabled: false, error: 'read' })
    expect(analytics.readAnalyticsPreference(null)).toEqual({ enabled: false, error: 'read' })
  })

  it('automatically loads one official beacon on a normal production build when preference is unset', async () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    const analytics = await import('./analytics')
    const runtime = mockRuntime()
    analytics.initializeCloudflareAnalytics({ window: runtime.target as unknown as Window, document: runtime.page as unknown as Document,
      productionBuild: true, siteToken: 'public-token' })
    expect(runtime.page.createElement).toHaveBeenCalledOnce()
    expect(runtime.script.src).toBe('https://static.cloudflareinsights.com/beacon.min.js')
    expect(runtime.script.type).toBe('module')
    expect(runtime.script.setAttribute).toHaveBeenCalledWith('data-cf-beacon', JSON.stringify({ token: 'public-token', spa: false }))
    expect(runtime.page.head.append).toHaveBeenCalledWith(runtime.script)
    analytics.initializeCloudflareAnalytics({ window: runtime.target as unknown as Window, document: runtime.page as unknown as Document,
      productionBuild: true, siteToken: 'public-token' })
    expect(runtime.page.createElement).toHaveBeenCalledOnce()
  })

  it.each([
    ['explicit opt-out', 'false'],
    ['corrupted preference', 'enabled'],
  ])('does not insert the beacon for %s before React starts', async (_label, storedValue) => {
    vi.stubGlobal('localStorage', memoryStorage(storedValue))
    const analytics = await import('./analytics')
    const runtime = mockRuntime()
    analytics.initializeCloudflareAnalytics({ window: runtime.target as unknown as Window, document: runtime.page as unknown as Document,
      productionBuild: true, siteToken: 'public-token' })
    expect(runtime.page.createElement).not.toHaveBeenCalled()
    if (storedValue === 'enabled') expect(analytics.getAnalyticsPreferenceSnapshot()).toEqual({ enabled: false, error: 'read' })
  })

  it.each([
    ['development build', { productionBuild: false }],
    ['non-HTTPS origin', { protocol: 'http:' }],
    ['other hostname', { hostname: 'vaqtpro.github.io' }],
    ['opt-out', { enabled: false }],
    ['corrupt preference', { preferenceError: true }],
    ['missing token', { siteToken: '' }],
  ])('rejects analytics initialization for %s', async (_label, override) => {
    const analytics = await import('./analytics')
    const allowed = { productionBuild: true, protocol: 'https:', hostname: 'vaqt.pro', enabled: true,
      preferenceError: false, siteToken: 'public-token' }
    expect(analytics.canLoadCloudflareAnalytics({ ...allowed, ...override })).toBe(false)
  })

  it('persists OFF and ON before requesting a full reload', async () => {
    const storage = memoryStorage()
    const runtime = mockRuntime()
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('window', runtime.target)
    const analytics = await import('./analytics')
    expect(analytics.saveAnalyticsPreference(false)).toBe(true)
    expect(storage.setItem).toHaveBeenLastCalledWith(PREFERENCE_KEY, 'false')
    expect(analytics.getAnalyticsPreferenceSnapshot()).toEqual({ enabled: false, error: null })
    expect(runtime.target.location.reload).toHaveBeenCalledOnce()
    expect(analytics.saveAnalyticsPreference(true)).toBe(true)
    expect(storage.setItem).toHaveBeenLastCalledWith(PREFERENCE_KEY, 'true')
  })

  it('keeps the actual ON state visible and does not reload when saving OFF fails', async () => {
    const storage = memoryStorage('true')
    storage.setItem.mockImplementation(() => { throw new Error('quota exceeded') })
    vi.stubGlobal('localStorage', storage)
    const runtime = mockRuntime()
    vi.stubGlobal('window', runtime.target)
    const analytics = await import('./analytics')
    analytics.initializeCloudflareAnalytics({ window: runtime.target as unknown as Window, document: runtime.page as unknown as Document,
      productionBuild: true, siteToken: 'public-token' })
    expect(analytics.saveAnalyticsPreference(false)).toBe(false)
    expect(analytics.getAnalyticsPreferenceSnapshot()).toEqual({ enabled: true, error: 'write' })
    expect(runtime.page.head.append).toHaveBeenCalledOnce()
    expect(runtime.script.remove).not.toHaveBeenCalled()
    expect(runtime.target.location.reload).not.toHaveBeenCalled()
  })

  it('keeps analytics OFF when saving ON fails', async () => {
    const storage = memoryStorage('false')
    vi.stubGlobal('localStorage', storage)
    const runtime = mockRuntime()
    vi.stubGlobal('window', runtime.target)
    const analytics = await import('./analytics')
    analytics.initializeCloudflareAnalytics({ window: runtime.target as unknown as Window, document: runtime.page as unknown as Document,
      productionBuild: true, siteToken: 'public-token' })
    storage.setItem.mockImplementation(() => { throw new Error('quota exceeded') })

    expect(analytics.saveAnalyticsPreference(true)).toBe(false)
    expect(analytics.getAnalyticsPreferenceSnapshot()).toEqual({ enabled: false, error: 'write' })
    expect(runtime.target.location.reload).not.toHaveBeenCalled()
    expect(runtime.page.head.append).not.toHaveBeenCalled()
  })

  it('keeps read failure fail-closed and retries preference synchronization on BFCache restore', async () => {
    const storage = memoryStorage('true')
    vi.stubGlobal('localStorage', storage)
    const channels: { closed: boolean; handlers: Map<string, (event: MessageEvent) => void> }[] = []
    class FakeBroadcastChannel {
      readonly handlers = new Map<string, (event: MessageEvent) => void>()
      closed = false
      constructor() { channels.push(this) }
      addEventListener(type: string, handler: (event: MessageEvent) => void) { this.handlers.set(type, handler) }
      postMessage() {}
      close() { this.closed = true }
    }
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    const runtime = mockRuntime()
    const analytics = await import('./analytics')
    analytics.initializeCloudflareAnalytics({ window: runtime.target as unknown as Window, document: runtime.page as unknown as Document,
      productionBuild: true, siteToken: 'public-token' })
    expect(runtime.page.head.append).toHaveBeenCalledOnce()

    runtime.handlers.get('pagehide')?.(new PageTransitionEvent('pagehide', { persisted: true }))
    expect(channels[0]?.closed).toBe(true)
    storage.getItem.mockReturnValue('false')
    runtime.handlers.get('pageshow')?.(new PageTransitionEvent('pageshow', { persisted: true }))
    expect(channels).toHaveLength(2)
    expect(analytics.getAnalyticsPreferenceSnapshot()).toEqual({ enabled: false, error: null })
    expect(runtime.target.location.reload).toHaveBeenCalledOnce()

    vi.resetModules()
    storage.getItem.mockImplementation(() => { throw new Error('storage denied') })
    const reloadedAnalytics = await import('./analytics')
    const failedRuntime = mockRuntime()
    reloadedAnalytics.initializeCloudflareAnalytics({ window: failedRuntime.target as unknown as Window, document: failedRuntime.page as unknown as Document,
      productionBuild: true, siteToken: 'public-token' })
    expect(reloadedAnalytics.getAnalyticsPreferenceSnapshot()).toEqual({ enabled: false, error: 'read' })
    expect(failedRuntime.page.head.append).not.toHaveBeenCalled()
  })

  it('persists OFF and reloads after a failed write is retried successfully', async () => {
    const storage = memoryStorage('true')
    const writePreference = storage.setItem.getMockImplementation()
    storage.setItem.mockImplementation(() => { throw new Error('quota exceeded') })
    vi.stubGlobal('localStorage', storage)
    const runtime = mockRuntime()
    vi.stubGlobal('window', runtime.target)
    const analytics = await import('./analytics')

    expect(analytics.saveAnalyticsPreference(false)).toBe(false)
    expect(analytics.getAnalyticsPreferenceSnapshot()).toEqual({ enabled: true, error: 'write' })
    storage.setItem.mockImplementation(writePreference ?? (() => undefined))

    expect(analytics.saveAnalyticsPreference(false)).toBe(true)
    expect(storage.getItem()).toBe('false')
    expect(analytics.getAnalyticsPreferenceSnapshot()).toEqual({ enabled: false, error: null })
    expect(runtime.target.location.reload).toHaveBeenCalledOnce()
  })

  it('reloads an open tab when another tab broadcasts a changed preference', async () => {
    const storage = memoryStorage('true')
    vi.stubGlobal('localStorage', storage)
    const handlers: Record<string, (event: MessageEvent) => void> = {}
    class FakeBroadcastChannel {
      addEventListener(type: string, handler: (event: MessageEvent) => void) { handlers[type] = handler }
      postMessage() {}
      close() {}
    }
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    const runtime = mockRuntime()
    const analytics = await import('./analytics')
    analytics.initializeCloudflareAnalytics({ window: runtime.target as unknown as Window, document: runtime.page as unknown as Document,
      productionBuild: true, siteToken: 'public-token' })
    const onMessage = handlers.message
    expect(onMessage).toBeDefined()
    storage.getItem.mockReturnValue('false')
    onMessage?.(new MessageEvent('message', { data: { type: 'preference-changed', enabled: false } }))
    expect(runtime.target.location.reload).toHaveBeenCalledOnce()
    expect(analytics.getAnalyticsPreferenceSnapshot()).toEqual({ enabled: false, error: null })
    expect(runtime.page.createElement).toHaveBeenCalledOnce()
  })

  it('reloads an open tab on a cross-tab storage update and reads the persisted value', async () => {
    const storage = memoryStorage('true')
    vi.stubGlobal('localStorage', storage)
    const runtime = mockRuntime()
    const analytics = await import('./analytics')
    analytics.initializeCloudflareAnalytics({ window: runtime.target as unknown as Window, document: runtime.page as unknown as Document,
      productionBuild: true, siteToken: 'public-token' })
    const onStorage = runtime.handlers.get('storage')
    storage.getItem.mockReturnValue('false')
    onStorage?.(new StorageEvent('storage', { key: PREFERENCE_KEY, oldValue: 'true', newValue: 'false' }))
    expect(runtime.target.location.reload).toHaveBeenCalledOnce()
    expect(analytics.getAnalyticsPreferenceSnapshot()).toEqual({ enabled: false, error: null })
  })
})
