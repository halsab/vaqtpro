import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_CALENDAR_PREFERENCES, type CalendarPreferences } from '../../domain/calendar'
import { resolveReligiousBanner, type ReligiousEventId } from '../../domain/religiousEvents'
import { buildScheduleEvents, selectEventPair, type ResolvedScheduleEvent } from '../../domain/scheduleEvents'
import type { CalculatedPrayerKey } from '../../domain/types'
import { Screen } from '../../ui/Screen'
import { ActionButton, ScreenFooter } from '../../ui/controls'
import { ReligiousEventBanner } from '../religiousEvents/ReligiousEventBanner'
import { ScheduleCountdown } from './ScheduleCountdown'
import type { ScheduleError } from './usePrayerSchedules'
import { PROFILE_LABEL_KEYS } from '../../ui/calculationLabels'
import type { DisplaySchedule } from './usePrayerSchedules'
import { useLocalization } from '../../localization'
import { formatLocalizedCalendarFullDate } from '../../localization/calendar'
import { FastingCard } from '../fasting/FastingCard'
import { DEFAULT_FASTING_MODE_PREFERENCES, buildFastingScheduleEvents, type FastingModePreferences, type FastingScheduleEvents } from '../../domain/fasting'
import { useClockCorrection } from '../../ui/useLiveClock'

const LABELS: Record<CalculatedPrayerKey, Parameters<ReturnType<typeof useLocalization>['t']>[0]> = {
  fajr: 'prayerFajr', sunrise: 'prayerSunrise',
  zenith: 'prayerZenith', dhuhr: 'prayerDhuhr', asr: 'prayerAsr', maghrib: 'prayerMaghrib', isha: 'prayerIsha',
}
const COUNTDOWN: Record<CalculatedPrayerKey, Parameters<ReturnType<typeof useLocalization>['t']>[0]> = {
  fajr: 'countdownFajr', sunrise: 'countdownSunrise',
  zenith: 'countdownZenith', dhuhr: 'countdownDhuhr', asr: 'countdownAsr', maghrib: 'countdownMaghrib', isha: 'countdownIsha',
}

function estimated(event: ResolvedScheduleEvent, schedules: DisplaySchedule[]): boolean {
  return schedules.some(day => day.date === event.scheduleDate && day.estimatedPrayers.includes(event.key))
}

function PrayerSchedule({ schedule, current, now, live, calendarPreferences }: {
  schedule: DisplaySchedule; current: ResolvedScheduleEvent | null; now: Date; live: boolean; calendarPreferences: CalendarPreferences
}) {
  const { locale, t } = useLocalization()
  const events = buildScheduleEvents(schedule).sort((left, right) => left.instant - right.instant)
  return <ol className="event-list" aria-label={t('scheduleListLabel')}>
    {events.map(event => {
      const active = live && event.key === current?.key && event.scheduleDate === current.scheduleDate
      const past = live && !active && event.instant <= now.getTime()
      return <li key={event.key} className={`event-row${past ? ' event-past' : ''}${active ? ' event-current' : ''}`} aria-current={active || undefined}>
        <div className="event-name"><span>{t(LABELS[event.key])}</span>
          {event.dayOffset ? <small className="event-day">{formatLocalizedCalendarFullDate(event.date, calendarPreferences, locale)}</small> : null}
        </div>
        <time dateTime={new Date(event.instant).toISOString()}>{estimated(event, [schedule])
          ? <span aria-label={t('estimatedTime')}>{t('estimatedApproximation')} </span> : null}{event.time}</time>
      </li>
    })}
  </ol>
}

interface ScheduleContentProps {
  schedule: DisplaySchedule | null
  schedules: DisplaySchedule[]
  scheduleLoading: boolean
  scheduleError: ScheduleError | null
  contextReady?: boolean
  enrichmentError?: boolean
  onRetryEnrichment?: () => void
  selectedDate: string
  calendarPreferences?: CalendarPreferences
  today: string
  currentTime: Date
  now: () => Date
  hijriSupported?: boolean
  fastingMode?: FastingModePreferences
  fastingModeEnabled?: boolean
  fastingEvents?: FastingScheduleEvents
  timeZone?: string | null | undefined
  onOpenReligiousEvent?: (eventId: ReligiousEventId, origin: HTMLElement) => void
  onChangeDate: (date: string) => void
  onRetrySchedule: () => void
  onSystemClockChange?: () => void
  top?: ReactNode
  actions?: ReactNode
  notice?: ReactNode
}

