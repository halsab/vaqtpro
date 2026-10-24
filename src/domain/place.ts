import { formatCityLabel, type City } from './cities'
import { haversineDistanceKm, isConfirmedTatarstan } from './location'
import { resolveGpsGeography, validPosition, type Coverage, type CoverageGeometry } from './localGeography'
import { MOSCOW_TIME_ZONE, isValidTimeZone } from './locationTime'
import type { Locality, SavedCoordinates } from './types'

export interface Place extends SavedCoordinates {
  id: string
  selection: 'gps' | 'city'
  name: string
  /** Unformatted catalog name; never derive it by splitting a display label. */
  cityName?: string
  region: { code: string; name: string } | null
  coverage: Coverage
  automaticTimeZone: { id: string; source: 'city' | 'device' | 'legacy' }
  nearbyCity?: {
    id: number
    name: string
    /** Original unformatted nearby-city name, which can itself contain commas. */
    cityName?: string
    distanceKm: number
    countryCode?: string
    latitude?: number
    longitude?: number
  }
}

export type LegacyOfficialPlace = Omit<Place, 'selection'> & { selection: 'official' }
export type RestorablePlace = Place | LegacyOfficialPlace

type Fix = Pick<SavedCoordinates, 'latitude' | 'longitude' | 'accuracy' | 'timestamp'>
const TATARSTAN = { code: 'RU-TA', name: 'Татарстан' }

export function createGpsPlace(fix: Fix, deviceZone: string, geometry: CoverageGeometry | null, id: string): Place {
  const geography = resolveGpsGeography(fix, deviceZone, geometry)
  return {
    latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy, timestamp: fix.timestamp,
    id, selection: 'gps', name: '',
    region: geography.coverage === 'inside' ? TATARSTAN : null,
    coverage: geography.coverage, timeZone: geography.timeZone,
    automaticTimeZone: { id: geography.timeZone, source: geography.timeZoneSource },
  }
}

export function createCityPlace(city: City, timestamp: number): Place {
  if (!isValidTimeZone(city.timeZone)) throw new RangeError('Неизвестная часовая зона города')
  const countryCode = /^[A-Z]{2}$/.test(city.countryCode) ? city.countryCode : null
  const admin1Code = typeof city.admin1Code === 'string' && /^[A-Z0-9]{1,3}$/.test(city.admin1Code)
    ? city.admin1Code
    : undefined
  const tatarstan = Boolean(countryCode && isConfirmedTatarstan({ source: 'geonames', countryCode, ...(admin1Code ? { admin1Code } : {}) }))
  const region = tatarstan
    ? TATARSTAN
    : countryCode
      ? { code: admin1Code ? `${countryCode}.${admin1Code}` : countryCode, name: typeof city.admin1Name === 'string' ? city.admin1Name : '' }
      : null
  return {
    id: `geonames:${city.id}`, selection: 'city', cityId: city.id,
    name: formatCityLabel(city), cityName: city.name, latitude: city.latitude, longitude: city.longitude,
    accuracy: null, timestamp, timeZone: city.timeZone,
    automaticTimeZone: { id: city.timeZone, source: 'city' },
    region,
    coverage: tatarstan ? 'inside' : 'outside',
  }
}

export function createLocalityPlace(location: Locality, timestamp: number): Place {
  return {
    ...location, id: `locality:${location.id}`, selection: 'city',
    accuracy: null, timestamp, timeZone: location.timeZone ?? MOSCOW_TIME_ZONE,
    automaticTimeZone: { id: location.timeZone ?? MOSCOW_TIME_ZONE, source: 'city' },
    region: TATARSTAN, coverage: 'inside',
  }
}

export function refineGpsPlace(place: Place, fix: Fix, deviceZone: string, geometry: CoverageGeometry | null): Place {
  const refined = createGpsPlace(fix, deviceZone, geometry, place.id)
  const city = place.nearbyCity
  const latitude = city?.latitude
  const longitude = city?.longitude
  if (!city || typeof latitude !== 'number' || !Number.isFinite(latitude)
    || typeof longitude !== 'number' || !Number.isFinite(longitude)
    || !validPosition({ latitude, longitude, accuracy: null })) return refined
  const distanceKm = haversineDistanceKm(fix.latitude, fix.longitude, latitude, longitude)
  if (distanceKm > 25) return refined
  return { ...refined, name: city.name, nearbyCity: { ...city, distanceKm } }
}

export function withNearbyCity(place: Place, city: City | null): Place {
  if (!city || !city.name.trim()) return place
  const distanceKm = haversineDistanceKm(place.latitude, place.longitude, city.latitude, city.longitude)
  if (distanceKm > 25) return place
  const countryCode = /^[A-Z]{2}$/.test(city.countryCode)
    && validPosition({ latitude: city.latitude, longitude: city.longitude, accuracy: null })
    ? city.countryCode
    : undefined
  return {
    ...place,
    name: city.name,
    nearbyCity: {
      id: city.id,
      name: formatCityLabel(city),
      cityName: city.name,
      distanceKm,
      // Храним координаты города, чтобы перепроверить country hint при восстановлении и GPS refinement.
      ...(countryCode ? { countryCode, latitude: city.latitude, longitude: city.longitude } : {}),
    },
  }
}

