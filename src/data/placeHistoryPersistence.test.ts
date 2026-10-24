import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCityPlace, createGpsPlace, createLocalityPlace, withNearbyCity, type Place } from '../domain/place'
import { success } from '../domain/result'
import { createSettingsPersistence } from '../features/settings/settingsPersistence'
import { clearAppData, deleteVaqtProDatabase, getLocationChoice, getSetting, setSetting, type LocationChoice, type SettingsPatch } from '../storage/database'
import { createPrayerRepository, loadPrayerRepositoryOptionalSettings } from './prayerRepository'

const coarse = createGpsPlace({ latitude: 41.01, longitude: 28.95, accuracy: 500, timestamp: 100 }, 'Europe/Moscow', null, 'gps:operation:a')
const precise = { ...coarse, latitude: 41.03, accuracy: 10, timestamp: 200 }
const other = createGpsPlace({ latitude: 48, longitude: 20, accuracy: 20, timestamp: 300 }, 'Europe/Moscow', null, 'gps:operation:b')
const choice = (place: Place): LocationChoice => ({ mode: 'calculated', source: 'automatic', coordinates: place, place })
const event = (change: 'selection' | 'refinement', place: Place, expectedPlaceId: string | null = null): SettingsPatch => ({
  locationChoice: choice(place), placeEvents: [{ change, choice: choice(place), expectedPlaceId: change === 'selection' ? expectedPlaceId : place.id }],
})

async function history() {
  const result = await loadPrayerRepositoryOptionalSettings()
  if (!result.ok) throw new Error('History must be readable')
  return result.value.recentPlaces
}

afterEach(async () => { vi.restoreAllMocks(); await deleteVaqtProDatabase() })

