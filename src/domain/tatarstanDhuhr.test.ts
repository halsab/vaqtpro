import { describe, expect, it } from 'vitest'
import { createLocationClock, getZonedTime } from './locationTime'
import { TATARSTAN_FIXED_DHUHR, tatarstanDhuhrInstant, verifiedTatarstanLocalityId } from './tatarstanDhuhr'
import { calculatePrayerSchedule } from './prayerCalculation'
import { createLocalityPlace } from './place'
import { TATARSTAN_LOCALITIES } from '../data/tatarstanLocalities'
import type { PrayerTime } from './types'
import localities from '../data/tatarstanLocalities.json'

const zenith = (time: string, date = '2026-06-21', zone = 'Europe/Moscow') => {
  const [hour = '00', minute = '00', seconds = '0'] = time.split(':', 3)
  return createLocationClock(zone).toInstant(date, `${hour}:${minute}` as PrayerTime).getTime() + Number(seconds) * 1_000
}
const shown = (instant: number, _date = '2026-06-21', zone = 'Europe/Moscow') =>
  createLocationClock(zone).getTime(new Date(instant))

describe('Tatarstan Dhuhr policy', () => {
  it('keeps exactly the 42 validated fixed localities and excludes the two variable/safety cases', () => {
    expect(Object.keys(TATARSTAN_FIXED_DHUHR)).toHaveLength(42)
    expect(Object.keys(TATARSTAN_FIXED_DHUHR).sort()).toEqual(localities
      .filter(({ id }) => id !== 'bolshie-kaybitsy' && id !== 'apastovo')
      .map(({ id }) => id).sort())
    expect(TATARSTAN_FIXED_DHUHR).not.toHaveProperty('bolshie-kaybitsy')
    expect(TATARSTAN_FIXED_DHUHR).not.toHaveProperty('apastovo')
    expect(Object.values(TATARSTAN_FIXED_DHUHR).reduce<Record<string, number>>((counts, value) => {
      counts[value] = (counts[value] ?? 0) + 1
      return counts
    }, {})).toEqual({ '11:45': 1, '12:00': 36, '12:05': 1, '12:15': 2, '11:50': 2 })
  })



  it('matches manually selected and GPS places only through verified locality identity', () => {
    expect(verifiedTatarstanLocalityId({ id: 'geonames:551487', selection: 'city', cityId: 551487,
      region: { code: 'RU-TA' }, coverage: 'inside' })).toBe('kazan')
    expect(verifiedTatarstanLocalityId({ id: 'gps:1', selection: 'gps', latitude: 55.794, longitude: 49.111,
      accuracy: 20, region: { code: 'RU-TA' }, coverage: 'inside' })).toBeUndefined()
    expect(verifiedTatarstanLocalityId({ id: 'gps:1', selection: 'gps', region: { code: 'RU-TA' }, coverage: 'inside',
      latitude: 55.794, longitude: 49.111, accuracy: 20_001 })).toBeUndefined()
    expect(verifiedTatarstanLocalityId({ id: 'gps:1', selection: 'gps', latitude: 56.2503, longitude: 49.4534,
      accuracy: 20, region: { code: 'RU-TA' }, coverage: 'inside' })).toBeUndefined()
    expect(verifiedTatarstanLocalityId({ id: 'gps:1', selection: 'gps', latitude: 55.4062, longitude: 48.1936,
      accuracy: 20, region: { code: 'RU-TA' }, coverage: 'inside' })).toBeUndefined()
    expect(verifiedTatarstanLocalityId({ id: 'gps:1', selection: 'gps', latitude: 55.794, longitude: 49.111,
      accuracy: 20, region: { code: 'RU-TA' }, coverage: 'outside' })).toBeUndefined()
    expect(verifiedTatarstanLocalityId({ id: 'locality:kazan', selection: 'city', latitude: 55.7946485,
      longitude: 49.1115022, region: { code: 'RU-TA' }, coverage: 'inside' })).toBe('kazan')
    expect(verifiedTatarstanLocalityId({ id: 'locality:kazan', selection: 'city', latitude: 56.5,
      longitude: 52, region: { code: 'RU-TA' }, coverage: 'inside' })).toBeUndefined()
    expect(verifiedTatarstanLocalityId({ id: 'locality:kazan', selection: 'city', latitude: 55.7946485,
      longitude: 49.1115022, region: { code: 'RU.73' }, coverage: 'inside' })).toBeUndefined()
    expect(verifiedTatarstanLocalityId({ id: 'geonames:551487', selection: 'city', cityId: 551487,
      region: { code: 'RU.73' }, coverage: 'inside' })).toBeUndefined()
  })

  it('applies fixed values only as a lower bound and always stays after zenith', () => {
    const date = '2026-06-21'
    const fixedLater = tatarstanDhuhrInstant(date, 'Europe/Moscow', zenith('11:40', date), 'agriz')
    const safetyLater = tatarstanDhuhrInstant(date, 'Europe/Moscow', zenith('12:20', date), 'agriz')
    expect(shown(fixedLater, date)).toBe('11:45')
    expect(fixedLater).toBeGreaterThan(zenith('11:40', date))
    expect(shown(safetyLater, date)).toBe('12:21')
    expect(safetyLater).toBeGreaterThan(zenith('12:20', date))
  })


  it('uses the generic formula for excluded and unknown localities regardless of year', () => {
    const date = '2031-04-03'
    const instant = zenith('11:59:30.000', date)
    for (const id of ['bolshie-kaybitsy', 'apastovo', 'not-a-verified-locality']) {
      expect(tatarstanDhuhrInstant(date, 'Europe/Moscow', instant, id)).toBe(zenith('12:01', date))
    }
  })


  it('keeps all seven calculated events complete across the approved 2026 date and locality matrix', () => {
    const dates = [
      '2026-01-15', '2026-03-20', '2026-05-04', '2026-05-05', '2026-05-06',
      '2026-06-21', '2026-07-15', '2026-08-07', '2026-08-08', '2026-08-09',
      '2026-10-09', '2026-12-21',
    ]
    const ids = [
      'agriz', 'nizhnekamsk', 'zelenodolsk', 'buinsk', 'staroe-drozhzhanoe',
      'bolshie-kaybitsy', 'apastovo', 'kazan', 'unlisted',
    ]
    const keys = ['fajr', 'sunrise', 'zenith', 'dhuhr', 'asr', 'maghrib', 'isha'] as const

    for (const date of dates) {
      for (const id of ids) {
        const locality = TATARSTAN_LOCALITIES.find(item => item.id === id)
          ?? { id, name: 'Unlisted', latitude: 55.4062, longitude: 48.1936, timeZone: 'Europe/Moscow' }
        const place = createLocalityPlace(locality, 0)
        const schedule = calculatePrayerSchedule(place, date, place.timeZone, {
          profile: 'tatarstan', asrMethod: 'hanafi', highLatitudeRule: 'tatarstan',
        })
        const instants = keys.map(key => schedule.entries[key].instant)

        expect(schedule.date).toBe(date)
        expect(schedule.timeZone).toBe('Europe/Moscow')
        expect(Object.keys(schedule.entries)).toEqual(keys)
        expect(instants.every(Number.isFinite)).toBe(true)
        expect(instants).toEqual([...instants].sort((left, right) => left - right))
        for (const key of keys) {
          expect(schedule.entries[key].time).toBe(getZonedTime(new Date(schedule.entries[key].instant), place.timeZone))
        }
        expect(schedule.entries.dhuhr.instant).toBeGreaterThan(schedule.entries.zenith.instant)
      }
    }
  })
})
