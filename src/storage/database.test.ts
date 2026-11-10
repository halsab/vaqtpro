import { afterEach, describe, expect, it, vi } from 'vitest'
import { deleteVaqtProDatabase, getLocationChoice, getSetting,
  getStartupData, clearAppData, saveLocationChoice, setSetting } from './database'
import { type Result } from '../domain/result'
import type { LocationChoice } from './database'

interface LegacyFixture {
  settings?: ReadonlyArray<{ key: string; value: unknown }>
  day?: Record<string, unknown> & { locationId: string; date: string }
  meta?: unknown
}

async function createLegacyDatabase(version: number, fixture: LegacyFixture = {}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('salah', version)
    request.onerror = () => reject(request.error ?? new Error('Не удалось открыть IndexedDB'))
    request.onupgradeneeded = () => {
      const database = request.result
      database.createObjectStore('days', { keyPath: 'key' })
      database.createObjectStore('meta')
      database.createObjectStore('settings', { keyPath: 'key' })
      if (version >= 9) database.createObjectStore('control')
    }
    request.onsuccess = () => {
      const database = request.result
      const names = ['settings', ...(database.objectStoreNames.contains('days') ? ['days'] : []),
        ...(database.objectStoreNames.contains('meta') ? ['meta'] : []),
        ...(database.objectStoreNames.contains('control') ? ['control'] : [])]
      const transaction = database.transaction(names, 'readwrite')
      for (const setting of fixture.settings ?? []) transaction.objectStore('settings').put(setting)
      if (database.objectStoreNames.contains('control')) transaction.objectStore('control').put(0, 'generation')
      if (fixture.day) transaction.objectStore('days').put({ ...fixture.day, key: `${fixture.day.locationId}:${fixture.day.date}` })
      if (fixture.meta !== undefined) transaction.objectStore('meta').put(fixture.meta, 'current')
      transaction.onabort = () => reject(transaction.error ?? new Error('Не удалось записать legacy IndexedDB'))
      transaction.onerror = () => reject(transaction.error ?? new Error('Не удалось записать legacy IndexedDB'))
      transaction.oncomplete = () => { database.close(); resolve() }
    }
  })
}

async function databaseDetails(): Promise<{ version: number; stores: string[] }> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('salah')
    request.onerror = () => reject(request.error ?? new Error('Не удалось открыть IndexedDB'))
    request.onsuccess = () => {
      const database = request.result
      const result = { version: database.version, stores: Array.from(database.objectStoreNames).sort() }
      database.close()
      resolve(result)
    }
  })
}

function unwrap<Value>(result: Result<Value, unknown>): Value {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('Ожидался успешный результат')
  return result.value
}

afterEach(async () => { vi.unstubAllGlobals(); await deleteVaqtProDatabase() })

describe('calculation-only database', () => {

  it.each([4, 5, 12, 13, 14])('discards incompatible old prayer state on upgrade from v%s', async version => {
    await createLegacyDatabase(version, {
      day: { locationId: 'kazan', date: '2026-09-01', fajrStart: '02:21' },
      meta: { source: { name: 'old', years: [2026] } },
      settings: [
        { key: 'locationChoice', value: { mode: 'official', locationId: 'kazan', source: 'manual' } },
        { key: 'sourcePreferences', value: { mode: 'manual', source: { kind: 'official', provider: 'dumRt' } } },
        { key: 'calculationSettings', value: { profile: 'dumRt', highLatitudeRule: 'dumRt' } },
        { key: 'recentPlaces', value: [{ id: 'locality:kazan', selection: 'official' }] },
        { key: 'appearance', value: 'dark' },
        { key: 'calendarPreferences', value: { calendar: 'gregorian', correction: 2 } },
        { key: 'languagePreference', value: 'ru' },
        { key: 'fastingMode', value: { manualEnabled: true } },
      ],
    })
    const startup = unwrap(await getStartupData())
    expect(startup.choice).toBeUndefined()
    expect(startup.preferences).toBeUndefined()
    expect(unwrap(await getSetting('calculationSettings'))).toBeUndefined()
    expect(unwrap(await getSetting('recentPlaces'))).toBeUndefined()
    expect(unwrap(await getSetting('appearance'))).toBe('dark')
    expect(unwrap(await getSetting('calendarPreferences'))).toEqual({ calendar: 'gregorian', correction: 2 })
    expect(unwrap(await getSetting('languagePreference'))).toBe('ru')
    expect(unwrap(await getSetting('fastingMode'))).toEqual({ manualEnabled: true })
    expect(await databaseDetails()).toEqual({ version: 15, stores: ['control', 'settings'] })
  })


  it('retains new calculated selections across reads without rewriting them', async () => {
    const choice: LocationChoice = { mode: 'calculated', coordinates: {
      latitude: 55.79, longitude: 49.12, accuracy: null, timestamp: 1,
      timeZone: 'Europe/Moscow', name: 'Казань', source: 'preset',
    }, source: 'manual' }
    expect(await saveLocationChoice(choice)).toMatchObject({ ok: true })
    expect(await setSetting('appearance', 'dark')).toMatchObject({ ok: true })
    expect(unwrap(await getLocationChoice())).toMatchObject({ mode: 'calculated', coordinates: { latitude: 55.79 } })
    expect(unwrap(await getSetting('appearance'))).toBe('dark')
    expect(await databaseDetails()).toEqual({ version: 15, stores: ['control', 'settings'] })
  })


  it('clears user settings atomically and increments generation', async () => {
    const choice: LocationChoice = { mode: 'calculated', coordinates: {
      latitude: 55.79, longitude: 49.12, accuracy: null, timestamp: 1,
      timeZone: 'Europe/Moscow', name: 'Казань', source: 'preset',
    }, source: 'manual' }
    expect(await saveLocationChoice(choice)).toMatchObject({ ok: true })
    const before = unwrap(await getStartupData())
    expect(before.choice).toMatchObject({ mode: 'calculated' })
    expect((await clearAppData()).ok).toBe(true)
    const after = unwrap(await getStartupData())
    expect(after).toMatchObject({ generation: before.generation + 1, choice: undefined })
  })

  it('returns typed storage errors when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', { open: () => { throw new Error('IndexedDB disabled') } })
    expect(await getStartupData()).toEqual({ ok: false, error: { kind: 'storage', reason: 'unavailable' } })
  })
})
