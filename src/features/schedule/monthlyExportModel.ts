import { PRAYER_MONTH_KEYS } from './PrayerMonthTable'
import type { PrayerSchedule } from '../../domain/scheduleEvents'

export interface MonthlyExportSnapshot {
  month: string
  location: string
  rows: readonly { date: string; schedule: PrayerSchedule | null }[]
}

export interface MonthlyExportRow {
  date: string
  weekday: string
  day: string
  times: readonly { value: string; estimated: boolean }[]
}

export interface MonthlyExportView {
  month: string
  monthTitle: string
  location: string
  headers: readonly string[]
  brandSubtitle: string
  sourcePrefix: string
  sourceUrl: string
  rows: readonly MonthlyExportRow[]
}

const WEEKDAY_LABEL_KEYS = [
  'weekdaySundayShort', 'weekdayMondayShort', 'weekdayTuesdayShort', 'weekdayWednesdayShort',
  'weekdayThursdayShort', 'weekdayFridayShort', 'weekdaySaturdayShort',
] as const

export function createMonthlyExportView(snapshot: MonthlyExportSnapshot, labels: Record<string, string>): MonthlyExportView {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(snapshot.month)) throw new RangeError('Invalid export month')
  if (!snapshot.rows.length || snapshot.rows.every(row => row.schedule === null)) throw new RangeError('Monthly schedule is unavailable')
  const monthDate = new Date(`${snapshot.month}-01T12:00:00.000Z`)
  const parts = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).formatToParts(monthDate)
  const monthName = parts.find(part => part.type === 'month')?.value
  const year = parts.find(part => part.type === 'year')?.value
  if (!monthName || !year) throw new RangeError('Could not format export month')
  return {
    month: snapshot.month,
    monthTitle: `${monthName[0]?.toLocaleUpperCase('ru-RU') ?? ''}${monthName.slice(1)} ${year}`,
    location: snapshot.location,
    headers: [labels.exportDay ?? '', ...PRAYER_MONTH_KEYS.map(key => labels[key] ?? key)],
    brandSubtitle: labels.exportBrandSubtitle ?? '',
    sourcePrefix: labels.exportSourcePrefix ?? '',
    sourceUrl: labels.exportSourceUrl ?? '',
    rows: snapshot.rows.map(({ date, schedule }) => ({
      date,
      day: date.slice(-2),
      weekday: labels[WEEKDAY_LABEL_KEYS[new Date(`${date}T12:00:00.000Z`).getUTCDay()] ?? 'weekdaySundayShort'] ?? '',
      times: PRAYER_MONTH_KEYS.map(key => ({
        value: schedule ? schedule.entries[key].time : '—',
        estimated: schedule ? schedule.estimatedPrayers.includes(key) : false,
      })),
    })),
  }
}
