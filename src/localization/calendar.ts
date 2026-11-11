import {
  calendarDateFromCivil,
  type CalendarKind,
  type CalendarPreferences,
} from '../domain/calendar'
import { formatLocaleDate } from './formatters'
import { translate, type MessageKey, type Translator } from './messages'
import type { SupportedLocale } from './locale'

const GREGORIAN_MONTH_KEYS = [
  'monthJanuary', 'monthFebruary', 'monthMarch', 'monthApril', 'monthMay', 'monthJune',
  'monthJuly', 'monthAugust', 'monthSeptember', 'monthOctober', 'monthNovember', 'monthDecember',
] as const satisfies readonly MessageKey[]

export const HIJRI_MONTH_NAMES_ARABIC = Object.freeze([
  'محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة',
  'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة',
] as const)

export function calendarMonthLabels(t: Translator, calendar: CalendarKind, locale: SupportedLocale = 'ru'): string[] {
  if (calendar === 'hijri') return [...HIJRI_MONTH_NAMES_ARABIC]
  const keys = GREGORIAN_MONTH_KEYS
  return keys.map(key => {
    const label = t(key)
    return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1)
  })
}

export function formatLocalizedCalendarDate(
  date: string,
  preferences: CalendarPreferences,
  locale: SupportedLocale = 'ru',
): string {
  if (preferences.calendar === 'gregorian') {
    return formatLocaleDate(date, locale, { day: 'numeric', month: 'long' })
  }
  const parts = calendarDateFromCivil(date, 'hijri', preferences.correction)
  const month = formatLocalizedHijriMonth(parts.month, locale, true)
  return month ? `${parts.day} \u2068${month}\u2069` : String(parts.day)
}

export function formatLocalizedCalendarFullDate(
  date: string,
  preferences: CalendarPreferences,
  locale: SupportedLocale = 'ru',
): string {
  if (preferences.calendar === 'gregorian') {
    return formatLocaleDate(date, locale, { day: 'numeric', month: 'long' })
  }
  const parts = calendarDateFromCivil(date, 'hijri', preferences.correction)
  const month = formatLocalizedHijriMonth(parts.month, locale)
  return month ? `${parts.day} \u2068${month}\u2069` : String(parts.day)
}

export function formatLocalizedHijriDate(
  date: string,
  preferences: CalendarPreferences,
  locale: SupportedLocale = 'ru',
): string {
  const parts = calendarDateFromCivil(date, 'hijri', preferences.correction)
  const month = formatLocalizedHijriMonth(parts.month, locale)
  return month ? `${parts.day} \u2068${month}\u2069 ${parts.year}` : `${parts.day} ${parts.year}`
}

export function formatLocalizedGregorianDate(
  date: string,
  locale: string = 'ru',
): string {
  const parts = new Intl.DateTimeFormat(locale, {
    calendar: 'gregory', timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric',
  }).formatToParts(new Date(`${date}T12:00:00.000Z`))
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? ''
  return `${value('day')} ${value('month')} ${value('year')}`
}

export function formatLocalizedGregorianNightRange(
  targetDate: string,
  previousDate: string,
  locale: string = 'ru',
): string {
  const dateParts = (date: string) => {
    const parts = new Intl.DateTimeFormat(locale, {
      calendar: 'gregory', timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric',
    }).formatToParts(new Date(`${date}T12:00:00.000Z`))
    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? ''
    return { day: value('day'), month: value('month'), year: value('year') }
  }
  const previous = dateParts(previousDate)
  const target = dateParts(targetDate)
  if (previous.year !== target.year) return `${previous.day} ${previous.month} ${previous.year} – ${target.day} ${target.month} ${target.year}`
  if (previous.month !== target.month) return `${previous.day} ${previous.month} – ${target.day} ${target.month} ${target.year}`
  return `${previous.day}–${target.day} ${target.month} ${target.year}`
}

export function formatLocalizedHijriMonth(
  month: number,
  locale: SupportedLocale = 'ru',
  compact = false,
): string {
  void locale
  const name = HIJRI_MONTH_NAMES_ARABIC[month - 1]
  if (!name) return ''
  if (!compact || name.length <= 9) return name
  return name
}
