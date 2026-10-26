import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_THEME_FAMILY } from '../domain/theme'
import { clearThemePreferenceCache, readThemePreferenceCache, themeFamilyFromCacheEvent, writeThemePreferenceCache } from './themePreferenceCache'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: key => { values.delete(key) },
    clear: () => values.clear(),
    key: index => [...values.keys()][index] ?? null,
    get length() { return values.size },
  }
}

describe('synchronous theme preference cache', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses seasonal when missing and restores only a supported versioned family', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    expect(readThemePreferenceCache()).toBe(DEFAULT_THEME_FAMILY)
    expect(writeThemePreferenceCache('seasonal')).toBe(true)
    expect(readThemePreferenceCache()).toBe('seasonal')
  })

  it.each(['{', '{"version":2,"themeFamily":"seasonal"}', '{"version":1,"themeFamily":"other"}'])('fails closed without mutating invalid cache %s', raw => {
    const storage = memoryStorage()
    storage.setItem('salah-theme-preference-v1', raw)
    vi.stubGlobal('localStorage', storage)
    expect(readThemePreferenceCache()).toBe(DEFAULT_THEME_FAMILY)
    expect(storage.getItem('salah-theme-preference-v1')).toBe(raw)
  })

  it('treats denied storage as unavailable without throwing', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new DOMException('denied', 'SecurityError') },
      setItem: () => { throw new DOMException('denied', 'SecurityError') },
      removeItem: () => { throw new DOMException('denied', 'SecurityError') },
    })
    expect(readThemePreferenceCache()).toBe(DEFAULT_THEME_FAMILY)
    expect(writeThemePreferenceCache('seasonal')).toBe(false)
    expect(() => clearThemePreferenceCache()).not.toThrow()
  })

  it('clears only its own versioned preference on reset', () => {
    const storage = memoryStorage()
    storage.setItem('other-setting', 'keep')
    vi.stubGlobal('localStorage', storage)
    writeThemePreferenceCache('seasonal')
    clearThemePreferenceCache()
    expect(readThemePreferenceCache()).toBe(DEFAULT_THEME_FAMILY)
    expect(storage.getItem('other-setting')).toBe('keep')
  })

  it('maps a preference removal event to the default family without writing storage', () => {
    const storage = memoryStorage()
    storage.setItem('salah-theme-preference-v1', JSON.stringify({ version: 1, themeFamily: 'seasonal' }))
    vi.stubGlobal('localStorage', storage)
    const event = new StorageEvent('storage', { key: 'salah-theme-preference-v1', oldValue: storage.getItem('salah-theme-preference-v1'), newValue: null })

    expect(themeFamilyFromCacheEvent(event)).toBe(DEFAULT_THEME_FAMILY)
    expect(storage.getItem('salah-theme-preference-v1')).not.toBeNull()
  })
})