export function restorePlaceMetadata(place: RestorablePlace): Place {
  const normalized: Place = place.selection === 'official'
    ? { ...place, selection: 'city', timeZone: MOSCOW_TIME_ZONE, automaticTimeZone: { id: MOSCOW_TIME_ZONE, source: 'city' } }
    : place
  const city = normalized.nearbyCity
  if (!city) return normalized
  if (city.distanceKm > 25) {
    const { nearbyCity: _nearbyCity, ...withoutCity } = normalized
    return { ...withoutCity, name: '' }
  }
  if (!Number.isFinite(city.latitude) || !Number.isFinite(city.longitude)) {
    if (city.countryCode) {
      const { countryCode: _countryCode, latitude: _latitude, longitude: _longitude, ...display } = city
      return { ...normalized, nearbyCity: display }
    }
    return normalized
  }
  const latitude = city.latitude
  const longitude = city.longitude
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || typeof longitude !== 'number' || !Number.isFinite(longitude)) {
    const { countryCode: _countryCode, latitude: _latitude, longitude: _longitude, ...display } = city
    return { ...normalized, nearbyCity: display }
  }
  if (!validPosition({ latitude, longitude, accuracy: null })) {
    const { countryCode: _countryCode, latitude: _latitude, longitude: _longitude, ...display } = city
    return { ...normalized, nearbyCity: display }
  }
  const distanceKm = haversineDistanceKm(normalized.latitude, normalized.longitude, latitude, longitude)
  if (distanceKm > 25 || !/^[A-Z]{2}$/.test(city.countryCode ?? '')) {
    const { countryCode: _countryCode, ...display } = city
    if (distanceKm > 25) {
      const { nearbyCity: _nearbyCity, ...withoutCity } = normalized
      return { ...withoutCity, name: '' }
    }
    return { ...normalized, nearbyCity: { ...display, distanceKm } }
  }
  return { ...normalized, nearbyCity: { ...city, distanceKm } }
}

export function gpsCountryCode(place: Pick<Place, 'selection'> & Partial<Pick<Place, 'latitude' | 'longitude' | 'nearbyCity'>>): string | undefined {
  const city = place.nearbyCity
  const latitude = place.latitude
  const longitude = place.longitude
  const cityLatitude = city?.latitude
  const cityLongitude = city?.longitude
  if (place.selection !== 'gps' || !city || !/^[A-Z]{2}$/.test(city.countryCode ?? '')
    || typeof latitude !== 'number' || !Number.isFinite(latitude) || typeof longitude !== 'number' || !Number.isFinite(longitude)
    || typeof cityLatitude !== 'number' || !Number.isFinite(cityLatitude)
    || typeof cityLongitude !== 'number' || !Number.isFinite(cityLongitude)
    || !validPosition({ latitude: cityLatitude, longitude: cityLongitude, accuracy: null })) return undefined
  return haversineDistanceKm(latitude, longitude, cityLatitude, cityLongitude) <= 25
    ? city.countryCode
    : undefined
}

export function homePlaceLabel(place: Place | null, unknownLabel = 'Местоположение не определено'): string {
  if (!place || !validPosition(place)) return unknownLabel
  // Structured names preserve legitimate commas both after direct selection and offline recall.
  // Legacy unstructured labels remain complete rather than being truncated ambiguously.
  const structuredName = place.selection === 'gps' ? place.nearbyCity?.cityName : place.cityName
  const name = (structuredName || place.name.replace(/^Рядом:\s*/u, '')).trim()
  if (name && name !== 'Моё местоположение') return name
  return `${place.latitude.toFixed(4)}, ${place.longitude.toFixed(4)}`
}

export function isFreshGpsPlace(place: Place | null, now: number): boolean {
  return Boolean(place && place.selection === 'gps' && validPosition(place)
    && now >= place.timestamp && now - place.timestamp < 30 * 60_000)
}

export function isUsefulRefinement(previous: Place, next: Place): boolean {
  const oldAccuracy = previous.accuracy ?? Infinity
  const newAccuracy = next.accuracy ?? Infinity
  if (newAccuracy > oldAccuracy) return false
  const moved = haversineDistanceKm(previous.latitude, previous.longitude, next.latitude, next.longitude) * 1000
  return previous.coverage !== next.coverage
    || previous.automaticTimeZone.id !== next.automaticTimeZone.id
    || moved > Math.max(100, oldAccuracy + newAccuracy)
    || (oldAccuracy - newAccuracy >= 100 && newAccuracy <= oldAccuracy / 2)
}
