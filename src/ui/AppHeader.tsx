import type { RefObject } from 'react'
import type { CalendarPreferences } from '../domain/calendar'
import { ActionButton } from './controls'
import { useLocalization } from '../localization'
import { formatLocalizedCalendarDate, formatLocalizedHijriDate } from '../localization/calendar'
import { markArabicText } from './ArabicText'

export function AppHeader({ locationButtonRef, locationLabel, locationTime, selectedDate, calendarPreferences, onOpenLocation, onOpenDate }: {
  locationButtonRef: RefObject<HTMLButtonElement | null>
  locationLabel: string
  locationTime?: string | undefined
  selectedDate: string
  calendarPreferences: CalendarPreferences
  onOpenLocation: () => void
  onOpenDate: () => void
}) {
  const { locale, t } = useLocalization()
  const fullHijriDate = calendarPreferences.calendar === 'hijri'
    ? formatLocalizedHijriDate(selectedDate, calendarPreferences)
    : null
  return <>
    <ActionButton ref={locationButtonRef} id="home-location" className="home-location" onClick={onOpenLocation}
      aria-label={locationTime ? `${locationLabel} ${locationTime}` : undefined}>
      <span className="home-location-name">{markArabicText(locationLabel)}</span>
      {locationTime ? <span className="home-location-time">{locationTime}</span> : null}
    </ActionButton>
    <ActionButton id="home-date" aria-label={t('chooseDate')} aria-describedby={fullHijriDate ? 'home-date-description' : 'home-date-value'} onClick={onOpenDate}>
      <time id="home-date-value" dateTime={selectedDate} aria-hidden={fullHijriDate ? 'true' : undefined}>{markArabicText(formatLocalizedCalendarDate(selectedDate, calendarPreferences, locale))}</time>
      {fullHijriDate ? <span id="home-date-description" className="sr-only">{fullHijriDate}</span> : null}
    </ActionButton>
  </>
}
