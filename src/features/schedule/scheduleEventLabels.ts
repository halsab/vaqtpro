import type { CalculatedPrayerKey } from '../../domain/types'
import type { useLocalization } from '../../localization'

// Shared localized labels for Home schedule rows and monthly timetable headers.
export const SCHEDULE_EVENT_LABEL_KEYS: Record<CalculatedPrayerKey, Parameters<ReturnType<typeof useLocalization>['t']>[0]> = {
  fajr: 'prayerFajr',
  sunrise: 'prayerSunrise',
  zenith: 'prayerZenith',
  dhuhr: 'prayerDhuhr',
  asr: 'prayerAsr',
  maghrib: 'prayerMaghrib',
  isha: 'prayerIsha',
}
