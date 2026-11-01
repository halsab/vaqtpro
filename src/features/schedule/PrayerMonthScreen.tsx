import { useMemo, useState } from 'react'

import { civilMonthDates, shiftCivilMonth } from '../../domain/civilMonth'
import { homePlaceLabel, type Place } from '../../domain/place'
import { calculatePrayerSchedule } from '../../domain/prayerCalculation'
import type { ScheduleContext } from '../../domain/scheduleContext'
import { ASR_METHOD_KEYS, HIGH_LATITUDE_KEYS, PROFILE_LABEL_KEYS } from '../../ui/calculationLabels'
import { useLocalization } from '../../localization'
import { ActionButton } from '../../ui/controls'
import { BackButton, Screen } from '../../ui/Screen'
import { PrayerMonthTable, PRAYER_MONTH_KEYS } from './PrayerMonthTable'
import { PrayerMonthView } from './PrayerMonthView'
import { MonthlyExportAction } from './MonthlyExportAction'
import { SCHEDULE_EVENT_LABEL_KEYS } from './scheduleEventLabels'
import type { ScheduleError } from './usePrayerSchedules'

function monthLabel(firstDate: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .formatToParts(new Date(`${firstDate}T12:00:00.000Z`))
    .filter(part => part.type === 'month' || part.type === 'year').map(part => part.value).join(' ')
}

export function PrayerMonthScreen({ place, context, scheduleError, selectedDate, onBack, onOpenLocation, onRetrySchedule }: {
  place: Place | null
  context: ScheduleContext | null
  scheduleError: ScheduleError | null
  selectedDate: string
  onBack: () => void
  onOpenLocation: () => void
  onRetrySchedule: () => void
}) {
  const { locale, t } = useLocalization()
  const [month, setMonth] = useState(() => civilMonthDates(selectedDate)[0] ?? selectedDate)
  const [calculationRetry, setCalculationRetry] = useState(0)
  // Токен делает новый вход для useMemo при явном повторе расчёта того же месяца.
  const monthInput = useMemo(() => ({ dates: civilMonthDates(month), calculationRetry }), [month, calculationRetry])
  const monthSchedules = useMemo(() => context
    ? monthInput.dates.map(date => {
      try {
        return { date, schedule: calculatePrayerSchedule(context.location, date, context.timeZone, context.settings) }
      } catch {
        return { date, schedule: null }
      }
    })
    : [], [context, monthInput])
  const failedDateCount = monthSchedules.reduce((count, entry) => count + (entry.schedule ? 0 : 1), 0)
  const allDatesFailed = context !== null && monthSchedules.length > 0 && failedDateCount === monthSchedules.length
  const currentMonthLabel = monthLabel(month, locale)
  const { eventLabels, exportLabels } = useMemo(() => {
    const eventLabels = Object.fromEntries(PRAYER_MONTH_KEYS.map(key => [key, t(SCHEDULE_EVENT_LABEL_KEYS[key])])) as Record<(typeof PRAYER_MONTH_KEYS)[number], string>
    return { eventLabels, exportLabels: {
      ...eventLabels,
      exportDay: t('exportDay'), exportBrandSubtitle: t('exportBrandSubtitle'),
      exportSourcePrefix: t('exportSourcePrefix'), exportSourceUrl: t('exportSourceUrl'),
      weekdaySundayShort: t('weekdaySundayShort'), weekdayMondayShort: t('weekdayMondayShort'),
      weekdayTuesdayShort: t('weekdayTuesdayShort'), weekdayWednesdayShort: t('weekdayWednesdayShort'),
      weekdayThursdayShort: t('weekdayThursdayShort'), weekdayFridayShort: t('weekdayFridayShort'),
      weekdaySaturdayShort: t('weekdaySaturdayShort'),
    } }
  }, [t])
  const weekdayLabels = [t('weekdaySundayShort'), t('weekdayMondayShort'), t('weekdayTuesdayShort'),
    t('weekdayWednesdayShort'), t('weekdayThursdayShort'), t('weekdayFridayShort'), t('weekdaySaturdayShort')]
  const exportSnapshot = useMemo(() => context ? {
    month: month.slice(0, 7),
    location: homePlaceLabel(place, t('locationUnknown')),
    rows: monthSchedules,
  } : null, [context, month, monthSchedules, place, t])
  const error = scheduleError?.code === 'unsupported-profile'
    ? t('unsupportedProfile', { profile: t(PROFILE_LABEL_KEYS[scheduleError.profile]) })
    : null
  const loadFailedWithoutContext = context === null && scheduleError?.code === 'load-failed'
  const retryMonthlyCalculation = () => {
    setCalculationRetry(value => value + 1)
    onRetrySchedule()
  }

  return <Screen label={t('monthlySchedule')} contentClassName="prayer-month-content" top={<div className="monthly-screen-navigation">
    <BackButton onClick={onBack} />
    <MonthlyExportAction snapshot={exportSnapshot} labels={exportLabels} />
  </div>}>
    <PrayerMonthView monthLabel={currentMonthLabel}
      previousMonthLabel={t('previousMonth')} nextMonthLabel={t('nextMonth')}
      onPreviousMonth={() => setMonth(value => shiftCivilMonth(value, -1))}
      onNextMonth={() => setMonth(value => shiftCivilMonth(value, 1))}
      locationLabel={homePlaceLabel(place, t('locationUnknown'))}
      calculationProfileLabel={context ? t('calculationProfile') : undefined}
      profileLabel={context ? t(PROFILE_LABEL_KEYS[context.settings.profile]) : undefined}
      methodology={context ? <>
        <p>{t('monthlyCalculationSummary')}</p>
        <p>{t('asrMethod')}: {t(ASR_METHOD_KEYS[context.settings.asrMethod])}.</p>
        <p>{t('highLatitudeRule')}: {t(HIGH_LATITUDE_KEYS[context.settings.highLatitudeRule])}.</p>
      </> : undefined}>
      {error ? <p className="screen-copy" role="alert">{error}</p>
        : allDatesFailed ? <div className="screen-stack">
          <p className="screen-copy" role="alert">{t('monthlyCalculationFailed')}</p>
          <ActionButton onClick={retryMonthlyCalculation}>{t('retry')}</ActionButton>
        </div>
        : loadFailedWithoutContext ? <div className="screen-stack">
          <p className="screen-copy" role="alert">{t('scheduleLoadFailed')}</p>
          <ActionButton onClick={onRetrySchedule}>{t('retry')}</ActionButton>
        </div>
        : context ? <PrayerMonthTable rows={monthSchedules} labels={eventLabels} weekdayLabels={weekdayLabels} dateLabel={t('dateLabel')}
          tableLabel={t('monthlyScheduleTableLabel')} />
          : <div className="screen-stack">
            <p className="screen-copy">{t('noSchedulePlace')}</p>
            <ActionButton onClick={onOpenLocation}>{t('location')}</ActionButton>
          </div>}
    </PrayerMonthView>
  </Screen>
}
