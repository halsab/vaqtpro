import { afterEach, expect, it, vi } from 'vitest'
import { openDB } from 'idb'
import { automaticPreferences, manualCalculation } from '../domain/sourcePreferences'
import { clearAppData, deleteVaqtProDatabase, getDataGeneration, getSetting, saveSettings, setSetting } from './database'

afterEach(deleteVaqtProDatabase)

it('атомарно удаляет пользовательские настройки, сохраняя соединение и увеличивая поколение', async () => {
  await setSetting('sourcePreferences', automaticPreferences())
  const connection = await openDB('salah')
  await connection.put('settings', { key: 'legacy-private', value: { coordinates: [55, 49] } })
  const generation = await getDataGeneration()

  expect((await clearAppData()).ok).toBe(true)
  expect(await connection.getAll('settings')).toEqual([])
  expect(await getDataGeneration()).toBe(generation + 1)
  connection.close()
})

it('отсекает запись старой вкладки и разрешает запись новой сессии', async () => {
  const generation = await getDataGeneration()
  await clearAppData()

  expect((await saveSettings({ sourcePreferences: automaticPreferences() }, () => true, generation)).ok).toBe(false)
  expect(await getSetting('sourcePreferences')).toEqual({ ok: true, value: undefined })
  expect((await saveSettings({ sourcePreferences: automaticPreferences() }, () => true, await getDataGeneration())).ok).toBe(true)
})

it('не восстанавливает настройки после повторной инициализации', async () => {
  const { createPrayerRepository } = await import('../data/prayerRepository')
  const first = createPrayerRepository()
  await first.initialize()
  await first.saveSettings({ appearance: 'dark', sourcePreferences: manualCalculation({ profile: 'tatarstan', overrides: {} }) })

  await clearAppData()
  expect((await first.saveSettings({ appearance: 'dark' })).ok).toBe(false)
  const second = createPrayerRepository()
  const result = await second.initialize()
  expect(result.ok && result.value).toMatchObject({
    locationChoice: null, appearance: 'system', themeFamily: 'seasonal', preferences: { mode: 'automatic' },
  })
  expect((await second.saveSettings({ appearance: 'light' })).ok).toBe(true)
})

it('откатывает неудачную очистку и разрешает повторить её без частичного удаления', async () => {
  await setSetting('appearance', 'dark')
  const before = await getDataGeneration()
  const clear = Object.getOwnPropertyDescriptor(IDBObjectStore.prototype, 'clear')?.value as IDBObjectStore['clear']
  const injected = vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(function (this: IDBObjectStore) {
    if (this.name === 'settings') throw new DOMException('Storage unavailable', 'InvalidStateError')
    return clear.call(this)
  })

  expect(await clearAppData()).toEqual({ ok: false, error: { kind: 'storage', reason: 'unavailable' } })
  expect(await getDataGeneration()).toBe(before)
  expect(await getSetting('appearance')).toEqual({ ok: true, value: 'dark' })
  injected.mockRestore()
  expect(await clearAppData()).toEqual({ ok: true, value: undefined })
  expect(await getSetting('appearance')).toEqual({ ok: true, value: undefined })
})

it('не сохраняет настройки, если операция устарела до записи', async () => {
  const generation = await getDataGeneration()
  expect((await saveSettings({ appearance: 'dark' }, () => false, generation)).ok).toBe(false)
  const current = vi.fn().mockReturnValueOnce(true).mockReturnValue(false)
  expect((await saveSettings({ appearance: 'dark' }, current, generation)).ok).toBe(false)
  expect(await getSetting('appearance')).toEqual({ ok: true, value: 'system' })
})
