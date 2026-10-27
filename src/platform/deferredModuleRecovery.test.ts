import { describe, expect, it } from 'vitest'
import { cleanDeferredModuleReloadUrl, deferredModuleReloadUrl, deferredModuleRetryUrl } from './deferredModuleRecovery'

describe('deferred module recovery URL', () => {
  it('forces a fresh document while preserving the current route and query', () => {
    const recovered = new URL(deferredModuleReloadUrl('https://vaqt.pro/?place=local#settings'))
    expect(recovered.pathname).toBe('/')
    expect(recovered.searchParams.get('place')).toBe('local')
    expect(recovered.searchParams.get('__deferred_module_reload')).toBeTruthy()
    expect(recovered.hash).toBe('#settings')
  })

  it('removes the one-use recovery marker before the app continues', () => {
    const recovered = deferredModuleReloadUrl('https://vaqt.pro/?place=local')
    const clean = new URL(cleanDeferredModuleReloadUrl(recovered))
    expect(clean.searchParams.get('place')).toBe('local')
    expect(clean.searchParams.has('__deferred_module_reload')).toBe(false)
  })

  it('creates a unique same-origin module URL to bypass a cached import error', () => {
    const failedAsset = 'https://vaqt.pro/assets/SecondaryScreens-DoT7soXa.js'
    const first = deferredModuleRetryUrl('SecondaryScreens', 'https://vaqt.pro/', failedAsset)
    const second = deferredModuleRetryUrl('SecondaryScreens', 'https://vaqt.pro/', failedAsset)
    expect(first).not.toBeNull()
    expect(first).not.toBe(second)
    if (!first) throw new Error('Expected a same-origin retry URL')
    expect(new URL(first).pathname).toBe('/assets/SecondaryScreens-DoT7soXa.js')
    expect(deferredModuleRetryUrl('SecondaryScreens', 'https://vaqt.pro/', 'https://other.test/assets/SecondaryScreens-DoT7soXa.js')).toBeNull()
  })
})
