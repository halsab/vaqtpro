import { expect, it } from 'vitest'

import { civilMonthDates } from '../../domain/civilMonth'
import { createCityPlace } from '../../domain/place'
import { calculatePrayerSchedule } from '../../domain/prayerCalculation'
import { resolvePrayerTimeSource } from '../../domain/prayerSource'
import { automaticPreferences } from '../../domain/sourcePreferences'
import { createMonthlyExportView } from './monthlyExportModel'

const place = createCityPlace({ id: 524901, name: 'Москва', countryCode: 'RU', admin1Code: '48', admin1Name: 'Москва',
  latitude: 55.7522, longitude: 37.6156, population: 10_381_222, timeZone: 'Europe/Moscow' }, 0)
const source = resolvePrayerTimeSource(place, automaticPreferences())
if (source.status !== 'ready') throw new Error('Expected a supported calculation profile')
const labels = {
  fajr: 'Фаджр', sunrise: 'Восход', zenith: 'Зенит', dhuhr: 'Зухр', asr: 'Аср', maghrib: 'Магриб', isha: 'Иша',
  exportDay: 'День', exportBrandSubtitle: 'Времена намаза', exportSourcePrefix: 'Источник: ', exportSourceUrl: 'https://vaqt.pro',
  weekdaySundayShort: 'вс', weekdayMondayShort: 'пн', weekdayTuesdayShort: 'вт', weekdayWednesdayShort: 'ср',
  weekdayThursdayShort: 'чт', weekdayFridayShort: 'пт', weekdaySaturdayShort: 'сб',
}

it('keeps Gregorian dates, canonical event order, values, and estimated markers from the visible schedules', () => {
  const rows = civilMonthDates('2024-02-01').map(date => ({ date,
    schedule: calculatePrayerSchedule({ id: place.id, latitude: place.latitude, longitude: place.longitude }, date, source.timeZone, source.settings),
  }))
  const firstSchedule = rows[0]?.schedule
  if (!firstSchedule) throw new Error('Expected a calculated schedule')
  const firstDate = rows[0]?.date
  if (!firstDate) throw new Error('Expected the first civil date')
  rows[0] = { date: firstDate, schedule: { ...firstSchedule, estimatedPrayers: ['fajr'] } }
  const view = createMonthlyExportView({ month: '2024-02', location: 'Москва', rows }, labels)

  expect(view.monthTitle).toBe('Февраль 2024')
  expect(view.headers).toEqual(['День', ...Object.values(labels).slice(0, 7)])
  expect(view.rows).toHaveLength(29)
  expect(view.rows[0]).toMatchObject({ date: '2024-02-01', day: '01', weekday: 'чт' })
  expect(view.rows[0]?.times[0]).toEqual({ value: firstSchedule.entries.fajr.time, estimated: true })
  expect(view.rows[28]?.date).toBe('2024-02-29')
})

it('preserves unavailable days and blocks a month with no valid calculations', () => {
  const dates = civilMonthDates('2026-10-01')
  const schedule = calculatePrayerSchedule({ id: place.id, latitude: place.latitude, longitude: place.longitude }, dates[0] ?? '', source.timeZone, source.settings)
  const partial = createMonthlyExportView({ month: '2026-10', location: 'Москва', rows: dates.map((date, index) => ({ date, schedule: index === 1 ? null : schedule })) }, labels)
  expect(partial.rows[1]?.times).toHaveLength(7)
  expect(partial.rows[1]?.times.every(time => time.value === '—' && !time.estimated)).toBe(true)
  expect(() => createMonthlyExportView({ month: '2026-10', location: 'Москва', rows: dates.map(date => ({ date, schedule: null })) }, labels)).toThrow(/unavailable/i)
})
