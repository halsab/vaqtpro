import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scheduleContextKey, type ScheduleContext } from '../../domain/scheduleContext'
import { automaticPreferences } from '../../domain/sourcePreferences'
import { createCityPlace } from '../../domain/place'
import { DEFAULT_CALCULATION_SETTINGS, calculatePrayerSchedule } from '../../domain/prayerCalculation'
import type { City } from '../../domain/cities'
import { activateFastScheduleContext, currentFastScheduleGeneration, FAST_SCHEDULE_STORAGE_KEYS, invalidateFastScheduleSnapshot, readFastScheduleSnapshot, writeFastScheduleSnapshot } from './fastScheduleSnapshot'

const now = new Date('2026-10-19T10:00:00.000Z')
const city: City = { id: 551487, name: 'Казань', countryCode: 'RU', admin1Code: '73', admin1Name: 'Татарстан',
  latitude: 55.7946, longitude: 49.1115, population: 1, timeZone: 'Europe/Moscow', featureCode: 'PPL' }
const place = createCityPlace(city, now.getTime())
const context: ScheduleContext = {
  location: { id: place.id, latitude: place.latitude, longitude: place.longitude },
  date: '2026-10-19', timeZone: 'Europe/Moscow', mode: 'automatic', source: 'calculated', settings: DEFAULT_CALCULATION_SETTINGS,
}
const schedule = calculatePrayerSchedule(context.location, context.date, context.timeZone, context.settings)

function memoryStorage(): Storage {
  const entries = new Map<string, string>()
  return {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => { entries.set(key, value) },
    removeItem: key => { entries.delete(key) },
    clear: () => entries.clear(),
    key: index => [...entries.keys()][index] ?? null,
    get length() { return entries.size },
  }
}


let store: Storage

function seed(overrides: Partial<Parameters<typeof writeFastScheduleSnapshot>[0]> = {}) {
  const input = {
    appVersion: 'test-build', now, deviceTimeZone: 'Europe/Moscow', context, schedule, place,
    selectionSource: 'default' as const, preferences: automaticPreferences(),
    ...overrides,
  }
  const generation = invalidateFastScheduleSnapshot()
  if (!generation || !activateFastScheduleContext(scheduleContextKey(input.context), generation)) return false
  return writeFastScheduleSnapshot({ ...input, generation })
}

describe('fast prayer schedule snapshot', () => {
  beforeEach(() => {
    store = memoryStorage()
    vi.stubGlobal('localStorage', store)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('writes a bounded checksum-protected calculated schedule cache', () => {
    expect(seed()).toBe(true)
    const raw = store.getItem(FAST_SCHEDULE_STORAGE_KEYS.snapshot)
    expect(raw).not.toBeNull()
    expect(new TextEncoder().encode(raw ?? '').length).toBeLessThanOrEqual(4_096)
    expect(readFastScheduleSnapshot({ appVersion: 'test-build', now, deviceTimeZone: 'Europe/Moscow' }))
      .toMatchObject({ context, schedule, place: { id: place.id }, preferences: automaticPreferences() })
  })




  it('удаляет запись с повреждённой контрольной суммой', () => {
    expect(seed()).toBe(true)
    const raw = store.getItem(FAST_SCHEDULE_STORAGE_KEYS.snapshot) ?? ''
    store.setItem(FAST_SCHEDULE_STORAGE_KEYS.snapshot, raw.replace(schedule.entries.fajr.time, '00:00'))
    expect(readFastScheduleSnapshot({ appVersion: 'test-build', now, deviceTimeZone: 'Europe/Moscow' })).toBeNull()
    expect(store.getItem(FAST_SCHEDULE_STORAGE_KEYS.snapshot)).toBeNull()
  })


  it('не принимает снимок после смены активного контекста или удаления данных', () => {
    expect(seed()).toBe(true)
    const staleGeneration = currentFastScheduleGeneration()
    store.setItem(FAST_SCHEDULE_STORAGE_KEYS.activeContext,
      JSON.stringify({ generation: staleGeneration, contextKey: JSON.stringify(['other', context.date]) }))
    expect(readFastScheduleSnapshot({ appVersion: 'test-build', now, deviceTimeZone: 'Europe/Moscow' })).toBeNull()
    expect(seed()).toBe(true)
    invalidateFastScheduleSnapshot()
    expect(readFastScheduleSnapshot({ appVersion: 'test-build', now, deviceTimeZone: 'Europe/Moscow' })).toBeNull()
  })

  it('не позволяет старой асинхронной записи вернуть снимок после смены поколения', () => {
    expect(seed()).toBe(true)
    const staleGeneration = currentFastScheduleGeneration()
    const generation = invalidateFastScheduleSnapshot()
    expect(generation).not.toBe(staleGeneration)
    expect(generation && activateFastScheduleContext(scheduleContextKey(context), generation)).toBe(true)
    expect(writeFastScheduleSnapshot({ appVersion: 'test-build', now, deviceTimeZone: 'Europe/Moscow',
      generation: staleGeneration, context, schedule, place, selectionSource: 'default', preferences: automaticPreferences() })).toBe(false)
  })

  it('отклоняет некорректное расписание и отключённое browser storage', () => {
    expect(seed({ schedule: { ...schedule, entries: { ...schedule.entries, fajr: { ...schedule.entries.fajr, time: 'bad' as never } } } })).toBe(false)
    vi.stubGlobal('localStorage', { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') }, removeItem() { throw new Error('denied') } })
    expect(readFastScheduleSnapshot({ appVersion: 'test-build', now, deviceTimeZone: 'Europe/Moscow' })).toBeNull()
    expect(seed()).toBe(false)
  })
})
