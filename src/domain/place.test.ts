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
  it('uses the current device timezone after GPS refinement, including inside official coverage', () => {
    const refined = refineGpsPlace(gps(), { ...position, accuracy: 10, timestamp: 200 }, 'Asia/Tokyo', geometry)
    expect(refined.timeZone).toBe('Asia/Tokyo')
  })
  it('preserves confirmed saved Tatarstan identity and degrades malformed saved city regions', () => {
    const city = createCityPlace({ id: 4, name: 'Kazan', countryCode: 'RU', admin1Code: '73', admin1Name: 'Tatarstan', latitude: 55.79, longitude: 49.12, population: 1, timeZone: 'Europe/Moscow' }, 300)
    const choice = { mode: 'calculated' as const, source: 'manual' as const, coordinates: city, place: city }
    expect(placeFromChoice(choice, [])?.region?.code).toBe('RU-TA')
    expect(placeFromChoice({ ...choice, place: { ...city, region: { code: 'RU.undefined', name: '' } } }, [])?.region).toBeNull()
  })
})

it('retains a detailed populated-place type through offline persistence', () => {
  const city = createCityPlace({
    id: 12345, name: 'Село', countryCode: 'RU', admin1Code: '73',
    admin1Name: 'Татарстан', latitude: 55.1, longitude: 49.1, population: 300,
    timeZone: 'Europe/Moscow', featureCode: 'PPLX',
  }, 123)
  expect(city.featureCode).toBe('PPLX')
  const saved = placeFromChoice({ mode: 'calculated', source: 'manual', coordinates: city, place: city }, [])
  expect(saved).toMatchObject({ id: 'geonames:12345', featureCode: 'PPLX', latitude: 55.1, longitude: 49.1 })
})
