import { afterEach, describe, expect, it, vi } from 'vitest'

const source = {
  name: 'GeoNames',
  url: 'https://www.geonames.org/',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  updatedAt: '2026-09-01',
}
const seed = {
  schemaVersion: 1,
  source,
  cities: [[1, 'Киров', ['киров'], 'RU', '43', 58.6, 49.6, 5000, 'Europe/Moscow', 'Кировская область', 'россия']],
}

afterEach(() => vi.unstubAllGlobals())

describe('compact offline place seed', () => {
  it('loads and validates only the small same-origin seed without creating persistent storage', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(seed), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    const { loadOfflineCitySeed } = await import('../src/data/cityRepository')

    const result = await loadOfflineCitySeed()

    expect(result).toMatchObject({ ok: true, value: { cities: [expect.arrayContaining([1, 'Киров'])] } })
    expect(fetcher).toHaveBeenCalledWith('/data/cities/offline-seed.json', { cache: 'no-store' })
  })

  it.each([
    ['schema', { ...seed, schemaVersion: 2 }],
    ['duplicate id', { ...seed, cities: [...seed.cities, seed.cities[0]] }],
    ['invalid timezone', { ...seed, cities: [[1, 'Киров', ['киров'], 'RU', '43', 58.6, 49.6, 5000, 'UTC+3', 'Кировская область', 'россия']] }],
    ['coordinate range', { ...seed, cities: [[1, 'Киров', ['киров'], 'RU', '43', 91, 49.6, 5000, 'Europe/Moscow', 'Кировская область', 'россия']] }],
  ])('rejects a seed with invalid %s data', async (_case, value) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(value), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    const { loadOfflineCitySeed } = await import('../src/data/cityRepository')

    await expect(loadOfflineCitySeed()).resolves.toMatchObject({ ok: false, error: { reason: 'invalid' } })
  })

  it('reports unavailable when the local seed cannot be fetched', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline')))
    const { loadOfflineCitySeed } = await import('../src/data/cityRepository')

    await expect(loadOfflineCitySeed()).resolves.toMatchObject({ ok: false, error: { reason: 'unavailable' } })
  })
})
