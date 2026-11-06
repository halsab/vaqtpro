import { haversineDistanceKm } from './location'

export interface City {
  id: number
  name: string
  countryCode: string
  admin1Code: string
  admin1Id?: number
  admin1Name: string
  latitude: number
  longitude: number
  population: number
  timeZone: string
  featureCode?: CityFeatureCode | null
  admin2Name?: string
  nearbyMajorCity?: { city: City; distanceKm: number }
}

export const CITY_FEATURE_CODES = [
  'PPL', 'PPLA', 'PPLA2', 'PPLA3', 'PPLA4', 'PPLA5', 'PPLC', 'PPLCD',
  'PPLF', 'PPLG', 'PPLL', 'PPLR', 'PPLS', 'PPLX', 'STLMT',
] as const
export type CityFeatureCode = typeof CITY_FEATURE_CODES[number]

export function isCityFeatureCode(value: unknown): value is CityFeatureCode {
  return typeof value === 'string' && CITY_FEATURE_CODES.includes(value as CityFeatureCode)
}

export type CityFeatureKind = 'settlement' | 'district' | 'administrative-seat' | 'capital' | 'farm-village' | 'small-locality'

export function cityFeatureKind(code: CityFeatureCode | null): CityFeatureKind {
  if (!code) return 'settlement'
  if (code === 'PPLX') return 'district'
  if (code === 'PPLA' || code === 'PPLA2' || code === 'PPLA3' || code === 'PPLA4' || code === 'PPLA5' || code === 'PPLCD' || code === 'PPLG') return 'administrative-seat'
  if (code === 'PPLC') return 'capital'
  if (code === 'PPLF') return 'farm-village'
  if (code === 'PPLL') return 'small-locality'
  return 'settlement'
}

export type CompactCityRecord = [
  id: number,
  displayName: string,
  normalizedNames: string[],
  countryCode: string,
  admin1Code: string,
  latitude: number,
  longitude: number,
  population: number,
  timeZone: string,
  admin1Name: string,
  normalizedContext: string,
  featureCode?: CityFeatureCode,
]

export interface CityDatasetSource {
  name: string
  url: string
  license: string
  licenseUrl: string
  updatedAt: string
}

export interface CityDataset {
  source: CityDatasetSource
  cities: CompactCityRecord[]
}

const MAX_SEARCH_RESULTS = 60
const countryNames = new Intl.DisplayNames(['ru'], { type: 'region' })

export function normalizeCitySearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('ru-RU')
    .trim()
    .replace(/\s+/g, ' ')
}

export function getCountryName(countryCode: string): string {
  try {
    return countryNames.of(countryCode) ?? countryCode
  } catch {
    return countryCode
  }
}

export function materializeCity(record: CompactCityRecord): City {
  return {
    id: record[0],
    name: record[1],
    countryCode: record[3],
    admin1Code: record[4],
    admin1Name: record[9],
    latitude: record[5],
    longitude: record[6],
    population: record[7],
    timeZone: record[8],
    featureCode: record[11] ?? null,
  }
}

export function formatCityRegion(city: City): string {
  return city.admin1Name || (city.admin1Code && city.admin1Code !== '00'
    ? `регион ${city.admin1Code}`
    : 'регион не указан')
}

export function formatCityLabel(city: City, disambiguate = false): string {
  const context = [city.admin2Name?.trim(), formatCityRegion(city)].filter(Boolean).join(', ')
  const label = `${city.name}, ${context}, ${getCountryName(city.countryCode)}`
  return disambiguate ? `${label} · GeoNames ${city.id}` : label
}

export function findNearestCity(
  latitude: number,
  longitude: number,
  cities: readonly CompactCityRecord[],
  maxDistanceKm: number,
): City | null {
  if (!validNearestQuery(latitude, longitude, maxDistanceKm)) return null
  let nearest: CompactCityRecord | undefined
  let nearestDistance = Number.POSITIVE_INFINITY

  for (const city of cities) {
    const distance = haversineDistanceKm(
      latitude,
      longitude,
      city[5],
      city[6],
    )
    if (distance < nearestDistance || (distance === nearestDistance && city[0] < (nearest?.[0] ?? Infinity))) {
      nearest = city
      nearestDistance = distance
    }
  }

  return nearest && nearestDistance <= maxDistanceKm
    ? materializeCity(nearest)
    : null
}

export function searchCities(
  dataset: CityDataset,
  query: string,
  limit = MAX_SEARCH_RESULTS,
): City[] {
  const terms = normalizeCitySearch(query).split(/\s+/).filter(Boolean)
  const requestedLimit = Number.isFinite(limit)
    ? Math.floor(limit)
    : MAX_SEARCH_RESULTS
  const resultLimit = Math.min(
    Math.max(requestedLimit, 0),
    MAX_SEARCH_RESULTS,
  )
  if (terms.length === 0 || resultLimit === 0) return []

  const normalized = normalizeCitySearch(query)
  const matches: { record: CompactCityRecord; rank: number }[] = []
  for (const record of dataset.cities) {
    const names = record[2]
    const key = `${names.join(' ')} ${record[10]}`
    if (!terms.every((term) => key.includes(term))) continue
    const primary = names[0] ?? ''
    const rank = primary === normalized ? 0
      : primary.startsWith(normalized) ? 1
        : names.slice(1).some((name) => name === normalized) ? 2
          : names.slice(1).some((name) => name.startsWith(normalized)) ? 3
            : names.some((name) => terms.every((term) => name.includes(term))) ? 4 : 5
    matches.push({ record, rank })
  }
  return matches.sort((a, b) => a.rank - b.rank
    || b.record[7] - a.record[7] || a.record[0] - b.record[0])
    .slice(0, resultLimit).map(({ record }) => materializeCity(record))
}

export function validNearestQuery(latitude: number, longitude: number, maxDistanceKm: number): boolean {
  return Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && Number.isFinite(longitude) && Math.abs(longitude) <= 180
    && Number.isFinite(maxDistanceKm) && maxDistanceKm >= 0
}
