import { expect, it } from 'vitest'
import { formatLocalizedHijriMonth, HIJRI_MONTH_NAMES_ARABIC } from './calendar'

it('keeps every Hijri month in its canonical Arabic form regardless of locale or compact display', () => {
  expect(HIJRI_MONTH_NAMES_ARABIC).toEqual([
    'محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة',
    'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة',
  ])
  for (const [index, name] of HIJRI_MONTH_NAMES_ARABIC.entries()) {
    expect(formatLocalizedHijriMonth(index + 1, 'ru')).toBe(name)
    expect(formatLocalizedHijriMonth(index + 1, 'ru', true)).toBe(name)
  }
})
