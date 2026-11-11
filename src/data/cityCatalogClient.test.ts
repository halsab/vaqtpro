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




  it('reverse geocodes GPS and selects the closest village regardless of population', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response([
      { geonameId: 501, name: 'Farther', lat: 55, lng: 37.61, countryCode: 'RU', population: 90000,
        timezone: { timeZoneId: 'Europe/Moscow' }, fcode: 'PPL' },
      { geonameId: 502, name: 'Village', lat: 55, lng: 37.6001, countryCode: 'RU', population: 0,
        timezone: { timeZoneId: 'Europe/Moscow' }, fcode: 'PPL' },
    ]))
    const service = createCityCatalogService({ fetcher, geonamesUsername: 'vaqtpro-test',
      loadOfflineSeed: () => Promise.resolve(success(offlineSeed)) })

    await expect(service.findNearest(55, 37.6, 25)).resolves.toMatchObject({
      ok: true, value: { id: 502, name: 'Village', latitude: 55, longitude: 37.6001, population: 0 },
    })
    const request = new URL(fetcher.mock.calls[0]?.[0] as URL)
    expect(request.pathname).toBe('/findNearbyPlaceNameJSON')
    expect(request.searchParams.get('radius')).toBe('25')
    expect(request.searchParams.get('username')).toBe('vaqtpro-test')
    expect(request.searchParams.get('lat')).toBe('55')
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store' })
  })




  it('rejects reverse-geocode candidates beyond the requested radius', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response([
      { geonameId: 601, name: 'Outside', lat: 55, lng: 37.61, countryCode: 'RU',
        timezone: { timeZoneId: 'Europe/Moscow' }, fcode: 'PPL' },
    ]))
    const service = createCityCatalogService({ fetcher, geonamesUsername: 'vaqtpro-test',
      loadOfflineSeed: () => Promise.resolve(success({ ...offlineSeed, cities: [] })) })

    await expect(service.findNearest(55, 37.6, 0.5)).resolves.toEqual(success(null))
  })

  it('accepts a populated place exactly on the 25 km boundary', async () => {
    const longitude = 2 * Math.asin(Math.sin(25 / (2 * 6_371))) * 180 / Math.PI
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response([{
      geonameId: 602, name: 'Boundary village', lat: 0, lng: longitude, countryCode: 'RU',
      timezone: { timeZoneId: 'Europe/Moscow' }, fcode: 'PPL',
    }]))
    const service = createCityCatalogService({ fetcher, geonamesUsername: 'vaqtpro-test',
      loadOfflineSeed: () => Promise.resolve(success({ ...offlineSeed, cities: [] })) })

    await expect(service.findNearest(0, 0, 25, false, 'ru')).resolves.toMatchObject({
      ok: true, value: { id: 602, name: 'Boundary village' },
    })
    const request = new URL(fetcher.mock.calls[0]?.[0] as URL)
    expect(request.pathname).toBe('/findNearbyPlaceNameJSON')
    expect(request.searchParams.get('lang')).toBe('ru')
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
