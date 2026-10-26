import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCityPlace, createGpsPlace, createLocalityPlace } from '../domain/place'
import { automaticPreferences, manualCalculation } from '../domain/sourcePreferences'
import { success } from '../domain/result'
import { clearAppData, deleteVaqtProDatabase, getSetting, setSetting, type SettingsPatch } from '../storage/database'
import { TATARSTAN_LOCALITIES } from './tatarstanLocalities'
import { createPrayerRepository, initializePrayerRepository, loadPrayerRepositoryOptionalSettings } from './prayerRepository'

const locality = (id: string) => {
  const item = TATARSTAN_LOCALITIES.find(entry => entry.id === id)
  if (!item) throw new Error(`Unknown test locality: ${id}`)
  return item
}
const repository = createPrayerRepository()
afterEach(async () => { vi.unstubAllGlobals(); await deleteVaqtProDatabase() })

describe('calculation settings repository', () => {
  it('starts without a selected place or network access', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    expect(await initializePrayerRepository()).toMatchObject({ ok: true, value: {
      locationChoice: null, recentPlaces: [], themeFamily: 'seasonal', preferences: { mode: 'automatic' },
    } })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('preserves an explicitly saved classic theme across initialization', async () => {
    await repository.initialize()
    expect(await repository.saveSettings({ themeFamily: 'classic' })).toEqual(success(undefined))
    expect(await initializePrayerRepository()).toMatchObject({ ok: true, value: { themeFamily: 'classic' } })
  })

  it('restores optional settings consistently and clears them on reset', async () => {
    const recent = createLocalityPlace(locality('kazan'), 10)
    const calendarPreferences = { calendar: 'hijri', correction: 1 } as const
    const fastingMode = { manualEnabled: true }
    expect(await repository.saveSettings({ recentPlaces: [recent], calendarPreferences, themeFamily: 'seasonal',
      languagePreference: 'ru', fastingMode })).toEqual(success(undefined))

    const full = await initializePrayerRepository()
    const optional = await loadPrayerRepositoryOptionalSettings()
    expect(full).toMatchObject({ ok: true, value: { recentPlaces: [recent], calendarPreferences, themeFamily: 'seasonal', fastingMode } })
    expect(optional).toMatchObject({ ok: true, value: { recentPlaces: [recent], recentPlacesMigrated: false,
      calendarPreferences, themeFamily: 'seasonal', languagePreference: 'ru', fastingMode } })
    await clearAppData()
    expect(await initializePrayerRepository()).toMatchObject({ value: { locationChoice: null, recentPlaces: [],
      calendarPreferences: { calendar: 'gregorian', correction: 0 }, themeFamily: 'seasonal', languagePreference: 'auto' } })
  })

  it('preserves the chosen calculation profile, overrides and mode across restart', async () => {
    const preferences = manualCalculation({ profile: 'karachi', overrides: {
      asrMethod: 'standard', fajrAngle: 19, adjustments: { dhuhr: 2, isha: -5 },
    } })
    expect(await repository.saveSettings({ sourcePreferences: preferences })).toEqual(success(undefined))
    expect(await initializePrayerRepository()).toMatchObject({ value: { preferences } })
    expect(await getSetting('sourcePreferences')).toMatchObject({ value: preferences })
    if (preferences.mode !== 'manual') throw new Error('Expected manual calculation preferences')
    expect(await repository.saveSettings({ sourcePreferences: automaticPreferences(preferences.calculationDraft, preferences.source) })).toEqual(success(undefined))
    expect(await initializePrayerRepository()).toMatchObject({ value: { preferences: {
      mode: 'automatic', calculationDraft: preferences.calculationDraft, manualSourceDraft: preferences.source,
    } } })
  })

  it('safely ignores retired profile identifiers and obsolete official source values', async () => {
    await setSetting('sourcePreferences', { mode: 'manual', source: { kind: 'calculated',
      calculation: { profile: 'dumRt', overrides: { highLatitudeRule: 'dumRt' } } } } as never)
    expect(await initializePrayerRepository()).toMatchObject({ value: { preferences: { mode: 'automatic' } } })
    await setSetting('sourcePreferences', { mode: 'manual', source: { kind: 'calculated',
      calculation: { profile: 'dumRf', overrides: { highLatitudeRule: 'nearestDay' } } } } as never)
    expect(await initializePrayerRepository()).toMatchObject({ value: { preferences: { mode: 'automatic' } } })
    await setSetting('sourcePreferences', { mode: 'manual', source: { kind: 'official', provider: 'dumRt' },
      calculationDraft: { profile: 'karachi', overrides: { adjustments: { dhuhr: 3 } } } } as never)
    expect(await initializePrayerRepository()).toMatchObject({ value: { preferences: { mode: 'automatic' } } })
    expect(await repository.saveSettings({ sourcePreferences: {
      mode: 'manual', source: { kind: 'official', provider: 'dumRt' },
    } as never })).toMatchObject({ ok: false, error: { kind: 'data', reason: 'invalid' } })
  })

  it('stores a calculated city and GPS history without passive location side effects', async () => {
    const city = createCityPlace({ id: 1, name: 'Берлин', countryCode: 'DE', admin1Code: '16', admin1Name: 'Берлин',
      latitude: 52.5, longitude: 13.4, population: 100, timeZone: 'Europe/Berlin' }, 0)
    const gps = createGpsPlace({ latitude: 55.79, longitude: 49.12, accuracy: 20, timestamp: 100 }, 'Europe/Moscow', null, 'gps:history')
    expect(await repository.saveSettings({ locationChoice: { mode: 'calculated', coordinates: city, place: city, source: 'manual' },
      recentPlaces: [gps] })).toMatchObject({ ok: true })
    expect(await initializePrayerRepository()).toMatchObject({ value: { locationChoice: { place: city, source: 'manual' },
      recentPlaces: [expect.objectContaining({ selection: 'gps', timestamp: 100, latitude: 55.79 })] } })
  })

  it('migrates existing recents with the selected place in a deterministic order', async () => {
    const oldActive = createLocalityPlace(locality('kazan'), 10)
    const selected = createCityPlace({ id: 524901, name: 'Москва', countryCode: 'RU', admin1Code: '48', admin1Name: 'Москва',
      latitude: 55.7522, longitude: 37.6156, population: 1000, timeZone: 'Europe/Moscow' }, 20)
    await setSetting('recentPlaces', [oldActive])
    const choice = { mode: 'calculated' as const, coordinates: selected, place: selected, source: 'manual' as const }
    const patch: SettingsPatch = { locationChoice: choice, placeEvents: [{ change: 'selection', choice }] }

    expect(await repository.saveSettings(patch)).toEqual(success(undefined))
    expect(await initializePrayerRepository()).toMatchObject({ value: { locationChoice: { place: selected } } })
    expect(await loadPrayerRepositoryOptionalSettings()).toMatchObject({ value: {
      recentPlaces: [selected, oldActive], recentPlacesMigrated: true,
    } })
  })

  it('rejects invalid settings and malformed calculated places', async () => {
    expect(await repository.saveSettings({ sourcePreferences: {
      mode: 'manual', source: { kind: 'calculated', calculation: { profile: 'karachi', overrides: { fajrAngle: NaN } } },
    } as never })).toMatchObject({ ok: false, error: { kind: 'data', reason: 'invalid' } })
    expect(await repository.saveSettings({ locationChoice: { mode: 'calculated', coordinates: {} } as never }))
      .toMatchObject({ ok: false, error: { kind: 'data', reason: 'invalid' } })
  })
})
