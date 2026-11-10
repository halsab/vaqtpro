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
const city: City = { id: 1, name: 'Berlin', countryCode: 'DE', admin1Code: '16', admin1Name: 'Berlin', latitude: 52.52, longitude: 13.4, population: 1, timeZone: 'Europe/Berlin', featureCode: 'PPL' }
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
  it('ignores late coarse after precise and commits the named place canonical calculation anchor', async () => {
    const h = setup()
    let pending!: Promise<void>
    act(() => { pending = h.result.current.locate() })
    await act(async () => { h.precise.resolve(success(preciseFix)); await Promise.resolve() })
    await act(async () => { h.coarse.resolve(success(coarseFix)); await pending })
    expect(h.result.current.place).toMatchObject(preciseFix)
    await act(async () => { h.lookup.resolve(success({ ...city, name: 'Казань', latitude: 55.79, longitude: 49.12, timeZone: 'Europe/Samara' })); await Promise.resolve() })
    expect(h.result.current.place).toMatchObject({ id: 'geonames:1', selection: 'city', cityName: 'Казань',
      latitude: 55.79, longitude: 49.12, timeZone: 'Europe/Samara' })
  })

  it('re-anchors after a late precise fix moves beyond an early coarse-selected settlement', async () => {
    const h = setup({ loadGeography: vi.fn().mockResolvedValue(null) })
    const newLookup = deferred<Awaited<ReturnType<AppServices['cities']['findNearest']>>>()
    h.services.cities.findNearest = vi.fn().mockReturnValueOnce(h.lookup.promise).mockReturnValueOnce(newLookup.promise)
    let pending!: Promise<void>
    act(() => { pending = h.result.current.locate() })
    await act(async () => { h.coarse.resolve(success(goodCoarseFix)); await Promise.resolve() })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1_600)) })
    await waitFor(() => expect(h.services.cities.findNearest).toHaveBeenCalledTimes(1))
    await act(async () => {
      h.lookup.resolve(success({ ...city, name: 'First', latitude: goodCoarseFix.latitude, longitude: goodCoarseFix.longitude }))
      await Promise.resolve()
    })
    expect(h.result.current.place).toMatchObject({ selection: 'city', cityName: 'First' })
    const farPreciseFix = { ...preciseFix, latitude: 56.4, longitude: 50.0 }
    await act(async () => { h.precise.resolve(success(farPreciseFix)); await pending })
    expect(h.result.current.place).toMatchObject({ selection: 'gps', latitude: farPreciseFix.latitude })
    await waitFor(() => expect(h.services.cities.findNearest).toHaveBeenCalledTimes(2))
    await act(async () => {
      newLookup.resolve(success({ ...city, name: 'Second', latitude: farPreciseFix.latitude, longitude: farPreciseFix.longitude }))
      await Promise.resolve()
    })
    expect(h.result.current.place).toMatchObject({ selection: 'city', cityName: 'Second', latitude: farPreciseFix.latitude })
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
  it('keeps the canonical named-place anchor when a later GPS fix refines', async () => {
    const h = setup({ loadGeography: vi.fn().mockResolvedValue(null) })
    let pending!: Promise<void>
    act(() => { pending = h.result.current.locate() })
    await act(async () => { h.coarse.resolve(success(coarseFix)); await Promise.resolve() })
    await act(async () => {
      h.lookup.resolve(success({ ...city, countryCode: 'TR', latitude: coarseFix.latitude, longitude: coarseFix.longitude }))
      await Promise.resolve()
    })
    await act(async () => { h.precise.resolve(success(preciseFix)); await pending })
    expect(h.services.cities.findNearest).toHaveBeenCalledTimes(1)
    expect(h.result.current.place).toMatchObject({ selection: 'city', latitude: coarseFix.latitude, longitude: coarseFix.longitude })
    expect(resolvePrayerTimeSource(h.result.current.place as Place, automaticPreferences()))
      .toMatchObject({ kind: 'calculated', settings: { profile: 'turkey' } })
  })
  it('commits a late nearest place as a named canonical location', async () => {
    const h = setup()
    let pending!: Promise<void>
    act(() => { pending = h.result.current.locate() })
    await act(async () => { h.coarse.resolve(success(goodCoarseFix)); await Promise.resolve() })
    expect(h.persist.mock.calls.some(([, change]) => change === 'selection')).toBe(true)
    await act(async () => {
      h.lookup.resolve(success({ ...city, name: 'Казань', latitude: goodCoarseFix.latitude, longitude: goodCoarseFix.longitude }))
      await Promise.resolve()
    })
    await act(async () => { h.precise.resolve(failure({ kind: 'geolocation', reason: 'timeout' })); await pending })
    await waitFor(() => expect(h.result.current.place?.selection).toBe('city'))
    expect(h.result.current.place).toMatchObject({ selection: 'city', cityName: 'Казань',
      latitude: goodCoarseFix.latitude, longitude: goodCoarseFix.longitude, timeZone: 'Europe/Berlin' })
    expect(h.persist.mock.calls.some(([choice, change]) =>
      change === 'selection' && choice?.place?.selection === 'city'
      && choice.place.latitude === goodCoarseFix.latitude && choice.place.longitude === goodCoarseFix.longitude)).toBe(true)
  })
  it('uses the final refined GPS fix for one nearest-place lookup', async () => {
    const h = setup({ loadGeography: vi.fn().mockResolvedValue(null) })
    let pending!: Promise<void>
    act(() => { pending = h.result.current.locate() })
    await act(async () => { h.coarse.resolve(success(coarseFix)); await Promise.resolve() })
    await act(async () => { h.precise.resolve(success(preciseFix)); await Promise.resolve() })
    await act(async () => { await pending })
    expect(h.services.cities.findNearest).toHaveBeenCalledTimes(1)
    expect(h.services.cities.findNearest).toHaveBeenCalledWith(preciseFix.latitude, preciseFix.longitude, 25, false)
    await act(async () => {
      h.lookup.resolve(success({ ...city, countryCode: 'CA', latitude: preciseFix.latitude, longitude: preciseFix.longitude }))
      await Promise.resolve()
    })
    expect(h.result.current.place).toMatchObject({ selection: 'city', latitude: preciseFix.latitude, longitude: preciseFix.longitude })
    expect(resolvePrayerTimeSource(h.result.current.place as Place, automaticPreferences()))
      .toMatchObject({ kind: 'calculated', settings: { profile: 'canadaFcna' } })
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


