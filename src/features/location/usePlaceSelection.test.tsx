import { settingsServices, type TestSettingsServices } from '../../test/settingsServices'
import { createSettingsPersistence } from '../settings/settingsPersistence'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { usePlaceSelection } from './usePlaceSelection'
import type { AppServices } from '../../App'
import { success, failure } from '../../domain/result'
import { createGpsPlace, withNearbyCity, type Place } from '../../domain/place'
import { automaticPreferences } from '../../domain/sourcePreferences'
import { resolvePrayerTimeSource } from '../../domain/prayerSource'
import { parseCoverageGeometry } from '../../domain/localGeography'
import geometryData from '../../../public/data/tatarstan-boundary.json'
import type { City } from '../../domain/cities'

const geometry = parseCoverageGeometry(geometryData)
const locations = [{ id: 'kazan', name: 'Казань', latitude: 55.79, longitude: 49.12 }]
const coarseFix = { latitude: 55.79, longitude: 49.12, accuracy: 1200, timestamp: 100 }
const goodCoarseFix = { ...coarseFix, accuracy: 500 }
const preciseFix = { ...coarseFix, latitude: 55.8, accuracy: 10, timestamp: 200 }
const poorPreciseFix = { ...coarseFix, latitude: 55.791, accuracy: 1100, timestamp: 200 }
const city: City = { id: 1, name: 'Berlin', countryCode: 'DE', admin1Code: '16', admin1Name: 'Berlin', latitude: 52.52, longitude: 13.4, population: 1, timeZone: 'Europe/Berlin' }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { resolve, promise }
}
function setup(overrides: Partial<AppServices & TestSettingsServices> = {}, initial?: { place: Place; source: 'automatic' | 'manual' | 'default' }) {
  const coarse = deferred<Awaited<ReturnType<AppServices['getPosition']>>>()
  const precise = deferred<Awaited<ReturnType<AppServices['getPosition']>>>()
  const lookup = deferred<Awaited<ReturnType<AppServices['cities']['findNearest']>>>()
  const services = {
    loadGeography: vi.fn().mockResolvedValue(geometry),
    getPosition: vi.fn((accuracy: string) => accuracy === 'coarse' ? coarse.promise : precise.promise),
    getPermission: vi.fn().mockResolvedValue('granted'),
    getDeviceTimeZone: vi.fn(() => 'America/Los_Angeles'), now: () => new Date(1000),
    cities: { findNearest: vi.fn().mockReturnValue(lookup.promise) },
    ...settingsServices(overrides),
    ...overrides,
  } as unknown as AppServices & TestSettingsServices
  const chosen = vi.fn()
  const writer = createSettingsPersistence(services.saveSettings)
  const persistedChanges = new Set<string>()
  const persist = vi.fn((choice: Parameters<typeof writer.save>[0]['locationChoice'], change?: 'automatic' | 'selection' | 'refinement') => {
    if (change) persistedChanges.add(change)
    return writer.save(choice ? { locationChoice: choice } : {})
  })
  const hook = renderHook(() => usePlaceSelection(services, locations, chosen, persist, initial))
  return { ...hook, services, coarse, precise, lookup, chosen, persist, persistedChanges }
}

