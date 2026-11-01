import { createElement, type KeyboardEvent } from 'react'

import { SCHEDULE_EVENT_KEYS, type PrayerSchedule } from '../../domain/scheduleEvents'
import { useLocalization } from '../../localization'
import { civilWeekday } from '../../domain/civilMonth'

export const PRAYER_MONTH_KEYS = SCHEDULE_EVENT_KEYS

function handleTableScrollKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight'
  const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'PageUp' || event.key === 'PageDown'
  if (!horizontal && !vertical) return
  const tableViewport = event.currentTarget
  const screenContent = tableViewport.closest('.screen-content')
  const overflow = getComputedStyle(tableViewport)
  const tableOwnsAxis = horizontal
    ? overflow.overflowX === 'auto' || overflow.overflowX === 'scroll'
    : overflow.overflowY === 'auto' || overflow.overflowY === 'scroll'
  const element = tableOwnsAxis ? tableViewport : screenContent
  if (!(element instanceof HTMLElement)) return
  if (horizontal && element.scrollWidth <= element.clientWidth) return
  if (vertical && element.scrollHeight <= element.clientHeight) return
  event.preventDefault()
  if (horizontal) element.scrollLeft += (event.key === 'ArrowRight' ? 1 : -1) * Math.max(80, element.clientWidth * 0.8)
  else element.scrollTop += (event.key === 'ArrowDown' || event.key === 'PageDown' ? 1 : -1) * Math.max(44, element.clientHeight * (event.key.startsWith('Page') ? 0.8 : 0.15))
}

function formatAccessibleDate(date: string): string {
  const [year, month, day] = date.split('-')
  if (!year || !month || !day) throw new RangeError(`Invalid civil date: ${date}`)
  return `${day}.${month}.${year}`
}

export function PrayerMonthTable({ rows, labels, weekdayLabels, dateLabel, tableLabel }: {
  rows: readonly { date: string; schedule: PrayerSchedule | null }[]
  labels: Record<(typeof PRAYER_MONTH_KEYS)[number], string>
  weekdayLabels: readonly string[]
  dateLabel: string
  tableLabel: string
}) {
  const { t } = useLocalization()
  return createElement('div', { className: 'prayer-month-table-scroll', role: 'region', 'aria-label': tableLabel, tabIndex: 0, onKeyDown: handleTableScrollKeyDown },
    createElement('table', { className: 'prayer-month-table' },
      createElement('caption', null, tableLabel),
      createElement('colgroup', null, ...Array.from({ length: PRAYER_MONTH_KEYS.length + 1 }, (_, index) =>
        createElement('col', { key: index }))),
      createElement('thead', null, createElement('tr', null,
        createElement('th', { scope: 'col', className: 'prayer-month-date-heading' }, dateLabel),
        ...PRAYER_MONTH_KEYS.map(key => createElement('th', { key, scope: 'col' }, labels[key])))),
      createElement('tbody', null, ...rows.map(({ date, schedule }) => createElement('tr', { key: date },
        createElement('th', { scope: 'row', className: 'prayer-month-date' }, createElement('time', {
          dateTime: date,
          'aria-label': formatAccessibleDate(date),
        }, `${date.slice(-2)} ${weekdayLabels[civilWeekday(date)] ?? ''}`)),
        ...PRAYER_MONTH_KEYS.map(key => {
          const entry = schedule?.entries[key]
          if (!entry) return createElement('td', { key, 'aria-label': t('monthlyTimeUnavailable') }, '—')
          return createElement('td', { key }, createElement('span', { className: 'prayer-month-time' },
            schedule.estimatedPrayers.includes(key) ? createElement('span', { className: 'prayer-month-estimated', 'aria-label': t('estimatedTime') }, `${t('estimatedApproximation')} `) : null,
            createElement('time', { dateTime: new Date(entry.instant).toISOString() }, entry.time)))
        }))))))
}
