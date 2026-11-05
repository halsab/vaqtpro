import { describe, expect, it, vi } from 'vitest'

import type { CityDataset } from '../domain/cities'
import { failure, success } from '../domain/result'
import { createCityCatalogService } from './cityCatalogClient'

const offlineSeed: CityDataset = {
  source: {
    name: 'GeoNames',
    url: 'https://www.geonames.org/',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    updatedAt: '2026-09-01',
  },
  cities: [[1, 'Киров', ['киров'], 'RU', '43', 58.6, 49.6, 5000, 'Europe/Moscow', 'Кировская область', 'россия']],
}

function response(geonames: unknown): Response {
  return new Response(JSON.stringify({ geonames }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('online place search', () => {
  it('queries GeoNames all-country populated places and maps villages, districts, timezone and coordinates', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response([
      {
        geonameId: 5001, name: 'Облово', lat: '55.7', lng: '37.6',
        countryCode: 'RU', adminCode1: '50', adminName1: 'Московская область',
        population: 27, timezone: { timeZoneId: 'Europe/Moscow' }, fcode: 'PPLX',
      },
      {
        geonameId: 5002, name: 'Новая Деревня', lat: 55.8, lng: 37.7,
        countryCode: 'RU', adminCode1: '50', adminName1: 'Московская область', population: 81,
        timezone: { timeZoneId: 'Europe/Moscow' }, fcode: 'PPL',
      },
    ]))
    const service = createCityCatalogService({
      fetcher,
      geonamesUsername: 'vaqtpro-test',
      loadOfflineSeed: () => Promise.resolve(success(offlineSeed))
    })

    await service.load()
    const result = await service.search(' Облово ', 'ru')

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 'complete',
        cities: [
          { id: 5001, name: 'Облово', population: 27, featureCode: 'PPLX', timeZone: 'Europe/Moscow' },
          { id: 5002, name: 'Новая Деревня', population: 81, featureCode: 'PPL' },
        ],
      },
    })
    const [url, options] = fetcher.mock.calls[0] ?? []
    const request = new URL(url as URL)
    expect(request.origin + request.pathname).toBe('https://secure.geonames.org/searchJSON')
    expect(request.searchParams.get('name_startsWith')).toBe('Облово')
    expect(request.searchParams.get('maxRows')).toBe('100')
    expect(request.searchParams.get('featureClass')).toBe('P')
    expect(request.searchParams.get('orderby')).toBe('relevance')
    expect(request.searchParams.get('lang')).toBe('ru')
    expect(request.searchParams.get('style')).toBe('FULL')
    expect(request.searchParams.get('type')).toBe('json')
    expect(request.searchParams.get('username')).toBe('vaqtpro-test')
    expect(request.searchParams.has('country')).toBe(false)
    expect([...request.searchParams.keys()]).toEqual(['name_startsWith', 'maxRows', 'featureClass', 'orderby', 'lang', 'style', 'type', 'username'])
    expect(options).toMatchObject({ cache: 'no-store' })
    expect(options?.signal).toBeInstanceOf(AbortSignal)
  })

  it('drops malformed, unsupported and duplicate GeoNames results', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response([
      { geonameId: 1, name: 'Деревня', lat: 55, lng: 37, countryCode: 'RU', timezone: { timeZoneId: 'Europe/Moscow' }, fcode: 'PPL' },
      { geonameId: 1, name: 'Деревня повтор', lat: 56, lng: 38, countryCode: 'RU', timezone: { timeZoneId: 'Europe/Moscow' }, fcode: 'PPL' },
      { geonameId: 2, name: 'Озеро', lat: 55, lng: 37, countryCode: 'RU', timezone: { timeZoneId: 'Europe/Moscow' }, fcode: 'LK' },
      { geonameId: 3, name: 'Без пояса', lat: 55, lng: 37, countryCode: 'RU', timezone: { timeZoneId: 'UTC+3' }, fcode: 'PPL' },
      { geonameId: 4, name: 'Координаты вне Земли', lat: 95, lng: 37, countryCode: 'RU', timezone: { timeZoneId: 'Europe/Moscow' }, fcode: 'PPL' },
    ]))
    const service = createCityCatalogService({ fetcher, geonamesUsername: 'vaqtpro-test', loadOfflineSeed: () => Promise.resolve(success(offlineSeed)) })
    await service.load()

    await expect(service.search('деревня')).resolves.toMatchObject({
      ok: true,
      value: { cities: [{ id: 1, name: 'Деревня' }] },
    })
  })

  it('retries an unmatched Latin name with a bounded Russian transliteration request', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([{
        geonameId: 478804, name: 'Уразаево', lat: 55.4, lng: 53.9,
        countryCode: 'RU', adminCode1: '73', adminName1: 'Татарстан',
        timezone: { timeZoneId: 'Europe/Moscow' }, fcode: 'PPL',
      }]))
    const service = createCityCatalogService({ fetcher, geonamesUsername: 'vaqtpro-test', loadOfflineSeed: () => Promise.resolve(success(offlineSeed)) })

    await expect(service.search('Urazaevo', 'ru')).resolves.toMatchObject({
      ok: true,
      value: { status: 'complete', cities: [{ id: 478804, name: 'Уразаево', featureCode: 'PPL' }] },
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(new URL(fetcher.mock.calls[0]?.[0] as URL).searchParams.get('name_startsWith')).toBe('Urazaevo')
    expect(new URL(fetcher.mock.calls[1]?.[0] as URL).searchParams.get('name_startsWith')).toBe('уразаево')
    expect(new URL(fetcher.mock.calls[1]?.[0] as URL).searchParams.get('username')).toBe('vaqtpro-test')
  })

  it('falls back to the compact in-memory offline seed without storing provider results', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'))
    const loadOfflineSeed = vi.fn(() => Promise.resolve(success(offlineSeed)))
    const service = createCityCatalogService({ fetcher, geonamesUsername: 'vaqtpro-test', loadOfflineSeed })
    await service.load()

    await expect(service.search('Киров')).resolves.toMatchObject({
      ok: true,
      value: { status: 'offline-seed', cities: [{ id: 1, name: 'Киров' }] },
    })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(loadOfflineSeed).toHaveBeenCalledOnce()
  })

  it('keeps online search available when loading the offline seed fails', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response([{
      geonameId: 71, name: 'Село', lat: 55, lng: 37, countryCode: 'RU',
      timezone: { timeZoneId: 'Europe/Moscow' }, fcode: 'PPL',
    }]))
    const service = createCityCatalogService({
      fetcher,
      geonamesUsername: 'vaqtpro-test',
      loadOfflineSeed: () => Promise.resolve(failure({ kind: 'data', reason: 'unavailable' }))
    })

    await expect(service.search('Село')).resolves.toMatchObject({
      ok: true,
      value: { status: 'complete', cities: [{ id: 71, name: 'Село' }] },
    })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('falls back to the seed when the GeoNames request times out', async () => {
    vi.useFakeTimers()
    try {
      const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Запрос отменён', 'AbortError')), { once: true })
      }))
      const service = createCityCatalogService({
        fetcher,
        geonamesUsername: 'vaqtpro-test',
        loadOfflineSeed: () => Promise.resolve(success(offlineSeed))
      })
      const pending = service.search('Киров')
      await vi.advanceTimersByTimeAsync(12_000)

      await expect(pending).resolves.toMatchObject({
        ok: true,
        value: { status: 'offline-seed', cities: [{ id: 1, name: 'Киров' }] },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('resolves a nearby GPS label from the offline seed and never sends coordinates to the geocoder', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const service = createCityCatalogService({ fetcher, loadOfflineSeed: () => Promise.resolve(success(offlineSeed)) })

    await expect(service.findNearest(58.6, 49.6, 25)).resolves.toMatchObject({
      ok: true,
      value: { id: 1, name: 'Киров' },
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('returns an explicit failure when both online search and the offline seed are unavailable', async () => {
    const service = createCityCatalogService({
      fetcher: vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline')),
      geonamesUsername: 'vaqtpro-test',
      loadOfflineSeed: () => Promise.resolve(failure({ kind: 'data', reason: 'unavailable' }))
    })

    await expect(service.search('Село')).resolves.toEqual(failure({ kind: 'data', reason: 'unavailable' }))
  })

  it('aborts an older request and prevents its late response from replacing the next query', async () => {
    let resolveFirst!: (value: Response) => void
    const fetcher = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve }))
      .mockResolvedValueOnce(response([]))
    const service = createCityCatalogService({ fetcher, geonamesUsername: 'vaqtpro-test', loadOfflineSeed: () => Promise.resolve(success(offlineSeed)) })
    await service.load()

    const oldRequest = service.search('Старое')
    await Promise.resolve()
    const newRequest = service.search('Новое')
    resolveFirst(response([{ geonameId: 9, name: 'Старое', lat: 55, lng: 37, countryCode: 'RU', timezone: { timeZoneId: 'Europe/Moscow' }, fcode: 'PPL' }]))

    await expect(oldRequest).resolves.toMatchObject({ ok: false, error: { reason: 'superseded' } })
    await expect(newRequest).resolves.toMatchObject({ ok: true, value: { cities: [] } })
  })

  it('aborts a pending request when the input becomes shorter than the minimum query', async () => {
    let resolvePending!: (value: Response) => void
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(resolve => { resolvePending = resolve }))
    const service = createCityCatalogService({ fetcher, geonamesUsername: 'vaqtpro-test', loadOfflineSeed: () => Promise.resolve(success(offlineSeed)) })
    await service.load()
    const pending = service.search('Село')
    await Promise.resolve()

    await expect(service.search('С')).resolves.toMatchObject({ ok: true, value: { cities: [], status: 'complete' } })
    resolvePending(response([{ geonameId: 9, name: 'Село', lat: 55, lng: 37, countryCode: 'RU', timezone: { timeZoneId: 'Europe/Moscow' }, fcode: 'PPL' }]))

    await expect(pending).resolves.toMatchObject({ ok: false, error: { reason: 'superseded' } })
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
  })

  it('explicitly reports truncated GeoNames results and filters regional context', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      totalResultsCount: 182,
      geonames: [
        { geonameId: 11, name: 'Облово', lat: 57.1, lng: 34.1, countryCode: 'RU', adminCode1: '69', adminName1: 'Тверская Область', timezone: { timeZoneId: 'Europe/Moscow' }, fcode: 'PPL' },
        { geonameId: 12, name: 'Облово', lat: 52.6, lng: 83.6, countryCode: 'RU', adminCode1: '22', adminName1: 'Алтайский Край', timezone: { timeZoneId: 'Asia/Barnaul' }, fcode: 'PPL' },
      ],
    }), { status: 200 }))
    const service = createCityCatalogService({ fetcher, geonamesUsername: 'vaqtpro-test', loadOfflineSeed: () => Promise.resolve(success(offlineSeed)) })
    await expect(service.search('Облово, Тверская')).resolves.toMatchObject({
      ok: true, value: { status: 'limited', cities: [{ id: 11, name: 'Облово' }] },
    })
    expect(new URL(fetcher.mock.calls[0]?.[0] as URL).searchParams.get('name_startsWith')).toBe('Облово')
  })

  it('fetches the next GeoNames page and stops when it is exhausted', async () => {
    const row = (id: number) => ({ geonameId: id, name: 'Облово', lat: 55, lng: 49, countryCode: 'RU',
      timezone: { timeZoneId: 'Europe/Moscow' }, fcode: 'PPL' })
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ totalResultsCount: 101, geonames: [row(1)] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ totalResultsCount: 101, geonames: [row(2)] })))
    const service = createCityCatalogService({ fetcher, geonamesUsername: 'vaqtpro-test',
      loadOfflineSeed: () => Promise.resolve(success(offlineSeed)) })
    const first = await service.search('Облово')
    expect(first).toMatchObject({ ok: true, value: { status: 'limited', nextOffset: 1, cities: [{ id: 1 }] } })
    const next = await service.search('Облово', 'ru', 1)
    expect(next).toMatchObject({ ok: true, value: { status: 'limited', nextOffset: 2, cities: [{ id: 2 }] } })
    expect(new URL(fetcher.mock.calls[1]?.[0] as URL).searchParams.get('startRow')).toBe('1')
    await expect(service.search('Облово', 'ru', -1)).resolves.toMatchObject({ ok: false, error: { reason: 'invalid' } })
  })

  it('offers a separate major-city alternative from the local seed with geographic proximity only', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response([{
      geonameId: 100, name: 'Малая деревня', lat: 58.61, lng: 49.61,
      countryCode: 'RU', adminCode1: '43', adminName1: 'Кировская область',
      timezone: { timeZoneId: 'Europe/Moscow' }, fcode: 'PPL', population: 100,
    }]))
    const service = createCityCatalogService({ fetcher, geonamesUsername: 'vaqtpro-test',
      loadOfflineSeed: () => Promise.resolve(success(offlineSeed)) })
    await service.load()
    await expect(service.search('Малая')).resolves.toMatchObject({
      ok: true, value: { cities: [{ id: 100, nearbyMajorCity: { city: { id: 1 } } }] },
    })
  })

  it('preserves initial online results when the next page fails instead of mixing offline fallback', async () => {
    const row = { geonameId: 211, name: 'Село', lat: 55, lng: 37, countryCode: 'RU',
      timezone: { timeZoneId: 'Europe/Moscow' }, fcode: 'PPL' }
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ totalResultsCount: 3, geonames: [row] })))
      .mockRejectedValueOnce(new TypeError('No network'))
    const service = createCityCatalogService({ fetcher, geonamesUsername: 'vaqtpro-test',
      loadOfflineSeed: () => Promise.resolve(success(offlineSeed)) })
    await expect(service.search('Село')).resolves.toMatchObject({
      ok: true, value: { status: 'limited', nextOffset: 1, cities: [{ id: 211 }] },
    })
    await expect(service.search('Село', 'ru', 1)).resolves.toMatchObject({
      ok: false, error: { reason: 'unavailable' },
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it.each([
    [10, 'authorization'], [18, 'quota'], [19, 'quota'], [20, 'quota'], [22, 'service'],
  ] as const)('reports GeoNames status %i in offline fallback', async (code, warning) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ status: { value: code, message: 'Provider error' } }), { status: 200 }),
    )
    const service = createCityCatalogService({ fetcher, geonamesUsername: 'vaqtpro-test',
      loadOfflineSeed: () => Promise.resolve(success(offlineSeed)) })
    await expect(service.search('Киров')).resolves.toMatchObject({
      ok: true, value: { status: 'offline-seed', providerWarning: warning, cities: [{ id: 1 }] },
    })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('does not call GeoNames without an explicitly configured username', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const service = createCityCatalogService({ fetcher, geonamesUsername: '', loadOfflineSeed: () => Promise.resolve(success(offlineSeed)) })

    await expect(service.search('Киров')).resolves.toMatchObject({
      ok: true,
      value: { status: 'offline-seed', cities: [{ id: 1, name: 'Киров' }] },
    })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
