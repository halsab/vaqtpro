import { createElement } from 'react'

import type { CalculatedPrayerKey } from '../../domain/types'
import type { PrayerSchedule } from '../../domain/scheduleEvents'
import { useLocalization } from '../../localization'

export const PRAYER_MONTH_KEYS = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'] as const satisfies readonly CalculatedPrayerKey[]

function formatDate(date: string): string {
  const [year, month, day] = date.split('-')
  if (!year || !month || !day) throw new RangeError(`Invalid civil date: ${date}`)
  return `${day}.${month}.${year}`
}

export function PrayerMonthTable({ schedules, labels, dateLabel, tableLabel }: {
  schedules: readonly PrayerSchedule[]
  labels: Record<(typeof PRAYER_MONTH_KEYS)[number], string>
  dateLabel: string
  tableLabel: string
}) {
  const { t } = useLocalization()
  return createElement('div', { className: 'prayer-month-table-scroll', role: 'region', 'aria-label': tableLabel, tabIndex: 0 },
    createElement('table', { className: 'prayer-month-table' },
      createElement('caption', null, tableLabel),
      createElement('thead', null, createElement('tr', null,
        createElement('th', { scope: 'col' }, dateLabel),
        ...PRAYER_MONTH_KEYS.map(key => createElement('th', { key, scope: 'col' }, labels[key])))),
      createElement('tbody', null, ...schedules.map(schedule => createElement('tr', { key: schedule.date },
        createElement('th', { scope: 'row' }, createElement('time', { dateTime: schedule.date }, formatDate(schedule.date))),
        ...PRAYER_MONTH_KEYS.map(key => {
          const entry = schedule.entries[key]
          return createElement('td', { key }, createElement('span', { className: 'prayer-month-time' },
            entry.estimated ? createElement('span', { className: 'prayer-month-estimated', 'aria-label': t('estimatedTime') }, `${t('estimatedApproximation')} `) : null,
            createElement('time', { dateTime: new Date(entry.instant).toISOString() }, entry.time)))
        }))))))
}
