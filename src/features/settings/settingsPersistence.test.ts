import { expect, it, vi } from 'vitest'
import { failure, success } from '../../domain/result'
import { automaticPreferences } from '../../domain/sourcePreferences'
import { createGpsPlace } from '../../domain/place'
import type { SettingsPatch } from '../../storage/database'
import { createSettingsPersistence, type SaveSettings } from './settingsPersistence'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}

const a = { locationChoice: { mode: 'calculated' as const, source: 'manual' as const,
  coordinates: { latitude: 55.79, longitude: 49.12, timeZone: 'Europe/Moscow', accuracy: null, timestamp: 1 } } }
const b = { locationChoice: { mode: 'calculated' as const, source: 'manual' as const,
  coordinates: { latitude: 55.742, longitude: 52.399, timeZone: 'Europe/Moscow', accuracy: null, timestamp: 2 } } }


it('retries a selected place and its recent history as one settings snapshot', async () => {
  const place = createGpsPlace({ latitude: 40, longitude: -73, accuracy: 20, timestamp: 123 }, 'America/New_York', null, 'gps:history:40.000000:-73.000000')
  const selected: SettingsPatch = {
    locationChoice: { mode: 'calculated', source: 'manual', coordinates: place },
    placeEvents: [{ change: 'selection', choice: { mode: 'calculated', source: 'manual', coordinates: place } }],
    recentPlaces: [place],
    recentPlacesMigrated: true,
  }
  const save = vi.fn().mockResolvedValueOnce(failure({ kind: 'storage', reason: 'unavailable' })).mockResolvedValue(success(undefined))
  const writer = createSettingsPersistence(save)
  writer.save(selected)
  await writer.drain()
  expect(writer.getStatus()).toBe('failed')
  writer.retry()
  await writer.drain()
  expect(save.mock.calls[1]?.[0]).toEqual(selected)
  expect(writer.getStatus()).toBe('saved')
})


it('serializes rapid changes and keeps earlier unsaved fields', async () => {
  const first = deferred<Awaited<ReturnType<SaveSettings>>>()
  const last = deferred<Awaited<ReturnType<SaveSettings>>>()
  const save = vi.fn<SaveSettings>().mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise)
  const writer = createSettingsPersistence(save)
  writer.save(a)
  await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  writer.save(b)
  writer.save({ sourcePreferences: automaticPreferences() })
  first.resolve(failure({ kind: 'storage', reason: 'unavailable' }))
  await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
  expect(writer.getStatus()).toBe('saving')
  expect(save.mock.lastCall?.[0]).toEqual({ ...b, sourcePreferences: automaticPreferences() })
  last.resolve(success(undefined))
  await writer.drain()
  expect(writer.getStatus()).toBe('saved')
})

it('invalidates queued writes and waits for an in-flight write before reset', async () => {
  const pending = deferred<Awaited<ReturnType<SaveSettings>>>()
  const save = vi.fn<SaveSettings>().mockReturnValue(pending.promise)
  const writer = createSettingsPersistence(save)
  writer.save(a)
  await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  writer.save(b)
  const drain = writer.invalidateAndDrain()
  expect(save.mock.lastCall?.[1]()).toBe(false)
  pending.resolve(success(undefined))
  await drain
  expect(save).toHaveBeenCalledTimes(1)
  expect(writer.getStatus()).toBe('idle')
})

it('marks location work stale without invalidating a later unrelated setting', async () => {
  const pending = deferred<Awaited<ReturnType<SaveSettings>>>()
  const save = vi.fn<SaveSettings>().mockReturnValueOnce(pending.promise).mockResolvedValue(success(undefined))
  const writer = createSettingsPersistence(save)
  writer.save(a)
  await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  const isLocationCurrent = save.mock.calls[0]?.[2]
  writer.save({ sourcePreferences: automaticPreferences() })
  expect(isLocationCurrent?.()).toBe(false)
  pending.resolve(success(undefined))
  await writer.drain()
  expect(writer.getStatus()).toBe('saved')
})
