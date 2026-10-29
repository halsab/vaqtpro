import { createElement } from 'react'

import type { CalculatedPrayerKey } from '../../domain/types'
import { SCHEDULE_EVENT_KEYS, type PrayerSchedule } from '../../domain/scheduleEvents'
import { useLocalization } from '../../localization'

export const PRAYER_MONTH_KEYS = SCHEDULE_EVENT_KEYS

function formatDate(date: string): string {
  const [year, month, day] = date.split('-')
  if (!year || !month || !day) throw new RangeError(`Invalid civil date: ${date}`)
  return `${day}.${month}.${year}`
}

export function PrayerMonthTable({ rows, labels, dateLabel, tableLabel }: {
  rows: readonly { date: string; schedule: PrayerSchedule | null }[]
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
      createElement('tbody', null, ...rows.map(({ date, schedule }) => createElement('tr', { key: date },
        createElement('th', { scope: 'row' }, createElement('time', { dateTime: date, 'aria-label': formatDate(date) }, date.slice(-2))),
        ...PRAYER_MONTH_KEYS.map(key => {
          const entry = schedule?.entries[key]
          if (!entry) return createElement('td', { key, 'aria-label': t('monthlyTimeUnavailable') }, '—')
          return createElement('td', { key }, createElement('span', { className: 'prayer-month-time' },
            schedule?.estimatedPrayers.includes(key) ? createElement('span', { className: 'prayer-month-estimated', 'aria-label': t('estimatedTime') }, `${t('estimatedApproximation')} `) : null,
            createElement('time', { dateTime: new Date(entry.instant).toISOString() }, entry.time)))
        }))))))
}
