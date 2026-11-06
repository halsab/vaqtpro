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

it('retries a previously blocked legacy database deletion without blocking the app', async () => {
  const requests = Array.from({ length: 2 }, () => ({ onsuccess: null as (() => void) | null, onerror: null as (() => void) | null, onblocked: null as (() => void) | null }))
  const factory = { deleteDatabase: vi.fn().mockReturnValueOnce(requests[0]).mockReturnValueOnce(requests[1]) }
  vi.stubGlobal('indexedDB', factory)
  const { clearLegacyCatalogStorage } = await import('./cityCatalogStorage')
  const first = clearLegacyCatalogStorage()
  requests[0]?.onblocked?.()
  await expect(first).rejects.toThrow(/blocked/)
  const second = clearLegacyCatalogStorage()
  expect(factory.deleteDatabase).toHaveBeenCalledTimes(2)
  requests[1]?.onsuccess?.()
  await expect(second).resolves.toBeUndefined()
})
