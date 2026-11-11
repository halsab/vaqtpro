import { addDays } from '../../domain/date'
import type { ReligiousEventOccurrence } from '../../domain/religiousEvents'
import type { SupportedLocale } from '../../localization'
import {
  formatLocalizedGregorianDate,
  formatLocalizedGregorianNightRange,
  formatLocalizedHijriMonth,
} from '../../localization/calendar'

export function formatReligiousEventOccurrenceDate(occurrence: ReligiousEventOccurrence, locale: SupportedLocale = 'ru'): string {
  const gregorian = occurrence.kind === 'night'
    ? formatLocalizedGregorianNightRange(occurrence.civilDate, addDays(occurrence.civilDate, -1), locale)
    : formatLocalizedGregorianDate(occurrence.civilDate, locale)
  const hijriMonth = formatLocalizedHijriMonth(occurrence.hijriDate.month, locale)
  const hijri = `${occurrence.hijriDate.day} \u2068${hijriMonth}\u2069 ${occurrence.hijriDate.year}`
  return `${gregorian} · ${hijri}`
}