describe('transactional place history', () => {
  it('stores a selected place and its recent history atomically, then updates the same GPS identity', async () => {
    const repo = createPrayerRepository()
    const legacy = Array.from({ length: 9 }, (_, index) => createLocalityPlace({ id: `legacy-${index}`, name: `Legacy ${index}`, latitude: 30 + index, longitude: 10 }, index))
    await setSetting('recentPlaces', legacy)
    await repo.saveSettings(event('selection', coarse))
    const selected = await history()
    expect(selected).toHaveLength(10)
    expect(selected[0]).toMatchObject({ id: 'gps:history:41.010000:28.950000', latitude: coarse.latitude })
    expect(await getLocationChoice()).toMatchObject({ value: { place: coarse } })

    await repo.saveSettings(event('refinement', precise))
    const refined = await history()
    expect(refined).toHaveLength(10)
    expect(refined[0]).toMatchObject({ id: selected[0]?.id, latitude: precise.latitude, accuracy: precise.accuracy })
    expect(refined.slice(1)).toEqual(selected.slice(1))
    expect(await getLocationChoice()).toMatchObject({ value: { place: precise } })
  })

  it('persists delayed nearby-city metadata in the same GPS snapshot without changing position or ordering', async () => {
    const repo = createPrayerRepository()
    await repo.saveSettings(event('selection', coarse))
    await repo.saveSettings(event('selection', other, coarse.id))
    const before = await history()
    const named = withNearbyCity(other, {
      id: 123, name: 'Стамбул, Восточный', countryCode: 'TR', admin1Name: 'Istanbul', admin1Code: '34',
      latitude: other.latitude, longitude: other.longitude, population: 100, timeZone: 'Europe/Istanbul',
    })
    expect(named).toMatchObject({ name: 'Стамбул, Восточный', nearbyCity: { cityName: 'Стамбул, Восточный' } })
    await repo.saveSettings(event('refinement', named))
    const after = await history()
    expect(after.map(place => place.id)).toEqual(before.map(place => place.id))
    expect(after.slice(1)).toEqual(before.slice(1))
    expect(after[0]).toMatchObject({ id: before[0]?.id, name: 'Стамбул, Восточный', latitude: other.latitude,
      longitude: other.longitude })
    expect(after[0]?.nearbyCity).toMatchObject({ cityName: 'Стамбул, Восточный' })
    const restored = await loadPrayerRepositoryOptionalSettings()
    expect(restored).toMatchObject({ ok: true, value: { recentPlaces: after } })
    const saved = await getLocationChoice()
    expect(saved).toMatchObject({ ok: true, value: { place: { name: 'Стамбул, Восточный', latitude: other.latitude,
      longitude: other.longitude } } })
    const withoutPermissionOrNetwork = await createPrayerRepository().initializeStartup()
    expect(withoutPermissionOrNetwork).toMatchObject({ ok: true, value: { recentPlaces: after } })
  })
  it('persists two same-named manual cities with distinct catalog identities and exact comma-containing names', async () => {
    const first = createCityPlace({ id: 101, name: 'Киров, Северный', admin1Name: 'Область А',
      admin1Code: '01', countryCode: 'RU', latitude: 55, longitude: 49, population: 100,
      timeZone: 'Europe/Moscow' }, 100)
    const second = createCityPlace({ id: 202, name: 'Киров, Северный', admin1Name: 'Область Б',
      admin1Code: '02', countryCode: 'RU', latitude: 56, longitude: 48, population: 100,
      timeZone: 'Europe/Moscow' }, 200)
    const repo = createPrayerRepository()
    await repo.saveSettings(event('selection', first))
    await repo.saveSettings(event('selection', second, first.id))
    const stored = await history()
    expect(stored.map(place => place.id)).toEqual([second.id, first.id])
    expect(stored.map(place => place.cityName)).toEqual(['Киров, Северный', 'Киров, Северный'])
    expect(stored[0]?.name).toContain('Область Б')
    expect(stored[1]?.name).toContain('Область А')
    const restored = await createPrayerRepository().initializeStartup()
    expect(restored).toMatchObject({ ok: true, value: { recentPlaces: [
      { id: second.id, cityName: 'Киров, Северный' },
      { id: first.id, cityName: 'Киров, Северный' },
    ] } })
  })
  it('ignores an asynchronous refinement after a newer place selection', async () => {
    const repo = createPrayerRepository()
    await repo.saveSettings(event('selection', coarse))
    await repo.saveSettings(event('selection', other, coarse.id))
    const before = await history()
    await repo.saveSettings(event('refinement', precise))

    expect(await history()).toEqual(before)
    expect(await getLocationChoice()).toMatchObject({ value: { place: other } })
  })

  it('preserves the active GPS entry identity through refinement and a later selection', async () => {
    const repo = createPrayerRepository()
    const saved = { ...coarse, id: 'gps:history:original-snapshot', timestamp: 1 }
    await setSetting('recentPlaces', [saved])
    await repo.saveSettings(event('selection', coarse))
    await repo.saveSettings(event('refinement', precise))
    expect(await history()).toEqual([expect.objectContaining({ id: saved.id, latitude: precise.latitude, accuracy: 10, timestamp: 200 })])

    const returned = { ...coarse, id: 'gps:new-operation', timestamp: 400 }
    await repo.saveSettings(event('selection', returned, coarse.id))
    const after = await history()
    expect(after.map(place => place.id)).toEqual(['gps:history:41.010000:28.950000', saved.id])
    expect(new Set(after.map(place => place.id)).size).toBe(2)
    expect(after.map(place => place.timestamp)).toEqual([400, 200])
  })

  it('serializes rapid selections and does not replay a committed command', async () => {
    const repo = createPrayerRepository()
    const committed = deferred()
    const returnWrite = deferred()
    let calls = 0
    const writer = createSettingsPersistence(async (patch, isCurrent) => {
      const result = await repo.saveSettings(patch, isCurrent)
      if (++calls === 1) { committed.resolve(); await returnWrite.promise }
      return result
    })
    writer.save(event('selection', coarse))
    await committed.promise
    writer.save(event('selection', other, coarse.id))
    returnWrite.resolve()
    await writer.drain()

    expect(await getLocationChoice()).toMatchObject({ value: { place: other } })
    expect((await history()).map(place => place.id)).toEqual(['gps:history:48.000000:20.000000', 'gps:history:41.010000:28.950000'])
  })

  it('normalizes recent places from current storage instead of a stale hydration snapshot', async () => {
    const repo = createPrayerRepository()
    await repo.saveSettings(event('selection', coarse))
    const stale = await history()
    await repo.saveSettings(event('selection', other, coarse.id))
    const latest = await history()
    await repo.saveSettings({ normalizeRecentPlaces: true, recentPlaces: stale })
    expect(await history()).toEqual(latest)
  })

  it('rolls back choice and history together when a history write fails', async () => {
    const repo = createPrayerRepository()
    await repo.saveSettings(event('selection', coarse))
    const before = await history()
    const put = Object.getOwnPropertyDescriptor(IDBObjectStore.prototype, 'put')?.value as IDBObjectStore['put'] | undefined
    const quota = vi.spyOn(IDBObjectStore.prototype, 'put')
    if (!put) throw new Error('Expected the real IndexedDB put implementation')
    quota.mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (value && typeof value === 'object' && 'key' in value && value.key === 'recentPlaces') throw new DOMException('quota', 'QuotaExceededError')
      return put.call(this, value, key)
    })

    expect(await repo.saveSettings(event('refinement', precise))).toMatchObject({ ok: false })
    quota.mockRestore()
    expect(await history()).toEqual(before)
    expect(await getLocationChoice()).toMatchObject({ value: { place: coarse } })
  })

  it('does not partially commit a transaction invalidated during its writes', async () => {
    const repo = createPrayerRepository()
    await repo.saveSettings(event('selection', coarse))
    const before = await history()
    let current = true
    const put = Object.getOwnPropertyDescriptor(IDBObjectStore.prototype, 'put')?.value as IDBObjectStore['put'] | undefined
    const invalidate = vi.spyOn(IDBObjectStore.prototype, 'put')
    if (!put) throw new Error('Expected the real IndexedDB put implementation')
    invalidate.mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      const request = put.call(this, value, key)
      if (value && typeof value === 'object' && 'key' in value && value.key === 'recentPlaces') current = false
      return request
    })

    expect(await repo.saveSettings(event('refinement', precise), () => current)).toMatchObject({ ok: false })
    invalidate.mockRestore()
    expect(await history()).toEqual(before)
    expect(await getLocationChoice()).toMatchObject({ value: { place: coarse } })
  })

  it('keeps reset data deleted when an obsolete repository tries to write', async () => {
    const repo = createPrayerRepository()
    await repo.initializeStartup()
    await repo.saveSettings(event('selection', coarse))
    await clearAppData()
    expect(await repo.saveSettings(event('refinement', precise))).toMatchObject({ ok: false })
    expect(await getSetting('recentPlaces')).toEqual(success(undefined))
    const fresh = createPrayerRepository()
    await fresh.saveSettings(event('refinement', precise))
    expect(await history()).toEqual([])
    expect(await getLocationChoice()).toEqual(success(undefined))
  })
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(yes => { resolve = yes })
  return { promise, resolve }
}
