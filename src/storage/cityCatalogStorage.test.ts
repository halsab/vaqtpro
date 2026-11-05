import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.resetModules(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('deletes previously persisted place index data without creating a replacement database', async () => {
  const request = { onsuccess: null as (() => void) | null, onerror: null as (() => void) | null, onblocked: null as (() => void) | null }
  const factory = { deleteDatabase: vi.fn(() => request) }
  vi.stubGlobal('indexedDB', factory)
  const { clearLegacyCatalogStorage } = await import('./cityCatalogStorage')

  const cleanup = clearLegacyCatalogStorage()
  expect(factory.deleteDatabase).toHaveBeenCalledWith('salah-city-catalog')
  request.onsuccess?.()
  await expect(cleanup).resolves.toBeUndefined()
})

it('continues when IndexedDB is unavailable', async () => {
  vi.stubGlobal('indexedDB', undefined)
  const { clearLegacyCatalogStorage } = await import('./cityCatalogStorage')
  await expect(clearLegacyCatalogStorage()).resolves.toBeUndefined()
})
