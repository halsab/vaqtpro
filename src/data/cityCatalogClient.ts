import { findNearestCity, getCountryName, isCityFeatureCode, normalizeCitySearch, searchCities, validNearestQuery, type City, type CityDataset, type CityFeatureCode } from '../domain/cities'
import type { DataFailure } from '../domain/errors'
import { isValidTimeZone } from '../domain/locationTime'
import { failure, success, type Result } from '../domain/result'
import { loadOfflineCitySeed } from './cityRepository'
import type { CityCatalogService, CitySearchResult } from './cityCatalog'

export const GEONAMES_SEARCH_URL = 'https://secure.geonames.org/searchJSON'
const MAX_RESULTS = 100
const REQUEST_TIMEOUT_MS = 12_000
const MIN_QUERY_LENGTH = 2
const LATIN_TO_CYRILLIC = [
  ['shch', 'щ'], ['sch', 'щ'], ['yo', 'ё'], ['zh', 'ж'], ['kh', 'х'], ['ts', 'ц'],
  ['ch', 'ч'], ['sh', 'ш'], ['yu', 'ю'], ['ya', 'я'],
  ['a', 'а'], ['b', 'б'], ['c', 'к'], ['d', 'д'], ['e', 'е'], ['f', 'ф'], ['g', 'г'],
  ['h', 'х'], ['i', 'и'], ['j', 'й'], ['k', 'к'], ['l', 'л'], ['m', 'м'], ['n', 'н'],
  ['o', 'о'], ['p', 'п'], ['q', 'к'], ['r', 'р'], ['s', 'с'], ['t', 'т'], ['u', 'у'],
  ['v', 'в'], ['w', 'в'], ['x', 'кс'], ['y', 'ы'], ['z', 'з'],
] as const

