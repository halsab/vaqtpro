import { expect, it } from 'vitest'
import { selectTranslation } from './RecitationArticle'

const source = 'Мәгънәсе: татарча\n\nПеревод: по-русски'

it('selects only the translation matching the active locale and hides unsupported locales', () => {
  expect(selectTranslation(source, 'ru')).toEqual({ locale: 'ru', text: 'по-русски' })
  expect(selectTranslation(source, 'tt')).toEqual({ locale: 'tt-Cyrl', text: 'татарча' })
  expect(selectTranslation(source, 'en')).toBeNull()
  expect(selectTranslation('no translation', 'ru')).toBeNull()
})
