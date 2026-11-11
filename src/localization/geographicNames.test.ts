import { expect, it } from 'vitest'
import { localizedGeographicName } from './geographicNames'

it('localizes verified settlement identities and preserves original names when no verified name exists', () => {
  expect(localizedGeographicName(524901, 'Moscow', 'ru')).toBe('Москва')
  expect(localizedGeographicName(551487, 'Kazan', 'ru')).toBe('Казань')
  expect(localizedGeographicName(756135, 'Warsaw', 'ru')).toBe('Варшава')
  expect(localizedGeographicName(2643743, 'London', 'ru')).toBe('Лондон')
  expect(localizedGeographicName(1, 'Łódź', 'ru')).toBe('Łódź')
})
