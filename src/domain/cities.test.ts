import { describe, expect, it } from 'vitest'

import {
  findNearestCity,
  formatCityLabel,
  searchCities,
  type CityDataset,
  type CompactCityRecord,
} from './cities'

const records: CompactCityRecord[] = [
  [
    745044,
    'Стамбул',
    ['стамбул', 'istanbul', 'истанбул'],
    'TR',
    '34',
    41.0138,
    28.9497,
    15_701_602,
    'Europe/Istanbul',
    'Стамбул',
    'турция',
    'PPL',
  ],
  [
    524901,
    'Москва',
    ['москва', 'moscow'],
    'RU',
    '48',
    55.7522,
    37.6156,
    10_381_222,
    'Europe/Moscow',
    'Москва',
    'россия',
    'PPL',
  ],
  [
    323786,
    'Анкара',
    ['анкара', 'ankara'],
    'TR',
    '68',
    39.9199,
    32.8543,
    5_504_000,
    'Europe/Istanbul',
    'Стамбул',
    'турция',
    'PPL',
  ],
  [
    551487,
    'Казань',
    ['казань', 'kazan'],
    'RU',
    '73',
    55.7887,
    49.1221,
    1_243_500,
    'Europe/Moscow',
    'Москва',
    'россия',
    'PPL',
  ],
]

const dataset: CityDataset = {
  source: {
    name: 'GeoNames',
    url: 'https://www.geonames.org/',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    updatedAt: '2026-09-01',
  },
  cities: records,
}

describe('findNearestCity', () => {
  it('находит и материализует ближайший город в допустимом радиусе', () => {
    expect(findNearestCity(55.7558, 37.6173, records, 30)).toEqual({
      id: 524901,
      name: 'Москва',
      countryCode: 'RU',
      admin1Code: '48',
      admin1Name: 'Москва',
      latitude: 55.7522,
      longitude: 37.6156,
      population: 10_381_222,
      timeZone: 'Europe/Moscow',
      featureCode: 'PPL',
    })
  })

  it('не подставляет название далёкого города', () => {
    expect(findNearestCity(55, 35, records, 30)).toBeNull()
  })
})

describe('searchCities', () => {
  it('ищет по готовому ключу и возвращает русское имя с admin1', () => {
    expect(searchCities(dataset, 'Стамбул')).toEqual([
      {
        id: 745044,
        name: 'Стамбул',
        countryCode: 'TR',
        admin1Code: '34',
        admin1Name: 'Стамбул',
        latitude: 41.0138,
        longitude: 28.9497,
        population: 15_701_602,
        timeZone: 'Europe/Istanbul',
        featureCode: 'PPL',
      },
    ])
    expect(searchCities(dataset, 'Istanbul').map(({ id }) => id)).toEqual([
      745044,
    ])
    expect(searchCities(dataset, 'Турция').map(({ id }) => id)).toEqual([
      745044,
      323786,
    ])
  })

})

it('includes the district in persistent place context for rural results', () => {
  const place = {
    id: 77, name: 'Облово', countryCode: 'RU', admin1Code: '69',
    admin1Name: 'Тверская область', admin2Name: 'Торжокский район',
    latitude: 57, longitude: 34, population: 25, timeZone: 'Europe/Moscow',
  }
  expect(formatCityLabel(place)).toBe('Облово, Торжокский район, Тверская область, Россия')
})
