import { describe, expect, it } from 'vitest'
import { required } from '../test/required'
import { createCityPlace, createLocalityPlace, createGpsPlace } from './place'
import { migrateRecentPlaces, rememberPlace, restoreRecentPlaces } from './recentPlaces'

const locality = (id: string, longitude = 49) => createLocalityPlace({ id, name: id, latitude: 55, longitude }, 10)
const city = (id: number, longitude = 49) => createCityPlace({ id, name: 'Одинаковое имя', countryCode: 'RU', admin1Code: '73', admin1Name: 'Татарстан', latitude: 55, longitude, population: 1, timeZone: 'Europe/Moscow' }, 10)
const gps = (latitude: number, longitude: number, timestamp: number, name = '', accuracy = 20) => ({
  ...createGpsPlace({ latitude, longitude, accuracy, timestamp }, 'Europe/Moscow', null, `gps:operation:${timestamp}`), name,
})

describe('recentPlaces', () => {
  it('promotes one city or locality identity and preserves equal labels with distinct IDs and types', () => {
    const existing = [locality('b'), city(1), locality('a')]
    expect(rememberPlace(existing, locality('b')).map(place => place.id)).toEqual(['locality:b', 'geonames:1', 'locality:a'])
    const sameLabel = rememberPlace([locality('same')], city(9))
    expect(sameLabel.map(place => place.id)).toEqual(['geonames:9', 'locality:same'])
  })

  it('groups GPS only within 500m and chooses the nearest match before recency', () => {
    const a = required(restoreRecentPlaces([gps(55, 49, 1, 'Казань')])[0])
    const b = gps(55, 49.004, 2, 'Казань')
    const updated = rememberPlace([a], b)
    expect(updated).toHaveLength(1)
    expect(updated[0]).toMatchObject({ id: a.id, longitude: b.longitude, timestamp: 2 })
    expect(restoreRecentPlaces(updated)[0]?.id).toBe(a.id)
    const distant = gps(55, 49.02, 3, 'Казань')
    expect(rememberPlace(updated, distant)).toHaveLength(2)
  })





  it('restores current place first, drops invalid/duplicate rows and is idempotent', () => {
    const current = gps(55, 49, 100)
    const recents = migrateRecentPlaces([null, {}, gps(55, 49.001, 90), locality('a'), locality('a')], current)
    expect(recents.map(place => place.selection === 'gps' ? 'gps' : place.id)).toEqual(['gps', 'locality:a'])
    expect(restoreRecentPlaces(recents)).toEqual(recents)
    expect(restoreRecentPlaces('corrupted')).toEqual([])
  })



  it('adds a missing current place once and keeps it inside the ten-entry cap', () => {
    const current = locality('current')
    const migrated = migrateRecentPlaces(Array.from({ length: 10 }, (_, index) => locality(String(index))), current)
    expect(migrated).toHaveLength(10)
    expect(migrated[0]?.id).toBe('locality:current')
    expect(migrated.some(place => place.id === 'locality:9')).toBe(false)
  })






  it('keeps ten distinct places and evicts only the oldest on an eleventh selection', () => {
    let places = Array.from({ length: 10 }, (_, index) => locality(String(index)))
    places = rememberPlace(places, locality('10'))
    expect(places).toHaveLength(10)
    expect(places.map(place => place.id)).toEqual(['locality:10', ...Array.from({ length: 9 }, (_, i) => `locality:${i}`)])
  })

})