interface GeoNamesResult {
  geonameId: number | string
  name: string
  lat: number | string
  lng: number | string
  countryCode: string
  adminCode1?: string
  adminName1?: string
  population?: number | string
  timezone: { timeZoneId: string }
  fcode: CityFeatureCode
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function transliterateLatinQuery(query: string): string | null {
  const normalized = query.toLocaleLowerCase('ru-RU')
  if (!/\p{Script=Latin}/u.test(normalized)) return null
  let result = ''
  for (let index = 0; index < normalized.length;) {
    const match = LATIN_TO_CYRILLIC.find(([latin]) => normalized.startsWith(latin, index))
    if (match) {
      result += match[1]
      index += match[0].length
    } else {
      result += normalized.charAt(index)
      index += 1
    }
  }
  return /\p{Script=Cyrillic}/u.test(result) && result !== normalized ? result : null
}

function numberValue(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && value.trim() === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function isGeoNamesResult(value: unknown): value is GeoNamesResult {
  if (!object(value)) return false
  const id = numberValue(value.geonameId)
  const latitude = numberValue(value.lat)
  const longitude = numberValue(value.lng)
  const population = value.population === undefined ? 0 : numberValue(value.population)
  return id !== null && Number.isSafeInteger(id) && id > 0
    && typeof value.name === 'string' && value.name.trim().length > 0
    && latitude !== null && Math.abs(latitude) <= 90
    && longitude !== null && Math.abs(longitude) <= 180
    && typeof value.countryCode === 'string' && /^[A-Z]{2}$/.test(value.countryCode)
    && (value.adminCode1 === undefined || typeof value.adminCode1 === 'string')
    && (value.adminName1 === undefined || typeof value.adminName1 === 'string')
    && population !== null && Number.isSafeInteger(population) && population >= 0
    && object(value.timezone) && typeof value.timezone.timeZoneId === 'string' && isValidTimeZone(value.timezone.timeZoneId)
    && isCityFeatureCode(value.fcode)
}

function isLimited(value: unknown): boolean {
  if (!object(value)) return false
  const total = numberValue(value.totalResultsCount)
  return (total !== null && total > MAX_RESULTS)
    || (Array.isArray(value.geonames) && value.geonames.length >= MAX_RESULTS)
}

export function parseGeoNamesResults(value: unknown): City[] {
  if (!object(value) || !Array.isArray(value.geonames)) {
    throw new Error('Невалидный ответ GeoNames')
  }
  const rows: unknown[] = value.geonames
  const cities: City[] = []
  const ids = new Set<number>()
  for (const row of rows.slice(0, MAX_RESULTS)) {
    if (!isGeoNamesResult(row)) continue
    const id = Number(row.geonameId)
    if (ids.has(id)) continue
    ids.add(id)
    cities.push({
      id,
      name: row.name.trim(),
      countryCode: row.countryCode,
      admin1Code: row.adminCode1?.trim() ?? '',
      admin1Name: row.adminName1?.trim() ?? '',
      latitude: Number(row.lat),
      longitude: Number(row.lng),
      population: row.population === undefined ? 0 : Number(row.population),
      timeZone: row.timezone.timeZoneId,
      featureCode: row.fcode,
    })
  }
  return cities
}

export function createCityCatalogService(dependencies: {
  fetcher?: typeof fetch
  geonamesUsername?: string
  loadOfflineSeed?: () => Promise<Result<CityDataset, DataFailure>>
} = {}): CityCatalogService {
  const fetcher = dependencies.fetcher ?? fetch
  const configuredUsername: unknown = import.meta.env.VITE_GEONAMES_USERNAME
  const geonamesUsername = dependencies.geonamesUsername ?? (typeof configuredUsername === 'string' ? configuredUsername : '')
  const loadSeed = dependencies.loadOfflineSeed ?? loadOfflineCitySeed
  let seed: CityDataset | null = null
  let seedLoad: Promise<Result<undefined, DataFailure>> | null = null
  let searchRevision = 0
  let activeSearch: AbortController | null = null

  const cancelSearch = () => {
    searchRevision += 1
    activeSearch?.abort()
    activeSearch = null
  }

  const load = (): Promise<Result<undefined, DataFailure>> => {
    if (seed) return Promise.resolve(success(undefined))
    if (seedLoad) return seedLoad
    const loading = loadSeed().then(result => {
      if (result.ok) seed = result.value
      else if (seedLoad === loading) seedLoad = null
      return result.ok ? success(undefined) : result
    }).catch(() => {
      if (seedLoad === loading) seedLoad = null
      return failure<DataFailure>({ kind: 'data', reason: 'unavailable' })
    })
    seedLoad = loading
    return loading
  }

  const offlineResult = (query: string): CitySearchResult => {
    const transliterated = transliterateLatinQuery(query)
    const loadedSeed = seed
    const cities = loadedSeed
      ? [...new Map([query, transliterated].filter((term): term is string => Boolean(term))
        .flatMap(term => searchCities(loadedSeed, term)).map(city => [city.id, city])).values()]
      : []
    return { cities, status: 'offline-seed' }
  }

  const offlineFallback = async (query: string, revision: number): Promise<Result<CitySearchResult, DataFailure>> => {
    const loaded = await load()
    if (!loaded.ok) return loaded
    return revision === searchRevision
      ? success(offlineResult(query))
      : failure({ kind: 'data', reason: 'superseded' })
  }

  const search = async (query: string, language = 'ru'): Promise<Result<CitySearchResult, DataFailure>> => {
    const normalizedQuery = query.trim()
    const nameQuery = normalizedQuery.split(',')[0]?.trim() ?? ''
    const contextQuery = normalizedQuery.split(',').slice(1).join(' ').trim()
    const revision = ++searchRevision
    activeSearch?.abort()
    activeSearch = null
    if (Array.from(nameQuery).length < MIN_QUERY_LENGTH) return success({ cities: [], status: 'complete' })
    if (!geonamesUsername.trim()) return await offlineFallback(normalizedQuery, revision)
    // Подготовка офлайн-резерва не задерживает запрос онлайн-каталога.
    void load()
    const controller = new AbortController()
    activeSearch = controller

    const makeUrl = (name: string) => {
      const url = new URL(GEONAMES_SEARCH_URL)
      url.searchParams.set('name_startsWith', name)
      url.searchParams.set('maxRows', String(MAX_RESULTS))
      url.searchParams.set('featureClass', 'P')
      url.searchParams.set('orderby', 'relevance')
      url.searchParams.set('lang', language)
      url.searchParams.set('style', 'FULL')
      url.searchParams.set('type', 'json')
      url.searchParams.set('username', geonamesUsername.trim())
      return url
    }
    const url = makeUrl(nameQuery)
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetcher(url, { cache: 'no-store', signal: controller.signal })
      if (!response.ok) return await offlineFallback(normalizedQuery, revision)
      const raw: unknown = await response.json()
      let cities = parseGeoNamesResults(raw)
      let limited = isLimited(raw)
      if (revision !== searchRevision) return failure({ kind: 'data', reason: 'superseded' })
      const transliterated = transliterateLatinQuery(nameQuery)
      if (!cities.length && transliterated) {
        const fallbackUrl = makeUrl(transliterated)
        const fallbackResponse = await fetcher(fallbackUrl, { cache: 'no-store', signal: controller.signal })
        if (!fallbackResponse.ok) return await offlineFallback(normalizedQuery, revision)
        const retryRaw: unknown = await fallbackResponse.json()
        cities = parseGeoNamesResults(retryRaw)
        limited = isLimited(retryRaw)
      }
      if (contextQuery) {
        const terms = normalizeCitySearch(contextQuery).split(/\s+/).filter(Boolean)
        cities = cities.filter(city => {
          const context = normalizeCitySearch(`${city.admin1Name} ${getCountryName(city.countryCode)}`)
          return terms.every(term => context.includes(term))
        })
      }
      return revision === searchRevision
        ? success({ cities, status: limited ? 'limited' : 'complete' })
        : failure({ kind: 'data', reason: 'superseded' })
    } catch {
      if (revision !== searchRevision) return failure({ kind: 'data', reason: 'superseded' })
      return await offlineFallback(normalizedQuery, revision)
    } finally {
      clearTimeout(timeout)
      if (activeSearch === controller) activeSearch = null
    }
  }

  const findNearest = async (latitude: number, longitude: number, maxDistanceKm: number, _localOnly = false): Promise<Result<City | null, DataFailure>> => {
    if (!validNearestQuery(latitude, longitude, maxDistanceKm)) return failure({ kind: 'data', reason: 'invalid' })
    const loaded = await load()
    if (!loaded.ok) return loaded
    return success(seed ? findNearestCity(latitude, longitude, seed.cities, maxDistanceKm) : null)
  }

  return { load, search, findNearest, cancelSearch, cancelPending: cancelSearch }
}

export const cityCatalogService = createCityCatalogService()
