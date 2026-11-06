import { describe, expect, it } from 'vitest'

import type { Locality } from './types'
import {
  findNearestLocation,
  haversineDistanceKm,
  isConfirmedTatarstan,
} from './location'

const locations: Locality[] = [
  { id: 'kazan', name: 'Казань', latitude: 55.7961, longitude: 49.1064 },
  {
    id: 'naberezhnye-chelny',
    name: 'Набережные Челны',
    latitude: 55.7436,
    longitude: 52.3958,
  },
]

describe('haversineDistanceKm', () => {
  it('даёт нулевое расстояние для одной точки', () => {
    expect(haversineDistanceKm(55.7961, 49.1064, 55.7961, 49.1064)).toBe(0)
  })
})

describe('findNearestLocation', () => {
  it('выбирает ближайший официальный населённый пункт', () => {
    expect(findNearestLocation(55.8, 49.12, locations)?.id).toBe('kazan')
  })

  it('после подтверждения региона выбирает ближайшее расписание без условного радиуса', () => {
    expect(findNearestLocation(55.7558, 37.6173, locations)?.id).toBe('kazan')
    expect(findNearestLocation(55.7558, 37.6173, [])).toBeNull()
  })
})

describe('isConfirmedTatarstan', () => {
  it('принимает проверенный код 73 или GeoNames ID Татарстана для России', () => {
    expect(isConfirmedTatarstan({
      source: 'geonames',
      countryCode: 'RU',
      admin1Code: '73',
    })).toBe(true)
    expect(isConfirmedTatarstan({
      source: 'geonames',
      countryCode: 'RU',
      admin1Id: 484048,
    })).toBe(true)
    expect(isConfirmedTatarstan({
      source: 'geonames',
      countryCode: 'RU',
      admin1Code: '77',
    })).toBe(false)
    expect(isConfirmedTatarstan({
      source: 'geonames',
      countryCode: 'TR',
      admin1Code: '73',
    })).toBe(false)
    expect(isConfirmedTatarstan({
      source: 'geonames',
      countryCode: 'TR',
      admin1Id: 484048,
    })).toBe(false)
  })

})
