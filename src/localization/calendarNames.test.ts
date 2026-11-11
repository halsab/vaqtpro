import { expect, it } from 'vitest'
import { calendarDateFromCivil } from '../domain/calendar'
import { formatLocalizedHijriDate, formatLocalizedHijriMonth, HIJRI_MONTH_NAMES_ARABIC } from './calendar'

it('keeps every Hijri month in its canonical Arabic form regardless of locale or compact display', () => {
  expect(HIJRI_MONTH_NAMES_ARABIC).toEqual([
    'محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة',
    'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة',
  ])
  for (const [index, name] of HIJRI_MONTH_NAMES_ARABIC.entries()) {
    expect(formatLocalizedHijriMonth(index + 1)).toBe(name)
  }
})

it('isolates the Arabic Hijri month inside a mixed-direction date', () => {
  const preferences = { calendar: 'hijri' as const, correction: 0 as const }
  const date = '2026-03-20'
  const parts = calendarDateFromCivil(date, 'hijri', 0)
  const month = HIJRI_MONTH_NAMES_ARABIC[parts.month - 1]
  expect(formatLocalizedHijriDate(date, preferences)).toBe(`${parts.day} \u2068${month}\u2069 ${parts.year}`)
})
