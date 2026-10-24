import { describe, expect, it } from 'vitest'
import { createCityPlace, createGpsPlace, createLocalityPlace, withNearbyCity } from '../../domain/place'
import { restoreRecentPlaces } from '../../domain/recentPlaces'
import { recentManualDisambiguation, recentManualTitle } from './recentPlaceLabels'

const city = (id: number, region: string, latitude: number, longitude: number, countryCode = 'RU') =>
  createCityPlace({ id, name: 'Киров, Новый', countryCode, admin1Code: countryCode === 'RU' ? '48' : '16',
    admin1Name: region, latitude, longitude, population: 100, timeZone: 'Europe/Moscow' }, id)
const label = (place: ReturnType<typeof city>, visible: ReturnType<typeof city>[]) =>
  recentManualDisambiguation(place, visible, 'ru')

describe('collision-only recent manual labels', () => {
  it('uses actual comma-containing titles and the smallest distinguishing region only for collisions', () => {
    const first = city(101, 'Регион А', 55, 49)
    const second = city(202, 'Регион Б', 56, 48)
    expect(recentManualTitle(first, 'ru')).toBe('Киров, Новый')
    expect(label(first, [first])).toBeNull()
    expect(label(first, [first, second])).toBe('Регион А')
    expect(label(second, [first, second])).toBe('Регион Б')
  })

  it('adds country only when region labels still collide', () => {
    const first = city(1, 'Запад', 55, 49)
    const second = city(2, 'Запад', 56, 48, 'DE')
    expect(label(first, [first, second])).toBe('Запад, РФ')
    expect(label(second, [first, second])).toBe('Запад, Германия')
  })

  it('uses captured place coordinates when region and country cannot distinguish identities', () => {
    const first = city(1, 'Область', 55, 49)
    const second = city(2, 'Область', 56, 48)
    expect(label(first, [first, second])).toBe('Область, РФ · 55.0000, 49.0000')
    expect(label(second, [first, second])).toBe('Область, РФ · 56.0000, 48.0000')
  })

  it('uses stable identity only if all geographic labels and four-decimal coordinates are identical', () => {
    const first = city(1, 'Область', 55, 49)
    const second = city(2, 'Область', 55, 49)
    expect(label(first, [first, second])).toBe('Область, РФ · 55.0000, 49.0000 · geonames:1')
    expect(label(second, [first, second])).toBe('Область, РФ · 55.0000, 49.0000 · geonames:2')
  })

  it('handles collisions across saved catalog cities and manually selected localities', () => {
    const local = createLocalityPlace({ id: 'two', name: 'Киров, Новый', latitude: 55, longitude: 49 }, 100)
    const catalog = city(42, 'Татарстан', 55, 49)
    const rows = restoreRecentPlaces([local, catalog])
    expect(rows).toHaveLength(2)
    const subtitles = rows.map(place => recentManualDisambiguation(place, rows, 'ru'))
    expect(subtitles[0]).toContain('locality:two')
    expect(subtitles[1]).toContain('geonames:42')
  })

  it('ignores named GPS rows, the already filtered active row and different primary titles', () => {
    const a = city(1, 'А', 55, 49)
    const b = city(2, 'Б', 56, 48)
    const gps = withNearbyCity(createGpsPlace({ latitude: 55, longitude: 49, accuracy: 20, timestamp: 1 },
      'Europe/Moscow', null, 'gps:history:one'), { id: 1, name: 'Киров, Новый',
        countryCode: 'RU', admin1Code: '48', admin1Name: 'А', latitude: 55, longitude: 49,
        population: 100, timeZone: 'Europe/Moscow' })
    expect(recentManualDisambiguation(a, [a, gps], 'ru')).toBeNull()
    expect(recentManualDisambiguation(gps, [a, b, gps], 'ru')).toBeNull()
    expect(recentManualDisambiguation(a, [a, b], 'ru')).toBe('А')
    expect(recentManualDisambiguation(a, [a], 'ru')).toBeNull()
  })

  it('retains full legacy manual labels with commas rather than making up a city name', () => {
    const original = city(100, 'Регион, Север', 55, 49)
    const legacy = { ...original, cityName: undefined }
    expect(recentManualTitle(legacy, 'ru')).toBe('Киров, Новый, Регион, Север, Россия')
    expect(recentManualDisambiguation(legacy, [legacy], 'ru')).toBeNull()
  })
})
