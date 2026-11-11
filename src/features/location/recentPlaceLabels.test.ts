import { expect, it } from 'vitest'
import { createCityPlace } from '../../domain/place'
import { recentManualTitle } from './recentPlaceLabels'

it('preserves a stored GeoNames provider name when presenting a saved place', () => {
  const place = createCityPlace({
    id: 524901,
    name: 'Москва у реки',
    countryCode: 'RU',
    admin1Code: 'MOW',
    admin1Name: 'Москва',
    latitude: 55.7522,
    longitude: 37.6156,
    population: 100,
    timeZone: 'Europe/Moscow',
    featureCode: 'PPL',
  }, 0)
  expect(recentManualTitle(place, 'ru')).toBe('Москва у реки')
})
