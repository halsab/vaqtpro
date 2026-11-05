import { addDays } from '../../domain/date'
import { fastingProgress, resolveFastingTimeline, type FastingModePreferences, type FastingScheduleEvents } from '../../domain/fasting'
import { getCivilDate } from '../../domain/locationTime'
import { formatLocalizedGregorianDate } from '../../localization/calendar'
import { formatClockTime } from '../../localization/formatters'
import { formatRemainingDuration } from '../../localization/countdown'
import { useLocalization } from '../../localization'
import { useLiveClock } from '../../ui/useLiveClock'

function formatDuration(start: number, end: number, t: ReturnType<typeof useLocalization>['t']): string {
  const totalMinutes = Math.max(0, Math.round((end - start) / 60_000))
  return t('fastingDuration', { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 })
}

function relativeDate(date: string, today: string, locale: string, t: ReturnType<typeof useLocalization>['t']): string {
  if (date === today) return t('relativeToday')
  if (date === addDays(today, -1)) return t('relativeYesterday')
  if (date === addDays(today, 1)) return t('relativeTomorrow')
  return formatLocalizedGregorianDate(date, locale)
}

interface FastingEndpointData {
  prefix: string
  dateLabel?: string | undefined
  time: string
  compact: string
}

function FastingEndpoint({ prefix, dateLabel, time, compact }: FastingEndpointData) {
  const full = `${prefix}${dateLabel ? ` ${dateLabel}` : ''} ${time}`
  return <span className="fasting-endpoint">
    <span className="fasting-endpoint-long" aria-hidden="true">{full}</span>
    <span className="fasting-endpoint-compact" aria-hidden="true">{compact} {time}</span>
    <span className="sr-only">{full}</span>
  </span>
}

export function FastingCard({ events, preferences, selectedDate, today, timeZone, correction, hijriSupported, now, onOpen }: {
  events: FastingScheduleEvents
  preferences: FastingModePreferences
  selectedDate: string
  today: string
  timeZone: string
  correction: -1 | 0 | 1
  hijriSupported: boolean
  now: () => Date
  onOpen?: () => void
}) {
  const { locale, t } = useLocalization()
  const currentTime = now()
  const hasValidNow = Number.isFinite(currentTime.getTime())
  const timeline = hasValidNow ? resolveFastingTimeline({
    now: currentTime,
    today,
    selectedDate,
    timeZone,
    correction,
    hijriSupported,
    preferences,
    events,
  }) : null
  useLiveClock(timeline !== null)

  if (!timeline) return null

  const nowInstant = currentTime.getTime()
  const progress = fastingProgress(timeline, nowInstant)
  const progressPercent = Math.round(progress * 100)
  const todayInSourceZone = getCivilDate(currentTime, timeZone)
  const endTime = formatClockTime(timeline.end.instant, timeZone, locale)
  const startTime = formatClockTime(timeline.start.instant, timeZone, locale)
  const daytime = timeline.kind === 'day'
  const countdownLabel = t(daytime ? 'fastingUntilEnd' : 'fastingUntilStart')
  const countdown = formatRemainingDuration(timeline.end.instant - nowInstant, t)
  if (!countdown) return null
  const endRelative = daytime ? undefined : relativeDate(timeline.start.date, todayInSourceZone, locale, t)
  const startRelative = daytime ? undefined : relativeDate(timeline.end.date, todayInSourceZone, locale, t)
  const endPrefix = t('fastingEnd')
  const startPrefix = t('fastingStart')
  const duration = daytime ? formatDuration(timeline.start.instant, timeline.end.instant, t) : null
  const progressLabel = t(daytime ? 'fastingDayProgress' : 'fastingNightProgress')
  const endpoints: [FastingEndpointData, FastingEndpointData] = daytime
    ? [
      { prefix: startPrefix, dateLabel: undefined, time: startTime, compact: startPrefix },
      { prefix: endPrefix, dateLabel: undefined, time: endTime, compact: endPrefix },
    ]
    : [
      { prefix: endPrefix, dateLabel: endRelative, time: startTime, compact: endRelative ?? endPrefix },
      { prefix: startPrefix, dateLabel: startRelative, time: endTime, compact: startRelative ?? startPrefix },
    ]
  const describe = (endpoint: FastingEndpointData) => `${endpoint.prefix}${endpoint.dateLabel ? ` ${endpoint.dateLabel}` : ''} ${endpoint.time}`
  const [firstEndpoint, secondEndpoint] = endpoints
  const endpointsDescription = t('fastingEndpointsDescription', { first: describe(firstEndpoint), second: describe(secondEndpoint) })

  return <button className="fasting-card" type="button" aria-label={t('fastingTitle')} onClick={onOpen}>
    <span className="fasting-card-heading">
      <span>{t('fastingTitle')}</span>
      {duration ? <span className="fasting-duration">{duration}</span> : null}
    </span>
    <span className="fasting-card-countdown">
      <span className="fasting-card-label">{countdownLabel}</span>
      <time className="fasting-card-timer" role="timer" aria-live="off" aria-label={t('countdownAria', { label: countdownLabel, remaining: countdown })}>
        {countdown}
      </time>
    </span>
    <span className="fasting-progress" role="progressbar" aria-label={progressLabel} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={progressPercent} aria-valuetext={t('fastingProgressPercent', { percent: progressPercent })}>
      <span className="fasting-progress-fill" style={{ width: `${progress * 100}%` }} />
    </span>
    <span className="fasting-endpoints" role="group" aria-label={endpointsDescription}>
      {endpoints.map(endpoint => <FastingEndpoint key={`${endpoint.prefix}:${endpoint.time}`} {...endpoint} />)}
    </span>
  </button>
}
