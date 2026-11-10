import { describe, expect, it } from 'vitest'
import { createGpsPlace, createLocalityPlace, withNearbyCity } from './place'
import { initialManualCalculation, resolvePrayerTimeSource } from './prayerSource'
import { automaticPreferences, manualCalculation, restoreSourcePreferences } from './sourcePreferences'
import { effectiveCalculationSettings } from './calculationSettings'
import { calculatePrayerSchedule } from './prayerCalculation'

const kazan = createLocalityPlace({ id: 'kazan', name: 'Казань', latitude: 55.79, longitude: 49.12 }, 0)
const automatic = automaticPreferences()

describe('calculation source resolver', () => {
  it('uses the independent Tatarstan profile for confirmed localities in every year', () => {
    const resolution = resolvePrayerTimeSource(kazan, automatic)
    expect(resolution).toMatchObject({
        kind: 'calculated', status: 'ready', timeZone: 'Europe/Moscow', settings: { profile: 'tatarstan', asrMethod: 'hanafi' },
    })
    for (const date of ['2026-06-21', '2027-06-21', '2030-06-21']) {
      expect(calculatePrayerSchedule(kazan, date, resolution.timeZone, resolution.settings).date).toBe(date)
    }
    expect(initialManualCalculation(kazan)).toMatchObject({ profile: 'tatarstan', overrides: { asrMethod: 'hanafi' } })
  })



  it('uses Tatarstan geography for a confirmed GPS point and ignores a nearby foreign-city label', () => {
    const geometry = { uncertaintyMeters: 0, polygons: [[[[49, 55], [50, 55], [50, 56], [49, 56], [49, 55]]]] } as const
    const gps = createGpsPlace({ latitude: 55.5, longitude: 49.5, accuracy: 10, timestamp: 0 }, 'Europe/Moscow', geometry, 'gps:ta')
    const foreignLabel = withNearbyCity(gps, { id: 1, name: 'Nearby', countryCode: 'CA', admin1Code: '', admin1Name: '',
      latitude: gps.latitude, longitude: gps.longitude, population: 1, timeZone: 'America/Toronto' })
    expect(resolvePrayerTimeSource(foreignLabel, automatic)).toMatchObject({ settings: { profile: 'tatarstan' } })
    expect(resolvePrayerTimeSource({ ...gps, coverage: 'outside', region: null }, automatic)).toMatchObject({ settings: { profile: 'muslimWorldLeague' } })
  })

  it('uses a generic profile if an automatic regional profile is unavailable', () => {
    const moscow = { ...kazan, selection: 'city' as const, coverage: 'outside' as const, region: { code: 'RU.48', name: 'Москва' } }
    expect(resolvePrayerTimeSource(moscow, automatic, ['muslimWorldLeague'])).toMatchObject({
      kind: 'calculated', strategy: 'default', status: 'ready', settings: { profile: 'muslimWorldLeague', asrMethod: 'standard' },
    })
    expect(resolvePrayerTimeSource(moscow, automatic, ['turkey'])).toMatchObject({
      kind: 'calculated', strategy: 'default', status: 'unsupported', settings: { profile: 'muslimWorldLeague' },
    })
  })

  it('keeps manual calculation overrides and the automatic draft independent', () => {
    const selection = { profile: 'karachi' as const, overrides: { asrMethod: 'standard' as const, fajrAngle: 19, adjustments: { isha: 90 } } }
    const manual = resolvePrayerTimeSource(kazan, manualCalculation(selection))
    expect(manual).toMatchObject({ kind: 'calculated', strategy: 'manual', settings: { profile: 'karachi', fajrAngle: 19, adjustments: { isha: 90 } } })
    expect(resolvePrayerTimeSource(kazan, automaticPreferences(selection)).settings.profile).toBe('tatarstan')
    expect(resolvePrayerTimeSource(kazan, automaticPreferences(selection, { kind: 'calculated', calculation: selection })).settings.profile).toBe('tatarstan')
    expect(resolvePrayerTimeSource(kazan, { mode: 'manual', source: { kind: 'calculated', calculation: selection } }).settings.asrMethod).toBe('standard')
  })



  it('applies automatic Asr settings to calculated prayer instants', () => {
    const almaty = { ...kazan, selection: 'city' as const, coverage: 'outside' as const, latitude: 43.2383,
      longitude: 76.9455, timeZone: 'Asia/Almaty', region: { code: 'KZ.75', name: '' } }
    const resolution = resolvePrayerTimeSource(almaty, automatic)
    expect(resolution.settings).toMatchObject({ profile: 'muslimWorldLeague', asrMethod: 'hanafi' })
    const automaticSchedule = calculatePrayerSchedule(almaty, '2026-09-01', almaty.timeZone, resolution.settings)
    const standardSchedule = calculatePrayerSchedule(almaty, '2026-09-01', almaty.timeZone, { ...resolution.settings, asrMethod: 'standard' })
    expect(automaticSchedule.entries.asr.instant).not.toBe(standardSchedule.entries.asr.instant)
  })
})

describe('calculation preference validation', () => {
  it('uses automatic mode for new users and unsupported legacy profiles', () => {
    expect(restoreSourcePreferences(undefined)).toEqual(automatic)
    expect(restoreSourcePreferences({ mode: 'manual', source: { kind: 'calculated',
      calculation: { profile: 'dumRt', overrides: {} } } })).toEqual(automatic)
    expect(restoreSourcePreferences({ mode: 'manual', source: { kind: 'calculated',
      calculation: { profile: 'dumRf', overrides: {} } } })).toEqual(automatic)
  })


  it('restores profile defaults separately from explicit overrides', () => {
    const selection = { profile: 'turkey' as const, overrides: { asrMethod: 'hanafi' as const, isha: { kind: 'interval' as const, minutes: 100 } } }
    expect(effectiveCalculationSettings(selection)).toMatchObject({ profile: 'turkey', asrMethod: 'hanafi', isha: { kind: 'interval', minutes: 100 } })
    expect(selection.overrides).not.toHaveProperty('fajrAngle')
  })
})
