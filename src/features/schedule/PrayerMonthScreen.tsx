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
import type { ScheduleError } from './usePrayerSchedules'

const PRAYER_LABEL_KEYS = {
  fajr: 'prayerFajr',
  sunrise: 'prayerSunrise',
  dhuhr: 'prayerDhuhr',
  asr: 'prayerAsr',
  maghrib: 'prayerMaghrib',
  isha: 'prayerIsha',
} as const

function monthLabel(firstDate: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .formatToParts(new Date(`${firstDate}T12:00:00.000Z`))
    .filter(part => part.type === 'month' || part.type === 'year').map(part => part.value).join(' ')
}

export function PrayerMonthScreen({ place, context, scheduleError, selectedDate, onBack, onOpenLocation }: {
  place: Place | null
  context: ScheduleContext | null
  scheduleError: ScheduleError | null
  selectedDate: string
  onBack: () => void
  onOpenLocation: () => void
}) {
  const { locale, t } = useLocalization()
  const [month, setMonth] = useState(() => civilMonthDates(selectedDate)[0] ?? selectedDate)
  const dates = useMemo(() => civilMonthDates(month), [month])
  const monthSchedules = useMemo(() => context
    ? dates.map(date => {
      try {
        return { date, schedule: calculatePrayerSchedule(context.location, date, context.timeZone, context.settings) }
      } catch {
        return { date, schedule: null }
      }
    })
    : [], [context, dates])
  const currentMonthLabel = monthLabel(month, locale)
  const labels = Object.fromEntries(PRAYER_MONTH_KEYS.map(key => [key, t(PRAYER_LABEL_KEYS[key])])) as Record<(typeof PRAYER_MONTH_KEYS)[number], string>
  const error = scheduleError?.code === 'unsupported-profile'
    ? t('unsupportedProfile', { profile: t(PROFILE_LABEL_KEYS[scheduleError.profile]) })
    : null

  return <Screen label={t('monthlySchedule')} top={<BackButton onClick={onBack} />}>
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
        : context ? <PrayerMonthTable rows={monthSchedules} labels={labels} dateLabel={t('dateLabel')}
          tableLabel={t('monthlyScheduleTableLabel')} />
          : <div className="screen-stack">
            <p className="screen-copy">{t('noSchedulePlace')}</p>
            <ActionButton onClick={onOpenLocation}>{t('location')}</ActionButton>
          </div>}
    </PrayerMonthView>
  </Screen>
}
