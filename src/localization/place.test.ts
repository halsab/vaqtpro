import { expect, it } from 'vitest'
import { createTranslator } from './messages'
import { localizedCityLabel } from './place'

it('exposes distinct administrative districts to screen readers', () => {
  const t = createTranslator('ru')
  const city = { id: 1, name: 'Облово', countryCode: 'RU', admin1Code: '69',
    admin1Name: 'Тверская область', admin2Name: 'Торжокский район',
    latitude: 57, longitude: 34, population: 25, timeZone: 'Europe/Moscow' }
  expect(localizedCityLabel(city, false, 'ru', t))
    .toBe('Облово, Торжокский район, Тверская область, Россия')
})
