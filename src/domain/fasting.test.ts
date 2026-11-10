import { describe, expect, it } from 'vitest'
import { calendarDateFromCivil, civilDateFromCalendar } from './calendar'
import { addDays } from './date'
import {
  buildFastingScheduleEvents,
  fastingProgress,
  isFastingModeActive,
  resolveActiveRamadanOccurrence,
  resolveFastingTimeline,
  restoreFastingModePreferences,
  updateFastingModePreferences,
} from './fasting'
import { calculatePrayerSchedule } from './prayerCalculation'
import { zonedDateTimeToInstant } from './locationTime'
import { ramadanOccurrenceIdForDate } from './religiousEvents'
import type { PrayerTime } from './types'

function day(date: string, fajr: PrayerTime = '04:00', maghrib: PrayerTime = '19:00', timeZone = 'Europe/Moscow') {
  const schedule = calculatePrayerSchedule({ latitude: 55.75, longitude: 37.62 }, date, timeZone)
  const fajrDate = fajr >= '20:00' ? addDays(date, -1) : date
  schedule.entries.fajr = { time: fajr, instant: zonedDateTimeToInstant(fajrDate, fajr, timeZone).getTime(), estimated: false }
  schedule.entries.maghrib = { time: maghrib, instant: zonedDateTimeToInstant(date, maghrib, timeZone).getTime(), estimated: false }
  return schedule
}

function resolve(input: {
  now: string
  today?: string
  selectedDate?: string
  schedules: ReturnType<typeof day>[]
  timeZone?: string
  preferences?: { manualEnabled: boolean; suppressedRamadanOccurrence?: `ramadan-${number}` }
  correction?: -1 | 0 | 1
}) {
  const timeZone = input.timeZone ?? 'Europe/Moscow'
  const today = input.today ?? input.schedules[0]?.date ?? ''
  return resolveFastingTimeline({
    now: new Date(input.now), today, selectedDate: input.selectedDate ?? today, timeZone,
    correction: input.correction ?? 0, hijriSupported: true,
    preferences: input.preferences ?? { manualEnabled: true },
    events: buildFastingScheduleEvents(input.schedules, timeZone),
  })
}

describe('режим поста', () => {
  const ramadanStart = civilDateFromCalendar({ year: 1448, month: 9, day: 1 }, 'hijri')
  const ramadanOccurrence = 'ramadan-1448' as const

  it('включается автоматически на период Рамадана и реагирует на поправку календаря', () => {
    expect(resolveActiveRamadanOccurrence({ today: ramadanStart, correction: 0, hijriSupported: true })).toBe(ramadanOccurrence)
    expect(resolveActiveRamadanOccurrence({ today: ramadanStart, correction: 0, hijriSupported: false })).toBeNull()
    const correctedStart = civilDateFromCalendar({ year: 1448, month: 9, day: 1 }, 'hijri', 1)
    expect(ramadanOccurrenceIdForDate(correctedStart, 1, true)).toBe(ramadanOccurrence)
    expect(calendarDateFromCivil(correctedStart, 'hijri', 1).month).toBe(9)
  })

  it('сохраняет ручное включение, а выключение в Рамадан подавляет только текущий период', () => {
    const manual = updateFastingModePreferences({ manualEnabled: false }, true, null)
    expect(manual).toEqual({ manualEnabled: true })
    expect(isFastingModeActive(manual, null)).toBe(true)
    const suppressed = updateFastingModePreferences(manual, false, ramadanOccurrence)
    expect(suppressed).toEqual({ manualEnabled: false, suppressedRamadanOccurrence: ramadanOccurrence })
    expect(isFastingModeActive(suppressed, ramadanOccurrence)).toBe(false)
    expect(isFastingModeActive(suppressed, 'ramadan-1449')).toBe(true)
    expect(updateFastingModePreferences(suppressed, true, ramadanOccurrence)).toEqual({ manualEnabled: true })
  })




  it('uses calculated Fajr and includes fasting boundaries exactly', () => {
    const yesterday = day('2026-03-09', '04:10')
    const today = day('2026-03-10', '04:00')
    const tomorrow = day('2026-03-11', '04:05')
    const events = buildFastingScheduleEvents([yesterday, today, tomorrow], 'Europe/Moscow')
    expect(events.fajr.find(event => event.scheduleDate === today.date)?.time).toBe('04:00')
    expect(resolve({ now: '2026-03-10T01:00:00Z', today: today.date, schedules: [yesterday, today, tomorrow] }))
      .toMatchObject({ kind: 'day', start: { time: '04:00' } })
    expect(resolve({ now: '2026-03-10T16:00:00Z', today: today.date, schedules: [yesterday, today, tomorrow] }))
      .toMatchObject({ kind: 'night', start: { time: '19:00' } })
  })

  it('переключает ночной и дневной интервалы до, на и после границ Фаджра и Магриба', () => {
    const yesterday = day('2026-03-09')
    const today = day('2026-03-10')
    const tomorrow = day('2026-03-11')
    const schedules = [yesterday, today, tomorrow]

    expect(resolve({ now: '2026-03-10T00:59:59Z', today: today.date, schedules }))
      .toMatchObject({ kind: 'night', end: { scheduleDate: today.date } })
    expect(resolve({ now: '2026-03-10T01:00:00Z', today: today.date, schedules }))
      .toMatchObject({ kind: 'day', start: { scheduleDate: today.date } })
    expect(resolve({ now: '2026-03-10T01:00:01Z', today: today.date, schedules }))
      .toMatchObject({ kind: 'day', start: { scheduleDate: today.date } })

    expect(resolve({ now: '2026-03-10T15:59:59Z', today: today.date, schedules }))
      .toMatchObject({ kind: 'day', end: { scheduleDate: today.date } })
    expect(resolve({ now: '2026-03-10T16:00:00Z', today: today.date, schedules }))
      .toMatchObject({ kind: 'night', start: { scheduleDate: today.date } })
    expect(resolve({ now: '2026-03-10T16:00:01Z', today: today.date, schedules }))
      .toMatchObject({ kind: 'night', start: { scheduleDate: today.date } })
  })





  it('строит расчётные времена и сохраняет локальные даты на переходе DST', () => {
    const location = { latitude: 40.7128, longitude: -74.006 }
    const schedules = ['2026-03-08', '2026-03-09'].map(date => calculatePrayerSchedule(location, date, 'America/New_York'))
    const events = buildFastingScheduleEvents(schedules, 'America/New_York')
    expect(events.fajr).toHaveLength(2)
    expect(events.maghrib).toHaveLength(2)
    expect(events.fajr.every(event => event.timeZone === 'America/New_York')).toBe(true)
    expect(events.fajr.map(event => event.date)).toEqual(['2026-03-08', '2026-03-09'])
  })

  it('не переносит автоматический пост на утро Ид после последнего ифтара', () => {
    const eidDate = civilDateFromCalendar({ year: 1448, month: 10, day: 1 }, 'hijri')
    const lastFastDate = addDays(eidDate, -1)
    const schedules = [day(addDays(lastFastDate, -1)), day(lastFastDate), day(eidDate), day(addDays(eidDate, 1))]
    const afterLastIftar = new Date(`${lastFastDate}T16:00:00Z`)
    expect(resolve({ now: afterLastIftar.toISOString(), today: lastFastDate, schedules, preferences: { manualEnabled: false } })).toBeNull()
    expect(resolve({ now: afterLastIftar.toISOString(), today: lastFastDate, schedules, preferences: { manualEnabled: true } }))
      .toMatchObject({ kind: 'night', end: { scheduleDate: eidDate } })
  })


})