describe('one-shot GPS operations', () => {
  it('gives simultaneous tab operations distinct runtime identities even for identical fix timestamps', async () => {
    const a = setup()
    const b = setup()
    let pendingA!: Promise<void>
    let pendingB!: Promise<void>
    act(() => { pendingA = a.result.current.locate(); pendingB = b.result.current.locate() })
    await act(async () => {
      a.coarse.resolve(success(goodCoarseFix)); b.coarse.resolve(success(goodCoarseFix))
      a.precise.resolve(failure({ kind: 'geolocation', reason: 'timeout' }))
      b.precise.resolve(failure({ kind: 'geolocation', reason: 'timeout' }))
      await Promise.all([pendingA, pendingB])
    })
    expect(a.result.current.place?.id).not.toBe(b.result.current.place?.id)
    expect(a.result.current.place).toMatchObject(goodCoarseFix)
    expect(b.result.current.place).toMatchObject(goodCoarseFix)
  })
  it('does not reacquire a fresh restored GPS fix', () => {
    const place = createGpsPlace({ ...goodCoarseFix, timestamp: 1000 }, 'America/Los_Angeles', geometry, 'gps:cached')
    const h = setup({}, { place, source: 'automatic' })

    expect(h.result.current.place).toMatchObject({ id: 'gps:cached', timestamp: 1000 })
    expect(h.services.getPermission).not.toHaveBeenCalled()
    expect(h.services.getPosition).not.toHaveBeenCalled()
    h.unmount()
  })

  it('publishes a poor coarse point and waits for precise refinement before navigation', async () => {
    const h = setup()
    let pending!: Promise<void>
    act(() => { pending = h.result.current.locate() })
    await act(async () => { h.coarse.resolve(success(coarseFix)); await Promise.resolve() })
    expect(h.result.current.gpsPreview).toMatchObject({ ...coarseFix, coverage: 'inside', timeZone: 'America/Los_Angeles' })
    expect(h.result.current.place).toBeNull()
    expect(h.result.current.gpsState).toEqual({ status: 'refining' })
    expect(h.chosen).not.toHaveBeenCalled()
    expect(h.services.saveCalculatedLocation).not.toHaveBeenCalled()
    const id = h.result.current.gpsPreview?.id
    await act(async () => { h.precise.resolve(success(preciseFix)); await pending })
    expect(h.result.current.place).toMatchObject({ ...preciseFix, id })
    expect(h.result.current.gpsState).toEqual({ status: 'ready', lowAccuracy: false })
    expect(h.chosen).toHaveBeenCalledOnce()
    expect(h.services.saveCalculatedLocation).toHaveBeenCalledWith(expect.objectContaining(preciseFix), 'automatic', expect.any(Function))
  })
  it('finishes once after a sufficiently accurate coarse point while precise continues', async () => {
    const h = setup()
    let pending!: Promise<void>
    act(() => { pending = h.result.current.locate() })
    await act(async () => { h.coarse.resolve(success(goodCoarseFix)); await Promise.resolve() })
    expect(h.result.current.gpsState).toEqual({ status: 'ready', lowAccuracy: false })
    expect(h.chosen).toHaveBeenCalledOnce()
    expect(h.persist.mock.calls.filter(([, change]) => change === 'selection')).toHaveLength(1)
    await act(async () => { h.precise.resolve(success(preciseFix)); await pending })
    expect(h.chosen).toHaveBeenCalledOnce()
    expect(h.persist.mock.calls.filter(([, change]) => change === 'selection')).toHaveLength(1)
    expect(h.persist.mock.calls.some(([, change]) => change === 'refinement')).toBe(true)
  })
  it('keeps a final low-accuracy point available for explicit acceptance', async () => {
    const h = setup()
    let pending!: Promise<void>
    act(() => { pending = h.result.current.locate() })
    await act(async () => { h.coarse.resolve(success(coarseFix)); h.precise.resolve(success(poorPreciseFix)); await pending })
    expect(h.result.current.gpsPreview).toMatchObject(coarseFix)
    expect(h.result.current.place).toBeNull()
    expect(h.result.current.gpsState).toEqual({ status: 'ready', lowAccuracy: true })
    expect(h.chosen).not.toHaveBeenCalled()
    expect(h.persist).not.toHaveBeenCalled()
    act(() => h.result.current.acceptGps())
    expect(h.chosen).toHaveBeenCalledOnce()
    expect(h.persist.mock.calls.filter(([, change]) => change === 'selection')).toHaveLength(1)
  })

  it('clears a low-accuracy preview and its transient identity before a retry', async () => {
    const firstCoarse = deferred<Awaited<ReturnType<AppServices['getPosition']>>>()
    const firstPrecise = deferred<Awaited<ReturnType<AppServices['getPosition']>>>()
    const finalCoarse = deferred<Awaited<ReturnType<AppServices['getPosition']>>>()
    const finalPrecise = deferred<Awaited<ReturnType<AppServices['getPosition']>>>()
    const services = {
      loadGeography: vi.fn().mockResolvedValue(null),
      getPosition: vi.fn()
        .mockReturnValueOnce(firstCoarse.promise).mockReturnValueOnce(firstPrecise.promise)
        .mockRejectedValueOnce(new Error('permission request rejected')).mockRejectedValueOnce(new Error('position request rejected'))
        .mockReturnValueOnce(finalCoarse.promise).mockReturnValueOnce(finalPrecise.promise),
    }
    const h = setup(services)
    let first!: Promise<void>
    act(() => { first = h.result.current.locate() })
    await act(async () => {
      firstCoarse.resolve(success(coarseFix))
      firstPrecise.resolve(failure({ kind: 'geolocation', reason: 'unavailable' }))
      await first
    })
    const abandonedIdentity = h.result.current.gpsPreview?.id
    expect(abandonedIdentity).toBeTruthy()
    expect(h.result.current.gpsState).toEqual({ status: 'ready', lowAccuracy: true })
    expect(h.persist).not.toHaveBeenCalled()

    let retry!: Promise<void>
    act(() => { retry = h.result.current.locate() })
    expect(h.result.current.gpsPreview).toBeNull()
    expect(h.result.current.gpsState).toEqual({ status: 'locating' })
    expect(h.result.current.place).toBeNull()

    await act(async () => { await retry })
    expect(h.result.current.gpsState).toEqual({ status: 'error', reason: 'unavailable' })
    expect(h.result.current.gpsPreview).toBeNull()
    expect(h.result.current.place).toBeNull()
    expect(h.persist).not.toHaveBeenCalled()
    expect(h.chosen).not.toHaveBeenCalled()

    let final!: Promise<void>
    act(() => { final = h.result.current.locate() })
    await act(async () => {
      finalCoarse.resolve(success(goodCoarseFix))
      finalPrecise.resolve(failure({ kind: 'geolocation', reason: 'timeout' }))
      await final
    })
    expect(h.result.current.place?.id).not.toBe(abandonedIdentity)
    expect(h.result.current.place).toMatchObject(goodCoarseFix)
    expect(h.persist.mock.calls.filter(([, change]) => change === 'selection')).toHaveLength(1)
  })

  it('cancels an unaccepted GPS preview and ignores its delayed position and name callbacks', async () => {
    const confirmed = createGpsPlace({ latitude: 40, longitude: 29, accuracy: 20, timestamp: 1000 }, 'America/Los_Angeles', null, 'gps:confirmed')
    const h = setup({ loadGeography: vi.fn().mockResolvedValue(null) }, { place: confirmed, source: 'manual' })
    let pending!: Promise<void>
    act(() => { pending = h.result.current.locate() })
    await act(async () => { h.coarse.resolve(success(coarseFix)); await Promise.resolve() })
    expect(h.result.current.gpsPreview).toMatchObject(coarseFix)

    act(() => h.result.current.cancelInteractive())
    expect(h.result.current.place).toEqual(confirmed)
    expect(h.result.current.source).toBe('manual')
    const writesAtCancel = h.persist.mock.calls.length

    await act(async () => {
      h.precise.resolve(success(preciseFix))
      h.lookup.resolve(success(city))
      await pending
      await Promise.resolve()
    })
    expect(h.result.current.place).toEqual(confirmed)
    expect(h.persist).toHaveBeenCalledTimes(writesAtCancel)
    expect(h.chosen).not.toHaveBeenCalled()
  })

  it('synchronizes the confirmed device timezone without cancelling a pending interactive GPS fix', async () => {
    const confirmed = createGpsPlace({ latitude: 40, longitude: 29, accuracy: 30, timestamp: 1000 }, 'America/Los_Angeles', null, 'gps:confirmed')
    let deviceZone = 'America/Los_Angeles'
    const h = setup({ getDeviceTimeZone: vi.fn(() => deviceZone) }, { place: confirmed, source: 'automatic' })
    let pending!: Promise<void>
    act(() => { pending = h.result.current.locate() })
    await act(async () => { h.coarse.resolve(success(coarseFix)); await Promise.resolve() })
    expect(h.result.current.gpsPreview).toMatchObject(coarseFix)
    expect(h.result.current.gpsState).toEqual({ status: 'refining' })

    deviceZone = 'Europe/Berlin'
    act(() => { window.dispatchEvent(new PageTransitionEvent('pageshow')) })
    expect(h.result.current.place).toMatchObject({ id: confirmed.id, timeZone: 'Europe/Berlin' })
    expect(h.result.current.gpsPreview).toMatchObject({ ...coarseFix, timeZone: 'Europe/Berlin', automaticTimeZone: { id: 'Europe/Berlin', source: 'device' } })
    expect(h.result.current.gpsState).toEqual({ status: 'refining' })
    expect(h.persist.mock.calls.some(([choice]) => choice?.place?.latitude === coarseFix.latitude
      && choice.place.longitude === coarseFix.longitude)).toBe(false)

    await act(async () => { h.precise.resolve(success(preciseFix)); await pending })
    expect(h.result.current.place).toMatchObject({ ...preciseFix, timeZone: 'Europe/Berlin' })
    expect(h.result.current.gpsState).toEqual({ status: 'ready', lowAccuracy: false })
    expect(h.chosen).toHaveBeenCalledOnce()
    expect(h.persist.mock.calls.filter(([, change]) => change === 'selection')).toHaveLength(1)
  })

  it('does not reuse the previous GPS runtime identity for a distant new capture', async () => {
    const old = createGpsPlace({ latitude: 40, longitude: 29, accuracy: 20, timestamp: 50 }, 'UTC', null, 'gps:old-operation')
    const h = setup({ loadGeography: vi.fn().mockResolvedValue(null) }, { place: old, source: 'manual' })
    const farFix = { latitude: 41, longitude: 30, accuracy: 100, timestamp: 300 }
    let pending!: Promise<void>
    act(() => { pending = h.result.current.locate() })
    await act(async () => {
      h.precise.resolve(success(farFix))
      h.coarse.resolve(failure({ kind: 'geolocation', reason: 'timeout' }))
      await pending
    })
    expect(h.result.current.place?.id).not.toBe(old.id)
    expect(h.result.current.place).toMatchObject({ latitude: farFix.latitude, longitude: farFix.longitude })
  })

  it('invalidates GPS and name callbacks after a manual place selection', async () => {
    const h = setup({ loadGeography: vi.fn().mockResolvedValue(null) })
    let pending!: Promise<void>
    act(() => { pending = h.result.current.locate() })
    await act(async () => { h.coarse.resolve(success(goodCoarseFix)); await Promise.resolve() })
    act(() => h.result.current.selectLocality('kazan'))
    const afterSelection = h.persist.mock.calls.length
    await act(async () => {
      h.precise.resolve(success(preciseFix))
      h.lookup.resolve(success(city))
      await pending
      await Promise.resolve()
    })
    expect(h.result.current.place).toMatchObject({ selection: 'city', id: 'locality:kazan' })
    expect(h.persist.mock.calls).toHaveLength(afterSelection)
  })
  it('accepts provisional coarse once and still applies a late useful precise point', async () => {
    const h = setup()
    let pending!: Promise<void>
    act(() => { pending = h.result.current.locate() })
    await act(async () => { h.coarse.resolve(success(coarseFix)); await Promise.resolve() })
    act(() => h.result.current.acceptGps())
    expect(h.chosen).toHaveBeenCalledOnce()
    await act(async () => { h.precise.resolve(success(preciseFix)); await pending })
    expect(h.result.current.place).toMatchObject(preciseFix)
    expect(h.chosen).toHaveBeenCalledOnce()
  })
  it('ignores late coarse after precise and never replaces GPS coordinates with city coordinates', async () => {
    const h = setup()
    let pending!: Promise<void>
    act(() => { pending = h.result.current.locate() })
    await act(async () => { h.precise.resolve(success(preciseFix)); await Promise.resolve() })
    await act(async () => { h.coarse.resolve(success(coarseFix)); await pending })
    expect(h.result.current.place).toMatchObject(preciseFix)
    await act(async () => { h.lookup.resolve(success({ ...city, name: 'Казань', latitude: 55.79, longitude: 49.12, timeZone: 'Europe/Samara' })); await Promise.resolve() })
    expect(h.result.current.place).toMatchObject({ ...preciseFix, timeZone: 'America/Los_Angeles', name: 'Казань' })
  })
  it('retains useful coarse when precise fails', async () => {
    const h = setup()
    let pending!: Promise<void>
    act(() => { pending = h.result.current.locate() })
    await act(async () => { h.coarse.resolve(success(coarseFix)); h.precise.resolve(failure({ kind: 'geolocation', reason: 'timeout' })); await pending })
    expect(h.result.current.gpsPreview).toMatchObject(coarseFix)
    expect(h.result.current.gpsState).toEqual({ status: 'ready', lowAccuracy: true })
    expect(h.chosen).not.toHaveBeenCalled()
  })
  it('uses deterministic failure priority when both requests fail', async () => {
    const h = setup()
    let pending!: Promise<void>
    act(() => { pending = h.result.current.locate() })
    await act(async () => {
      h.coarse.resolve(failure({ kind: 'geolocation', reason: 'timeout' }))
      h.precise.resolve(failure({ kind: 'geolocation', reason: 'denied' }))
      await pending
    })
    expect(h.result.current.gpsState).toEqual({ status: 'error', reason: 'denied' })
    expect(h.result.current.place).toBeNull()
  })
  it('treats one valid fix and one error as a successful operation', async () => {
    const h = setup()
    let pending!: Promise<void>
    act(() => { pending = h.result.current.locate() })
    await act(async () => {
      h.coarse.resolve(success(goodCoarseFix))
      h.precise.resolve(failure({ kind: 'geolocation', reason: 'denied' }))
      await pending
    })
    expect(h.result.current.gpsState).toEqual({ status: 'ready', lowAccuracy: false })
    expect(h.chosen).toHaveBeenCalledOnce()
  })
  it('keeps a manual choice when delayed GPS fixes and lookup complete', async () => {
    const h = setup()
    let pending!: Promise<void>
    act(() => { pending = h.result.current.locate() })
    await act(async () => { h.coarse.resolve(success(coarseFix)); await Promise.resolve() })
    act(() => h.result.current.selectCity(city))
    await act(async () => { h.lookup.resolve(success(city)); h.precise.resolve(success(preciseFix)); await pending })
    expect(h.result.current.place).toMatchObject({ id: 'geonames:1', selection: 'city', timeZone: 'Europe/Berlin' })
    h.unmount()
  })
  it('allows package loading for interactive lookup and keeps background lookup local-only', async () => {
    const interactive = setup()
    let interactivePending!: Promise<void>
    act(() => { interactivePending = interactive.result.current.locate() })
    await act(async () => { interactive.coarse.resolve(success(goodCoarseFix)); await Promise.resolve() })
    expect(interactive.services.cities.findNearest).toHaveBeenCalledWith(goodCoarseFix.latitude, goodCoarseFix.longitude, 25, false)
    await act(async () => { interactive.precise.resolve(failure({ kind: 'geolocation', reason: 'timeout' })); await interactivePending })

    const background = setup()
    let backgroundPending!: Promise<void>
    act(() => { backgroundPending = background.result.current.locate(false) })
    await act(async () => { background.coarse.resolve(success(goodCoarseFix)); await Promise.resolve() })
    expect(background.services.cities.findNearest).toHaveBeenCalledWith(goodCoarseFix.latitude, goodCoarseFix.longitude, 25, true)
    await act(async () => { background.precise.resolve(failure({ kind: 'geolocation', reason: 'timeout' })); await backgroundPending })
    expect(background.persist.mock.calls.some(([, change]) => change === 'selection')).toBe(false)
  })
  it.each([
    [success(null), 'not-found'],
    [failure({ kind: 'data' as const, reason: 'offline' as const }), 'offline'],
  ] as const)('keeps coordinates when name lookup finishes as %s', async (lookupResult, expectedState) => {
    const h = setup()
    let pending!: Promise<void>
    act(() => { pending = h.result.current.locate() })
    await act(async () => { h.coarse.resolve(success(goodCoarseFix)); await Promise.resolve() })
    expect(h.result.current.nameLookupState).toBe('loading')
    await act(async () => { h.lookup.resolve(lookupResult); await Promise.resolve() })
    expect(h.result.current.nameLookupState).toBe(expectedState)
    expect(h.result.current.place).toMatchObject(goodCoarseFix)
    await act(async () => { h.precise.resolve(failure({ kind: 'geolocation', reason: 'timeout' })); await pending })
  })
  it('maps a rejected name lookup to failed without rolling back coordinates', async () => {
    const h = setup()
    h.services.cities.findNearest = vi.fn().mockRejectedValue(new Error('network'))
    let pending!: Promise<void>
    act(() => { pending = h.result.current.locate() })
    await act(async () => { h.coarse.resolve(success(goodCoarseFix)); await Promise.resolve() })
    await waitFor(() => expect(h.result.current.nameLookupState).toBe('failed'))
    expect(h.result.current.place).toMatchObject(goodCoarseFix)
    await act(async () => { h.precise.resolve(failure({ kind: 'geolocation', reason: 'timeout' })); await pending })
  })
  it('re-evaluates the automatic profile when a nearest-city country arrives', async () => {
    const h = setup({ loadGeography: vi.fn().mockResolvedValue(null) })
    let pending!: Promise<void>
    act(() => { pending = h.result.current.locate() })
    await act(async () => { h.coarse.resolve(success(goodCoarseFix)); await Promise.resolve() })
    expect(resolvePrayerTimeSource(h.result.current.place as Place, automaticPreferences()))
      .toMatchObject({ kind: 'calculated', settings: { profile: 'muslimWorldLeague', asrMethod: 'standard' } })
    await act(async () => {
      h.lookup.resolve(success({ ...city, countryCode: 'TR', latitude: goodCoarseFix.latitude, longitude: goodCoarseFix.longitude }))
      await Promise.resolve()
    })
    expect(h.result.current.place?.nearbyCity?.countryCode).toBe('TR')
    expect(resolvePrayerTimeSource(h.result.current.place as Place, automaticPreferences()))
      .toMatchObject({ kind: 'calculated', settings: { profile: 'turkey', asrMethod: 'standard' } })
    await act(async () => { h.precise.resolve(failure({ kind: 'geolocation', reason: 'timeout' })); await pending })
  })
  it('retains a country resolved before the precise fix without falling back to MWL', async () => {
    const h = setup({ loadGeography: vi.fn().mockResolvedValue(null) })
    let pending!: Promise<void>
    act(() => { pending = h.result.current.locate() })
    await act(async () => { h.coarse.resolve(success(coarseFix)); await Promise.resolve() })
    await act(async () => {
      h.lookup.resolve(success({ ...city, countryCode: 'TR', latitude: coarseFix.latitude, longitude: coarseFix.longitude }))
      await Promise.resolve()
    })
    expect(resolvePrayerTimeSource(h.result.current.gpsPreview as Place, automaticPreferences()))
      .toMatchObject({ kind: 'calculated', settings: { profile: 'turkey' } })
    await act(async () => { h.precise.resolve(success(preciseFix)); await pending })
    expect(h.result.current.place).toMatchObject({ ...preciseFix, nearbyCity: { countryCode: 'TR' } })
    expect(resolvePrayerTimeSource(h.result.current.place as Place, automaticPreferences()))
      .toMatchObject({ kind: 'calculated', settings: { profile: 'turkey' } })
  })
  it('retains the prior country when the refined fix lookup fails or finds nothing', async () => {
    const h = setup({ loadGeography: vi.fn().mockResolvedValue(null) })
    const secondLookup = deferred<Awaited<ReturnType<AppServices['cities']['findNearest']>>>()
    h.services.cities.findNearest = vi.fn().mockReturnValueOnce(h.lookup.promise).mockReturnValueOnce(secondLookup.promise)
    let pending!: Promise<void>
    act(() => { pending = h.result.current.locate() })
    await act(async () => { h.coarse.resolve(success(coarseFix)); await Promise.resolve() })
    await act(async () => {
      h.lookup.resolve(success({ ...city, countryCode: 'TR', latitude: coarseFix.latitude, longitude: coarseFix.longitude }))
      await Promise.resolve()
    })
    await act(async () => { h.precise.resolve(success(preciseFix)); await Promise.resolve() })
    await act(async () => { secondLookup.resolve(success(null)); await pending })
    expect(h.result.current.place).toMatchObject({ ...preciseFix, nearbyCity: { countryCode: 'TR' } })
    expect(resolvePrayerTimeSource(h.result.current.place as Place, automaticPreferences()))
      .toMatchObject({ kind: 'calculated', settings: { profile: 'turkey' } })
  })
  it('invalidates country metadata after refinement moves more than 25 km from its city', async () => {
    const h = setup({ loadGeography: vi.fn().mockResolvedValue(null) })
    const secondLookup = deferred<Awaited<ReturnType<AppServices['cities']['findNearest']>>>()
    h.services.cities.findNearest = vi.fn().mockReturnValueOnce(h.lookup.promise).mockReturnValueOnce(secondLookup.promise)
    const farPreciseFix = { ...preciseFix, latitude: 56.2 }
    let pending!: Promise<void>
    act(() => { pending = h.result.current.locate() })
    await act(async () => { h.coarse.resolve(success(coarseFix)); await Promise.resolve() })
    await act(async () => {
      h.lookup.resolve(success({ ...city, countryCode: 'TR', latitude: coarseFix.latitude, longitude: coarseFix.longitude }))
      await Promise.resolve()
    })
    await act(async () => { h.precise.resolve(success(farPreciseFix)); await Promise.resolve() })
    expect(h.result.current.place).toMatchObject(farPreciseFix)
    expect(h.result.current.place?.nearbyCity).toBeUndefined()
    expect(resolvePrayerTimeSource(h.result.current.place as Place, automaticPreferences()))
      .toMatchObject({ kind: 'calculated', settings: { profile: 'muslimWorldLeague' } })
    await act(async () => { secondLookup.resolve(success(null)); await pending })
  })
  it('restores a saved GPS country and calculation profile without another lookup', () => {
    const base = createGpsPlace(goodCoarseFix, 'UTC', null, 'gps:saved-country')
    const saved = withNearbyCity(base, { ...city, countryCode: 'CA', latitude: base.latitude, longitude: base.longitude })
    const h = setup()
    act(() => h.result.current.restore({ mode: 'calculated', coordinates: saved, source: 'automatic', place: saved }, []))
    expect(h.result.current.place).toMatchObject({ nearbyCity: { countryCode: 'CA' }, timeZone: 'America/Los_Angeles' })
    expect(resolvePrayerTimeSource(h.result.current.place as Place, automaticPreferences()))
      .toMatchObject({ kind: 'calculated', settings: { profile: 'canadaFcna' } })
    expect(h.services.cities.findNearest).not.toHaveBeenCalled()
    expect(h.services.getPosition).not.toHaveBeenCalled()
  })
  it('commits a late nearby-city name as an in-place refinement for the accepted GPS fix', async () => {
    const h = setup()
    let pending!: Promise<void>
    act(() => { pending = h.result.current.locate() })
    await act(async () => { h.coarse.resolve(success(goodCoarseFix)); await Promise.resolve() })
    expect(h.persist.mock.calls.some(([, change]) => change === 'selection')).toBe(true)
    await act(async () => {
      h.lookup.resolve(success({ ...city, name: 'Казань', latitude: goodCoarseFix.latitude, longitude: goodCoarseFix.longitude }))
      await Promise.resolve()
    })
    expect(h.result.current.place).toMatchObject({ name: 'Казань', ...goodCoarseFix })
    expect(h.persist.mock.calls.some(([choice, change]) =>
      change === 'refinement' && choice?.place?.name === 'Казань'
      && choice.place.latitude === goodCoarseFix.latitude && choice.place.longitude === goodCoarseFix.longitude)).toBe(true)
    await act(async () => { h.precise.resolve(failure({ kind: 'geolocation', reason: 'timeout' })); await pending })
  })
  it('ignores an obsolete nearest-city result after GPS refinement starts a newer lookup', async () => {
    const first = deferred<Awaited<ReturnType<AppServices['cities']['findNearest']>>>()
    const second = deferred<Awaited<ReturnType<AppServices['cities']['findNearest']>>>()
    let calls = 0
    const h = setup({ loadGeography: vi.fn().mockResolvedValue(null) })
    h.services.cities.findNearest = vi.fn(() => (++calls === 1 ? first.promise : second.promise))
    let pending!: Promise<void>
    act(() => { pending = h.result.current.locate() })
    await act(async () => { h.coarse.resolve(success(coarseFix)); await Promise.resolve() })
    await act(async () => { h.precise.resolve(success(preciseFix)); await Promise.resolve() })
    await waitFor(() => expect(h.services.cities.findNearest).toHaveBeenCalledTimes(2))
    await act(async () => {
      second.resolve(success({ ...city, countryCode: 'CA', latitude: preciseFix.latitude, longitude: preciseFix.longitude }))
      await Promise.resolve()
    })
    await act(async () => {
      first.resolve(success({ ...city, countryCode: 'RU', latitude: coarseFix.latitude, longitude: coarseFix.longitude }))
      await pending
    })
    expect(h.result.current.place).toMatchObject({ ...preciseFix, nearbyCity: { countryCode: 'CA' } })
    expect(resolvePrayerTimeSource(h.result.current.place as Place, automaticPreferences()))
      .toMatchObject({ kind: 'calculated', settings: { profile: 'canadaFcna' } })
  })
  it('ignores responses after unmount without saving', async () => {
    const h = setup()
    let pending!: Promise<void>
    act(() => { pending = h.result.current.locate() })
    h.unmount()
    await act(async () => { h.coarse.resolve(success(coarseFix)); h.precise.resolve(success(preciseFix)); await pending })
    expect(h.services.saveCalculatedLocation).not.toHaveBeenCalled()
  })
  it('ignores a saved GPS timezone override across restoration and a new GPS request', async () => {
    const h = setup()
    const saved = { ...createGpsPlace(coarseFix, 'UTC', geometry, 'gps:saved'), timeZone: 'America/New_York',
      timeZoneOverride: { id: 'America/New_York', source: 'user' as const } }
    act(() => h.result.current.restore({ mode: 'calculated', coordinates: saved, source: 'automatic', place: saved }, locations))
    expect(h.services.getPosition).not.toHaveBeenCalled()
    expect(h.result.current.place).toMatchObject({ timeZone: 'America/Los_Angeles', id: 'gps:saved' })
    expect(h.result.current.place).not.toHaveProperty('timeZoneOverride')
    let pending!: Promise<void>
    act(() => { pending = h.result.current.locate() })
    await act(async () => { h.precise.resolve(success(preciseFix)); h.coarse.resolve(success(coarseFix)); await pending })
    expect(h.result.current.place?.timeZone).toBe('America/Los_Angeles')
    act(() => h.result.current.selectCity(city))
  })
  it('serializes slow saves so the manual choice is persisted last', async () => {
    const save = deferred<Awaited<ReturnType<TestSettingsServices['saveCalculatedLocation']>>>()
    const h = setup({ saveCalculatedLocation: vi.fn().mockReturnValueOnce(save.promise).mockResolvedValue(success(undefined)) })
    act(() => { void h.result.current.locate() })
    await act(async () => { h.coarse.resolve(success(goodCoarseFix)); await Promise.resolve() })
    await waitFor(() => expect(h.services.saveCalculatedLocation).toHaveBeenCalledTimes(1))
    act(() => h.result.current.selectCity(city))
    expect(h.services.saveCalculatedLocation).toHaveBeenCalledTimes(1)
    await act(async () => { save.resolve(success(undefined)); h.precise.resolve(success(preciseFix)); await Promise.resolve() })
    await waitFor(() => expect(h.services.saveCalculatedLocation).toHaveBeenCalledTimes(2))
    expect(h.services.saveCalculatedLocation).toHaveBeenLastCalledWith(expect.objectContaining({ cityId: 1 }), 'manual', expect.any(Function))
  })
  it('uses explicit device fallback when geographic package is unavailable', async () => {
    const h = setup({ loadGeography: vi.fn().mockResolvedValue(null) })
    let pending!: Promise<void>
    act(() => { pending = h.result.current.locate() })
    await act(async () => { h.coarse.resolve(success(coarseFix)); h.precise.resolve(success(preciseFix)); await pending })
    expect(h.result.current.place).toMatchObject({ coverage: 'unavailable', timeZone: 'America/Los_Angeles' })
  })
})

