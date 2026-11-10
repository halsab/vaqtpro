import { describe, expect, it } from 'vitest'

import { addDays } from './date'
import { calculatePrayerSchedule } from './prayerCalculation'
import { zonedDateTimeToInstant } from './locationTime'
import {
  RELIGIOUS_EVENT_IDS,
  RELIGIOUS_EVENTS,
  isReligiousEventId,
  listReligiousEventOccurrences,
  resolveReligiousBanner,
} from './religiousEvents'
import type { PrayerSchedule } from './scheduleEvents'

function calculated(date: string, fajr = '05:00', maghrib = '18:00'): PrayerSchedule {
  const schedule = calculatePrayerSchedule({ latitude: 55.79, longitude: 49.12 }, date, 'Europe/Moscow')
  const fajrDate = fajr >= '20:00' ? addDays(date, -1) : date
  schedule.entries.fajr = { time: fajr as `${number}:${number}`, instant: zonedDateTimeToInstant(fajrDate, fajr as `${number}:${number}`, 'Europe/Moscow').getTime(), estimated: false }
  schedule.entries.maghrib = { time: maghrib as `${number}:${number}`, instant: zonedDateTimeToInstant(date, maghrib as `${number}:${number}`, 'Europe/Moscow').getTime(), estimated: false }
  return schedule
}

function nightSchedules(anchor: string, fajr = '05:00'): PrayerSchedule[] {
  return [calculated(anchor), calculated(addDays(anchor, 1), fajr)]
}

function resolve(date: string, options: Partial<Parameters<typeof resolveReligiousBanner>[0]> = {}) {
  return resolveReligiousBanner({
    now: new Date(`${date}T12:00:00+03:00`),
    today: date,
    selectedDate: date,
    correction: 0,
    hijriSupported: true,
    scheduleReady: true,
    schedules: [],
    ...options,
  })
}

describe('реестр религиозных событий', () => {

})

describe('listReligiousEventOccurrences', () => {
  const list = (fromDate: string, toDateExclusive: string, correction: -1 | 0 | 1 = 0) => listReligiousEventOccurrences({
    fromDate,
    toDateExclusive,
    correction,
    hijriSupported: true,
  })


  it('добавляет period только в первый день и не подхватывает уже начавшийся период', () => {
    expect(list('2026-02-18', '2026-03-01').filter(event => event.eventId === 'ramadan')).toHaveLength(1)
    expect(list('2026-02-19', '2026-03-01').some(event => event.eventId === 'ramadan')).toBe(false)
    expect(list('2026-05-18', '2026-05-28').filter(event => event.eventId === 'dhul-hijjah-first-ten')).toHaveLength(1)
  })

  it('применяет correction и соблюдает inclusive/exclusive границы', () => {
    expect(list('2026-06-15', '2026-06-16', 1).map(event => event.eventId)).toEqual(['hijri-new-year'])
    expect(list('2026-06-16', '2026-06-17', 0).map(event => event.eventId)).toEqual(['hijri-new-year'])
    expect(list('2026-06-17', '2026-06-18', -1).map(event => event.eventId)).toEqual(['hijri-new-year'])
    expect(list('2026-06-15', '2026-06-16', 0)).toEqual([])
    expect(list('2026-06-15', '2026-06-16', -1)).toEqual([])
  })


  it('возвращает пустой список без Umm al-Qura', () => {
    expect(listReligiousEventOccurrences({
      fromDate: '2026-01-01',
      toDateExclusive: '2027-01-01',
      correction: 0,
      hijriSupported: false,
    })).toEqual([])
  })
})

describe('resolveReligiousBanner', () => {


  it('удерживает Рамадан до фактического конца месяца и показывает приближение Ураза-байрама', () => {
    expect(resolve('2026-03-16')).toMatchObject({ eventId: 'ramadan', secondary: null })
    expect(resolve('2026-03-17')).toMatchObject({ eventId: 'ramadan', secondary: { type: 'event-days', eventId: 'eid-al-fitr', count: 3 } })
    expect(resolve('2026-03-18')).toMatchObject({ eventId: 'ramadan', secondary: { type: 'event-days', eventId: 'eid-al-fitr', count: 2 } })
    expect(resolve('2026-03-19')).toMatchObject({ eventId: 'ramadan', secondary: { type: 'event-days', eventId: 'eid-al-fitr', count: 1 } })
    expect(resolve('2026-03-20')).toMatchObject({ eventId: 'eid-al-fitr', secondary: null })
  })





  it('держит ночь от anchor day до точного Фаджра следующего расчётного дня', () => {
    const schedules = nightSchedules('2026-01-15')
    expect(resolve('2026-01-15', { now: new Date('2026-01-15T17:00:00+03:00'), schedules })?.eventId).toBe('isra-miraj')
    expect(resolve('2026-01-15', { now: new Date('2026-01-15T19:00:00+03:00'), schedules })?.eventId).toBe('isra-miraj')
    expect(resolve('2026-01-16', { now: new Date('2026-01-16T01:00:00+03:00'), schedules })?.eventId).toBe('isra-miraj')
    expect(resolve('2026-01-16', { now: new Date('2026-01-16T05:00:00+03:00'), schedules })).toBeNull()
    expect(resolve('2026-01-16', { now: new Date('2026-01-16T05:01:00+03:00'), schedules })).toBeNull()
  })



  it('скрывает night при отсутствующей или неверной границе', () => {
    expect(resolve('2026-01-15')).toBeNull()
    const schedules = nightSchedules('2026-01-15')
    schedules[1] = calculated('2026-01-16', '17:00')
    expect(resolve('2026-01-15', { schedules })).toBeNull()
  })

})