export function ScheduleContent({ schedule, schedules, scheduleLoading, scheduleError, selectedDate, today,
  contextReady = true, enrichmentError = false, onRetryEnrichment = () => {},
  currentTime, now, hijriSupported = false, fastingMode = DEFAULT_FASTING_MODE_PREFERENCES,
  fastingModeEnabled = false, fastingEvents, timeZone, onOpenReligiousEvent = () => {},
  onChangeDate, onRetrySchedule, onSystemClockChange, top, actions, notice, calendarPreferences = DEFAULT_CALENDAR_PREFERENCES,
}: ScheduleContentProps) {
  const { t } = useLocalization()
  useClockCorrection(true, onSystemClockChange)
  // Обновляет время, если часы изменились, пока экран расписания был размонтирован.
  useEffect(() => { onSystemClockChange?.() }, [onSystemClockChange])
  const [boundary, setBoundary] = useState<{ time: Date; parentTime: number; schedules: DisplaySchedule[] } | null>(null)
  // Граница относится к загруженному набору, а не к предыдущему расписанию.
  const effectiveNow = boundary?.schedules === schedules && boundary.parentTime === currentTime.getTime() ? boundary.time : currentTime
  const onElapsed = useCallback(() => { setBoundary({ time: now(), parentTime: currentTime.getTime(), schedules }) }, [now, currentTime, schedules])
  const events = useMemo(() => schedules.flatMap(buildScheduleEvents), [schedules])
  const fastingScheduleEvents = useMemo(() => fastingEvents ?? buildFastingScheduleEvents(schedules, timeZone), [fastingEvents, schedules, timeZone])
  const ready = !scheduleLoading && !scheduleError && schedule !== null
  const live = selectedDate === today && ready && contextReady
  const { current, next } = live ? selectEventPair(effectiveNow, events) : { current: null, next: null }
  const religiousBanner = resolveReligiousBanner({
    now: effectiveNow,
    today,
    selectedDate,
    correction: calendarPreferences.correction,
    hijriSupported,
    scheduleReady: ready,
    schedules,
  })
  const countdown = next ? <ScheduleCountdown key={`${next.scheduleDate}:${next.key}:${next.instant}`} countdownLabel={t(COUNTDOWN[next.key])}
    targetInstant={next.instant} now={now} onElapsed={onElapsed} /> : null
  const errorMessage = scheduleError
    ? scheduleError.code === 'unsupported-profile'
      ? t('unsupportedProfile', { profile: t(PROFILE_LABEL_KEYS[scheduleError.profile]) })
      : t('scheduleLoadFailed')
    : null
  const footer = <ScreenFooter align="between">
    <span className="screen-footer-lead">{selectedDate !== today ? <ActionButton onClick={() => onChangeDate(today)}>{t('today')}</ActionButton> : countdown}</span>
    {actions}
  </ScreenFooter>
  return <Screen label={t('home')} top={top} bottom={footer} busy={scheduleLoading} contentClassName={ready ? 'home-content' : 'screen-center'}>
    {errorMessage ? <div className="screen-stack"><p className="screen-copy" role="alert">{errorMessage}</p><ActionButton onClick={onRetrySchedule}>{t('retry')}</ActionButton></div>
      : scheduleLoading ? <p className="note" role="status">{t('scheduleLoading')}</p>
        : !schedule ? <p className="screen-copy">{t('scheduleForDate')}</p>
          : <>
            {religiousBanner ? <ReligiousEventBanner state={religiousBanner} onOpen={onOpenReligiousEvent} /> : null}
            <PrayerSchedule schedule={schedule} current={current} now={effectiveNow} live={live} calendarPreferences={calendarPreferences} />
            {enrichmentError ? <div className="screen-status" role="alert">
              <span>{t(contextReady ? 'cachedScheduleContextUnavailable' : 'scheduleContextUnavailable')}</span>
              <ActionButton onClick={onRetryEnrichment}>{t('retry')}</ActionButton>
            </div> : null}
            {live && fastingModeEnabled && timeZone ? <FastingCard events={fastingScheduleEvents} preferences={fastingMode}
              selectedDate={selectedDate} today={today} timeZone={timeZone} correction={calendarPreferences.correction}
              hijriSupported={hijriSupported} now={now} /> : null}
            {schedule.estimatedPrayers.length > 0 ? <p className="note screen-space">{t('estimatedByHighLatitude')}</p> : null}
            {live && !next ? <p className="note screen-space">{t('nextEventUnavailable')}</p> : null}
          </>}
    {notice}
  </Screen>
}