it('a newer GPS request wins over both callbacks of the previous request', async () => {
  const h = setup()
  let first!: Promise<void>
  act(() => { first = h.result.current.locate() })
  const latest = { latitude: 40.71, longitude: -74.01, accuracy: 10, timestamp: 300 }
  vi.mocked(h.services.getPosition).mockResolvedValue(success(latest))
  await act(async () => { await h.result.current.locate() })
  await act(async () => { h.coarse.resolve(success(coarseFix)); h.precise.resolve(success(preciseFix)); await first })
  expect(h.result.current.place).toMatchObject(latest)
})

it('restores a legacy GPS coordinate with current device timezone without requesting location', () => {
  const h = setup()
  act(() => h.result.current.restore({ mode: 'calculated', source: 'manual', coordinates: { ...coarseFix, source: 'gps', timeZone: 'Europe/Moscow', name: 'Сохранённое имя' } }, locations))
  expect(h.result.current.place).toMatchObject({ timeZone: 'America/Los_Angeles', name: 'Сохранённое имя', automaticTimeZone: { source: 'device' } })
  expect(h.services.getPosition).not.toHaveBeenCalled()
})

it('recalls a saved GPS snapshot offline without changing its capture timestamp or requesting fresh geolocation', () => {
  const h = setup()
  const saved = createGpsPlace({ latitude: 40.7128, longitude: -74.006, accuracy: 42, timestamp: 12345 }, 'Europe/Moscow', null, 'gps:history:saved')
  act(() => h.result.current.selectRecent(saved))
  expect(h.result.current.place).toMatchObject({ latitude: 40.7128, longitude: -74.006, accuracy: 42, timestamp: 12345, timeZone: 'America/Los_Angeles' })
  expect(h.services.getPosition).not.toHaveBeenCalled()
  expect(h.services.cities.findNearest).not.toHaveBeenCalled()
  expect(h.chosen).toHaveBeenCalledOnce()
})
  it('updates restored GPS timezone on resume without another location lookup', () => {
    const h = setup()
    act(() => h.result.current.restore({ mode: 'calculated', source: 'automatic', coordinates: {
      ...coarseFix, source: 'gps', timeZone: 'America/Los_Angeles',
    } }, locations))
    expect(h.result.current.place?.timeZone).toBe('America/Los_Angeles')
    vi.mocked(h.services.getDeviceTimeZone).mockReturnValue('Asia/Tokyo')
    act(() => { window.dispatchEvent(new Event('pageshow')) })
    expect(h.result.current.place).toMatchObject({ timeZone: 'Asia/Tokyo', automaticTimeZone: { source: 'device' } })
    expect(h.services.getPosition).not.toHaveBeenCalled()
  })
