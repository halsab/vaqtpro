import { describe, expect, it } from 'vitest'
import { createGpsPlace, homePlaceLabel, refineGpsPlace, createCityPlace, isFreshGpsPlace, withNearbyCity } from './place'
import { placeFromChoice } from './placeMigration'
import { getDeviceTimeZone } from './locationTime'
import type { CoverageGeometry } from './localGeography'
const geometry: CoverageGeometry = { uncertaintyMeters: 2000, polygons: [[[[49,55],[50,55],[50,56],[49,56],[49,55]]]] }
const position = { latitude: 55.5, longitude: 49.5, accuracy: 1000, timestamp: 100 }
const gps = () => createGpsPlace(position, 'America/Los_Angeles', geometry, 'gps:1')

describe('place identity and timezone', () => {
  it('keeps real coordinates, identity and automatic timezone independent of label', () => {
    const place = gps()
    expect(place).toMatchObject({ id: 'gps:1', selection: 'gps', ...position, timeZone: 'America/Los_Angeles', coverage: 'inside' })
    expect(place.name).toBe('')
    expect(homePlaceLabel(place)).toBe('55.5000, 49.5000')
  })
  it('uses a short locality name on home and keeps coordinates as the GPS fallback', () => {
    const named = withNearbyCity(gps(), { id: 1, name: 'Казань', countryCode: 'RU', admin1Code: '73', admin1Name: 'Татарстан', latitude: 55.5, longitude: 49.5, population: 1, timeZone: 'Europe/Moscow' })
    expect(homePlaceLabel(named)).toBe('Казань')
    expect(homePlaceLabel(null)).toBe('Местоположение не определено')
  })
  it('keeps embedded commas in actual selected city names on home and after GPS enrichment', () => {
    const name = 'Сан, Хосе'
    const city = { id: 101, name, countryCode: 'RU', admin1Code: '73', admin1Name: 'Район, Восток',
      latitude: 55.5, longitude: 49.5, population: 1, timeZone: 'Europe/Moscow' }
    const manual = createCityPlace(city, 100)
    const namedGps = withNearbyCity(gps(), city)
    expect(manual.cityName).toBe(name)
    expect(namedGps.nearbyCity?.cityName).toBe(name)
    expect(homePlaceLabel(manual)).toBe(name)
    expect(homePlaceLabel(namedGps)).toBe(name)
    expect(homePlaceLabel(placeFromChoice({
      mode: 'calculated', source: 'manual', coordinates: manual, place: manual,
    }, []))).toBe(name)
    expect(homePlaceLabel(placeFromChoice({
      mode: 'calculated', source: 'automatic', coordinates: namedGps, place: namedGps,
    }, []))).toBe(name)
  })
  it('uses the current device timezone after GPS refinement, including inside official coverage', () => {
    const refined = refineGpsPlace(gps(), { ...position, accuracy: 10, timestamp: 200 }, 'Asia/Tokyo', geometry)
    expect(refined.timeZone).toBe('Asia/Tokyo')
  })
  it('new manual city resets override, GPS refresh retains it', () => {
    const city = createCityPlace({ id: 1, name: 'Berlin', countryCode: 'DE', admin1Code: '16', admin1Name: 'Berlin', latitude: 52.52, longitude: 13.4, population: 1, timeZone: 'Europe/Berlin' }, 300)
    expect(city.timeZone).toBe('Europe/Berlin')
    expect(city.selection).toBe('city')
  })
  it('keeps valid country identity when GeoNames has no usable subdivision', () => {
    const city = createCityPlace({ id: 2, name: 'Moscow', countryCode: 'RU', admin1Code: '', admin1Name: '', latitude: 55.75, longitude: 37.62, population: 1, timeZone: 'Europe/Moscow' }, 300)
    expect(city.region).toEqual({ code: 'RU', name: '' })
  })
  it('does not construct country evidence from malformed GeoNames country codes', () => {
    const city = createCityPlace({ id: 3, name: 'Unknown', countryCode: 'ru', admin1Code: '73', admin1Name: 'Tatarstan', latitude: 55.75, longitude: 37.62, population: 1, timeZone: 'Europe/Moscow' }, 300)
    expect(city.region).toBeNull()
    expect(city.coverage).toBe('outside')
  })
  it('persists validated GPS nearest-city country metadata without changing the GPS position or timezone', () => {
    const gpsPlace = createGpsPlace(position, 'America/Los_Angeles', null, 'gps:country')
    const city = { id: 9, name: 'Berlin', countryCode: 'DE', admin1Code: '16', admin1Name: 'Berlin', latitude: 55.5, longitude: 49.5, population: 10, timeZone: 'Europe/Berlin' }
    const named = withNearbyCity(gpsPlace, city)
    expect(named).toMatchObject({ ...position, timeZone: 'America/Los_Angeles', nearbyCity: { countryCode: 'DE', latitude: 55.5, longitude: 49.5 } })
    const restored = placeFromChoice({ mode: 'calculated', source: 'automatic', coordinates: named, place: named }, [])
    expect(restored).toMatchObject({ ...position, timeZone: getDeviceTimeZone(), nearbyCity: { countryCode: 'DE' } })
  })
  it('drops malformed or no-longer-near GPS country hints without using city timezone', () => {
    const gpsPlace = createGpsPlace(position, 'UTC', null, 'gps:country')
    const city = { id: 10, name: 'Nearby', countryCode: 'DE', admin1Code: '', admin1Name: '', latitude: 55.5, longitude: 49.5, population: 1, timeZone: 'Europe/Berlin' }
    const named = withNearbyCity(gpsPlace, city)
    const refined = refineGpsPlace(named, { ...position, latitude: 55.501, accuracy: 50, timestamp: 200 }, 'UTC', null)
    expect(refined.nearbyCity?.countryCode).toBe('DE')
    expect(refined.timeZone).toBe('UTC')
    const moved = refineGpsPlace(named, { ...position, latitude: 56, accuracy: 50, timestamp: 300 }, 'UTC', null)
    expect(moved.nearbyCity).toBeUndefined()
    expect(moved.timeZone).toBe('UTC')
    const malformed = placeFromChoice({ mode: 'calculated', source: 'automatic', coordinates: named,
      place: { ...named, nearbyCity: { id: 10, name: named.nearbyCity?.name ?? '', distanceKm: named.nearbyCity?.distanceKm ?? 0,
        countryCode: 'de', latitude: city.latitude, longitude: city.longitude } } }, [])
    expect(malformed?.nearbyCity?.countryCode).toBeUndefined()
    const malformedCoordinates = placeFromChoice({ mode: 'calculated', source: 'automatic', coordinates: named,
      place: { ...named, nearbyCity: { id: 10, name: 'Nearby', distanceKm: 1, countryCode: 'CA', latitude: 300, longitude: 49.5 } } }, [])
    expect(malformedCoordinates?.nearbyCity?.countryCode).toBeUndefined()
    expect(malformedCoordinates?.timeZone).toBe(getDeviceTimeZone())
  })
  it('preserves confirmed saved Tatarstan identity and degrades malformed saved city regions', () => {
    const city = createCityPlace({ id: 4, name: 'Kazan', countryCode: 'RU', admin1Code: '73', admin1Name: 'Tatarstan', latitude: 55.79, longitude: 49.12, population: 1, timeZone: 'Europe/Moscow' }, 300)
    const choice = { mode: 'calculated' as const, source: 'manual' as const, coordinates: city, place: city }
    expect(placeFromChoice(choice, [])?.region?.code).toBe('RU-TA')
    expect(placeFromChoice({ ...choice, place: { ...city, region: { code: 'RU.undefined', name: '' } } }, [])?.region).toBeNull()
  })
  it('refreshes automatic places only after 30 minutes and rejects future timestamps', () => {
    expect(isFreshGpsPlace(gps(), 100 + 29 * 60_000)).toBe(true)
    expect(isFreshGpsPlace(gps(), 100 + 30 * 60_000)).toBe(false)
    expect(isFreshGpsPlace(gps(), 0)).toBe(false)
  })
})
