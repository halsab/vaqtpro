import { describe, expect, it } from 'vitest'
import { calculatePrayerSchedule } from './prayerCalculation'
import { buildScheduleEvents, selectEventPair, SCHEDULE_EVENT_KEYS } from './scheduleEvents'

function schedule(date = '2026-05-05', timeZone = 'Europe/Moscow') {
  return calculatePrayerSchedule({ latitude: 55.79, longitude: 49.12 }, date, timeZone)
}

describe('calculated schedule chronology', () => {
  it('uses calculated instants and keeps prayer events distinct from markers', () => {
    const value = schedule()
    const events = buildScheduleEvents(value)
    expect(events).toHaveLength(7)
    expect(events.map(event => event.key)).toEqual(SCHEDULE_EVENT_KEYS)
    expect(SCHEDULE_EVENT_KEYS).toEqual(['fajr', 'sunrise', 'zenith', 'dhuhr', 'asr', 'maghrib', 'isha'])
    expect(events.find(({ key }) => key === 'fajr')).toMatchObject({ kind: 'prayer', provenance: 'calculated', scheduleDate: value.date })
    expect(events.filter(({ kind }) => kind === 'marker').map(({ key }) => key).sort()).toEqual(['sunrise', 'zenith'])
    expect(events.every(event => event.instant === value.entries[event.key].instant)).toBe(true)
  })

  it('uses actual instants when late Fajr falls on the previous civil date', () => {
    const value = schedule()
    value.entries.fajr = { time: '23:54', instant: Date.parse('2026-05-04T20:54:00Z'), estimated: false }
    const events = buildScheduleEvents(value)
    const fajr = events.find(({ key }) => key === 'fajr')
    expect(fajr).toMatchObject({ scheduleDate: value.date, timeZone: 'Europe/Moscow', date: '2026-05-04', dayOffset: -1 })
    expect(selectEventPair(new Date('2026-05-04T20:53:59Z'), events).next?.key).toBe('fajr')
    expect(selectEventPair(new Date('2026-05-04T20:54:00Z'), events).current?.key).toBe('fajr')
  })

  it('resolves Tatarstan May 5 late Fajr to its actual previous-day instant', () => {
    const value = calculatePrayerSchedule(
      { latitude: 55.7946485, longitude: 49.1115022 },
      '2026-05-05', 'Europe/Moscow',
      { profile: 'tatarstan', asrMethod: 'hanafi', highLatitudeRule: 'tatarstan' },
    )
    const fajr = buildScheduleEvents(value).find(({ key }) => key === 'fajr')

    expect(fajr).toMatchObject({ time: '23:58', scheduleDate: '2026-05-05', date: '2026-05-04', dayOffset: -1 })
    expect(fajr?.instant).toBe(value.entries.fajr.instant)
  })

  it('selects current and next events by absolute instant regardless of input order', () => {
    const events = buildScheduleEvents(schedule())
    const fajr = events.find(({ key }) => key === 'fajr')
    const sunrise = events.find(({ key }) => key === 'sunrise')
    if (!fajr || !sunrise) throw new Error('Expected calculated Fajr and sunrise events')
    const now = new Date((fajr.instant + sunrise.instant) / 2)
    for (let index = 0; index < events.length; index += 1) {
      const reordered = [...events.slice(index), ...events.slice(0, index)].reverse()
      expect(selectEventPair(now, reordered)).toMatchObject({
        current: { key: 'fajr' }, next: { key: 'sunrise' },
      })
    }
  })

  it('prefers a prayer over a marker when both resolve to the same instant', () => {
    const value = schedule()
    const zenith = value.entries.zenith.instant
    value.entries.dhuhr = { ...value.entries.dhuhr, instant: zenith }
    const pair = selectEventPair(new Date(zenith), buildScheduleEvents(value))
    expect(pair.current?.key).toBe('dhuhr')
  })

  it('preserves local civil dates and offsets across a timezone date boundary', () => {
    const value = schedule('2026-01-01', 'Pacific/Apia')
    const instant = Date.parse('2025-12-31T23:30:22.000Z')
    value.entries.zenith = { time: '12:30', instant, estimated: false }
    expect(buildScheduleEvents(value).find(({ key }) => key === 'zenith')).toMatchObject({
      timeZone: 'Pacific/Apia', scheduleDate: '2026-01-01', date: '2026-01-01', dayOffset: 0,
    })
  })

  it('selects adjacent calculated events across midnight and year-end', () => {
    const before = schedule('2026-12-31')
    const after = schedule('2027-01-01')
    before.entries.isha = { time: '00:10', instant: Date.parse('2027-01-01T00:10:00+03:00'), estimated: false }
    after.entries.fajr = { time: '23:55', instant: Date.parse('2026-12-31T23:55:00+03:00'), estimated: false }
    const events = [after, before].flatMap(buildScheduleEvents)
    const midnight = selectEventPair(new Date('2027-01-01T00:00:00+03:00'), events)
    expect(midnight.current).toMatchObject({ key: 'fajr', scheduleDate: '2027-01-01', date: '2026-12-31', dayOffset: -1 })
    expect(midnight.next).toMatchObject({ key: 'isha', scheduleDate: '2026-12-31', date: '2027-01-01', dayOffset: 1 })
  })

  it('returns null when no event exists before or after the current time', () => {
    const events = buildScheduleEvents(schedule())
    expect(selectEventPair(new Date('2026-05-04T00:00:00Z'), events).current).toBeNull()
    expect(selectEventPair(new Date('2026-05-06T00:00:00Z'), events).next).toBeNull()
    expect(selectEventPair(new Date(), [])).toEqual({ next: null, current: null })
  })
})
