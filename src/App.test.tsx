import { settingsServices, type TestSettingsServices } from './test/settingsServices'
import { automaticPreferences, manualCalculation } from './domain/sourcePreferences'
import { selectionFromSettings } from './domain/calculationSettings'
import geometry from '../public/data/tatarstan-boundary.json'
import { parseCoverageGeometry } from './domain/localGeography'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App, type AppServices } from './App'
import type { GeolocationPermission } from './platform/browser'
import type { PrayerRepositoryOptionalSettings, PrayerRepositoryState } from './data/prayerRepository'
import {
  searchCities,
  type CityDataset,
} from './domain/cities'
import { calculatePrayerSchedule, DEFAULT_CALCULATION_SETTINGS } from './domain/prayerCalculation'
import { createCityPlace, createGpsPlace, createLocalityPlace, type Place } from './domain/place'
import { migrateRecentPlaces, rememberPlace } from './domain/recentPlaces'
import { scheduleContextKey, type ScheduleContext } from './domain/scheduleContext'
import { activateFastScheduleContext, FAST_SCHEDULE_STORAGE_KEYS, invalidateFastScheduleSnapshot,
  readFastScheduleSnapshot, writeFastScheduleSnapshot } from './features/schedule/fastScheduleSnapshot'
import { failure, success } from './domain/result'
import { setLanguagePreference } from './localization'
import { deleteVaqtProDatabase, getLocationChoice, setSetting, type SettingsPatch } from './storage/database'
import { createPrayerRepository, loadPrayerRepositoryOptionalSettings } from './data/prayerRepository'
import { THEME_PREFERENCE_CACHE_KEY } from './ui/themePreferenceCache'

type RemovedProviderTestStubs = {
  getDays: (locationId: string, dates: readonly string[]) => Promise<unknown>
  refresh: () => Promise<unknown>
  subscribe: () => () => void
}
type TestAppServices = AppServices & TestSettingsServices & RemovedProviderTestStubs

const cityDataset: CityDataset = {
  source: {
    name: 'GeoNames',
    url: 'https://www.geonames.org/',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    updatedAt: '2026-08-31',
  },
  cities: [
    [745044, 'Стамбул', ['стамбул', 'истанбул', 'istanbul'], 'TR', '34', 41.0138, 28.9497, 15_701_602, 'Europe/Istanbul', 'Стамбул', 'турция'],
    [524901, 'Москва', ['москва', 'москву', 'moscow'], 'RU', '48', 55.7522, 37.6156, 10_381_222, 'Europe/Moscow', 'Москва', 'россия'],
    [551487, 'Казань', ['казань', 'kazan'], 'RU', '73', 55.7946, 49.1115, 1_308_660, 'Europe/Moscow', 'Татарстан', 'россия татарстан'],
  ],
}

const defaultPlace = createCityPlace({ id: 551487, name: 'Казань', countryCode: 'RU', admin1Code: '73', admin1Name: 'Татарстан',
  latitude: 55.7946, longitude: 49.1115, population: 1_308_660, timeZone: 'Europe/Moscow' }, 0)

const initializedState = {
  locationChoice: { mode: 'calculated', coordinates: defaultPlace, place: defaultPlace, source: 'default' },
  themeFamily: 'classic',
  preferences: automaticPreferences(),
} satisfies PrayerRepositoryState

function initialized(overrides: Partial<PrayerRepositoryState> & { calculationSettings?: typeof DEFAULT_CALCULATION_SETTINGS } = {}) {
  return success({ ...initializedState, ...overrides, ...(overrides.calculationSettings ? { preferences: manualCalculation(selectionFromSettings(overrides.calculationSettings)) } : {}) })
}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function createServices(overrides: Partial<TestAppServices> = {}): TestAppServices {

  return {
    initialize: vi.fn().mockResolvedValue(initialized()),
    cities: {
      load: vi.fn().mockResolvedValue(success(undefined)),
      search: vi.fn().mockImplementation((query: string) =>
        Promise.resolve(success({cities:searchCities(cityDataset, query),status:'complete'})),
      ),
      findNearest: vi.fn().mockResolvedValue(success(null)),
    },
    getDays: vi.fn().mockResolvedValue(success([])),
    ...settingsServices(overrides),
    refresh: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(() => () => {}),
    invalidateAndDrain: vi.fn().mockResolvedValue(undefined),
    loadGeography: vi.fn().mockResolvedValue(parseCoverageGeometry(geometry)),
    getPermission: vi.fn().mockResolvedValue('prompt'),
    getPosition: vi.fn().mockResolvedValue(success({
      latitude: 55.742,
      longitude: 52.3992,
      accuracy: 500,
      timestamp: 1_788_265_600_000,
    })),
    getDeviceTimeZone: () => 'Europe/Moscow',
    getCalculationProfileCapability: () => ({ supported: true }),
    now: () => new Date('2026-09-01T10:00:00.000Z'),
    ...overrides,
  }
}

function selectedPlaces(patch?: SettingsPatch): Place[] {
  return patch?.placeEvents?.flatMap(event => event.change === 'selection' && event.choice.place ? [event.choice.place] : []) ?? []
}

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: key => { values.delete(key) },
    clear: () => values.clear(),
    key: index => [...values.keys()][index] ?? null,
    get length() { return values.size },
  }
}

function seedStartupSnapshot(services: AppServices, appVersion = 'warm-test', _includeNeighbors = false) {
  const selectedPlace = { ...defaultPlace, timestamp: services.now().getTime() }
  const settings = { ...DEFAULT_CALCULATION_SETTINGS, profile: 'tatarstan' as const, asrMethod: 'hanafi' as const, highLatitudeRule: 'tatarstan' as const }
  const context: ScheduleContext = {
    location: { id: selectedPlace.id, latitude: selectedPlace.latitude, longitude: selectedPlace.longitude },
    date: '2026-09-01', timeZone: 'Europe/Moscow', mode: 'automatic', source: 'calculated', settings,
  }
  const schedule = calculatePrayerSchedule(context.location, context.date, context.timeZone, settings)
  const generation = invalidateFastScheduleSnapshot()
  if (!generation || !activateFastScheduleContext(scheduleContextKey(context), generation)) {
    throw new Error('Could not activate the test cache')
  }
  if (!writeFastScheduleSnapshot({ appVersion, now: services.now(), deviceTimeZone: services.getDeviceTimeZone(),
    generation, context, schedule, place: selectedPlace, selectionSource: 'default', preferences: automaticPreferences(),
    })) throw new Error('Could not write the test cache')
  return context
}

describe('VaqtPro', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()))
  afterEach(() => vi.unstubAllGlobals())


  it('calculates a selected place without waiting for or starting timetable updates', async () => {
    const initialization = deferred<Awaited<ReturnType<AppServices['initialize']>>>()
    const services = createServices({ initialize: vi.fn(() => initialization.promise) })
    render(<App services={services} />)

    await userEvent.click(screen.getByRole('button', { name: 'Найти место' }))
    await userEvent.type(screen.getByRole('searchbox'), 'Москва')
    await userEvent.click(await screen.findByRole('button', { name: /Москва/ }))
    expect(await screen.findByRole('timer')).toBeVisible()
    expect(services.refresh).not.toHaveBeenCalled()

    await act(async () => { initialization.resolve(initialized()); await initialization.promise })
    await waitFor(() => expect(services.initialize).toHaveBeenCalledTimes(1))
    expect(services.refresh).not.toHaveBeenCalled()
  })

  it('shows the calculated cached home while IndexedDB reads remain pending', async () => {
    const initialization = deferred<Awaited<ReturnType<AppServices['initialize']>>>()
    const neighbors = deferred<unknown>()
    const services = createServices({ initialize: vi.fn(() => initialization.promise), getDays: vi.fn(() => neighbors.promise) })
    seedStartupSnapshot(services, 'warm-test', true)
    const view = render(<App services={services} version="warm-test" />)
    expect(await screen.findByRole('timer', { name: /До Асра/ })).toBeVisible()
    expect(within(screen.getByRole('list', { name: 'Расписание дня' })).getByText('16:24')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Настройки' })).toBeEnabled()
    view.unmount()
  })






  it('сохраняет проверенное расписание и даёт повторить неудачную инициализацию', async () => {
    const localStore = memoryStorage()
    vi.stubGlobal('localStorage', localStore)
    const services = createServices({
      initialize: vi.fn().mockResolvedValueOnce(failure({ kind: 'storage', reason: 'unavailable' })).mockResolvedValue(initialized()),
    })
    seedStartupSnapshot(services)
    render(<App services={services} version="warm-test" />)

    expect(within(screen.getByRole('list', { name: 'Расписание дня' })).getByText('16:24')).toBeVisible()
    const recovery = await screen.findByRole('alert')
    expect(recovery).toHaveTextContent('Показано сохранённое расписание')
    await userEvent.click(within(recovery).getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(services.initialize).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('Показано сохранённое расписание')).not.toBeInTheDocument())
    expect(within(screen.getByRole('list', { name: 'Расписание дня' })).getByText('16:24')).toBeVisible()
  })




  it('удаляет тёплый снимок синхронно до попытки очистить пользовательские данные', async () => {
    const localStore = memoryStorage()
    vi.stubGlobal('localStorage', localStore)
    const clear = deferred<Awaited<ReturnType<NonNullable<AppServices['clearAppData']>>>>()
    const clearAppData = vi.fn(() => clear.promise)
    const services = createServices({ clearAppData, initialize: vi.fn().mockResolvedValue(initialized({ themeFamily: 'seasonal' })) })
    seedStartupSnapshot(services)
    const oldMarker = JSON.parse(localStore.getItem(FAST_SCHEDULE_STORAGE_KEYS.activeContext) ?? 'null') as { generation: string }
    const view = render(<App services={services} version="warm-test" />)
    expect(await screen.findByRole('timer', { name: /До Асра/ })).toBeVisible()
    expect(JSON.parse(localStore.getItem(THEME_PREFERENCE_CACHE_KEY) ?? 'null')).toEqual({ version: 1, themeFamily: 'seasonal' })
    expect(localStore.getItem(FAST_SCHEDULE_STORAGE_KEYS.snapshot)).not.toBeNull()

    await userEvent.click(await screen.findByRole('button', { name: 'Настройки' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Данные и конфиденциальность' }))
    await userEvent.click(screen.getByRole('button', { name: 'Удалить данные' }))
    await userEvent.click(screen.getByRole('button', { name: 'Удалить данные' }))
    await waitFor(() => expect(clearAppData).toHaveBeenCalledTimes(1))

    expect(localStore.getItem(FAST_SCHEDULE_STORAGE_KEYS.snapshot)).toBeNull()
    expect(localStore.getItem(THEME_PREFERENCE_CACHE_KEY)).toBeNull()
    const marker = JSON.parse(localStore.getItem(FAST_SCHEDULE_STORAGE_KEYS.activeContext) ?? 'null') as { generation: string; contextKey: string | null }
    expect(marker.contextKey).toBeNull()
    expect(marker.generation).not.toBe(oldMarker.generation)

    await act(async () => { clear.resolve(failure({ kind: 'storage', reason: 'unavailable' })); await clear.promise })
    expect(await screen.findByRole('alert')).toBeVisible()
    expect(JSON.parse(localStore.getItem(THEME_PREFERENCE_CACHE_KEY) ?? 'null')).toEqual({ version: 1, themeFamily: 'seasonal' })
    expect(document.documentElement.dataset.theme).toBe('seasonal')
    await waitFor(() => expect(readFastScheduleSnapshot({ appVersion: 'warm-test', now: services.now(),
      deviceTimeZone: services.getDeviceTimeZone() })).toMatchObject({ context: { date: '2026-09-01' }, schedule: { entries: { asr: { time: '16:24' } } } }))
    const restoredMarker = JSON.parse(localStore.getItem(FAST_SCHEDULE_STORAGE_KEYS.activeContext) ?? 'null') as { generation: string; contextKey: string | null }
    const restoredSnapshot = readFastScheduleSnapshot({ appVersion: 'warm-test', now: services.now(), deviceTimeZone: services.getDeviceTimeZone() })
    expect(restoredSnapshot).not.toBeNull()
    if (!restoredSnapshot) throw new Error('Failed deletion did not restore the valid cached schedule')
    expect(restoredMarker.contextKey).toBe(scheduleContextKey(restoredSnapshot.context))
    expect(restoredMarker.generation).not.toBe(oldMarker.generation)
    view.unmount()
  })




  it('автоматически сохраняет параметры, повторяет неудачную запись и сохраняет старые поправки', async () => {
    const initial = manualCalculation({ profile: 'karachi', overrides: { fajrAngle: 19 } })
    const saveSettings = vi.fn().mockResolvedValueOnce(failure({ kind: 'storage', reason: 'unavailable' })).mockResolvedValue(success(undefined))
    const services = createServices({ initialize: vi.fn().mockResolvedValue(initialized({ preferences: initial })), saveSettings })
    render(<App services={services} />)
    await screen.findByRole('timer', { name: /До Асра/ })
    await userEvent.click(await screen.findByRole('button', { name: 'Настройки' }))
    await userEvent.click(screen.getByRole('button', { name: /Расписание/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Параметры' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Аср' }), 'standard')
    expect(await screen.findByText('Не удалось сохранить изменения')).toBeVisible()
    await userEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(screen.queryByText('Не удалось сохранить изменения')).not.toBeInTheDocument())
    expect(saveSettings).toHaveBeenLastCalledWith({ sourcePreferences: manualCalculation({ profile: 'karachi', overrides: { fajrAngle: 19, asrMethod: 'standard' } }) }, expect.any(Function))
    await userEvent.click(screen.getByRole('button', { name: 'Назад' }))
    await userEvent.click(screen.getByRole('button', { name: 'Параметры' }))
    expect(screen.getByRole('combobox', { name: 'Аср' })).toHaveValue('standard')
    expect(screen.getByText('Сохранены прежние поправки')).toBeVisible()
  })

  it('завершает поиск одним тапом и сохраняет предыдущий город в недавних', async () => {
    const services = createServices()
    render(<App services={services} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Казань' }))
    await userEvent.click(screen.getByRole('button', { name: 'Найти место' }))
    await userEvent.type(screen.getByRole('searchbox'), 'Москва')
    await userEvent.click(await screen.findByRole('button', { name: /Москва/ }))
    expect(await screen.findByRole('region', { name: 'Главная' })).toBeVisible()
    await waitFor(() => expect(vi.mocked(services.saveSettings).mock.calls.some(([patch]) =>
      selectedPlaces(patch).some(place => place.id === 'geonames:524901'))).toBe(true))
    await userEvent.click(screen.getByRole('button', { name: /Москва/ }))
    const recent = screen.getByRole('region', { name: 'Недавние места' })
    await userEvent.click(within(recent).getByRole('button', { name: /Казань/ }))
    expect(await screen.findByRole('button', { name: 'Казань' })).toBeVisible()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })






  it('открывает месячное расписание из выбора даты, переключает месяц и возвращается без выбора дня', async () => {
    render(<App services={createServices()} />)
    await screen.findByRole('timer')
    await userEvent.click(screen.getByRole('button', { name: 'Выбрать дату' }))
    await userEvent.click(screen.getByRole('button', { name: /Расписание на месяц/ }))

    expect(await screen.findByRole('heading', { name: 'сентябрь 2026' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Назад' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Экспортировать расписание на месяц' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Предыдущий месяц' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Следующий месяц' })).toBeVisible()
    expect(document.querySelector('details, summary, .prayer-month-method')).toBeNull()
    expect(screen.getAllByRole('row')).toHaveLength(31)
    const firstRow = screen.getAllByRole('row')[1]
    if (!firstRow) throw new Error('Monthly schedule must render the first date row')
    const firstDate = within(firstRow).getByRole('rowheader', { name: '01.09.2026' })
    expect(firstDate).toHaveTextContent(/^01 вт$/)
    expect(firstDate.querySelector('time')).toHaveAttribute('dateTime', '2026-09-01')
    expect(within(firstRow).getAllByRole('cell')).toHaveLength(7)
    expect(firstRow.querySelector('button, a')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Следующий месяц' }))
    expect(screen.getByRole('heading', { name: 'октябрь 2026' })).toBeVisible()
    expect(screen.getAllByRole('row')).toHaveLength(32)

    await userEvent.click(screen.getByRole('button', { name: 'Назад' }))
    expect(await screen.findByRole('combobox', { name: 'День' })).toBeVisible()
  })



















  it('первый запуск не выбирает город и не запрашивает GPS сам', async () => {
    const services = createServices({ initialize: vi.fn().mockResolvedValue(initialized({ locationChoice: null })) })
    render(<App services={services} />)
    expect(await screen.findByRole('heading', { name: 'Выберите место' })).toBeVisible()
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
    expect(services.getPosition).not.toHaveBeenCalled()
    expect(services.refresh).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Найти место' }))
    await userEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(screen.getByRole('heading', { name: 'Выберите место' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'По геопозиции' }))
    expect(await screen.findByRole('region', { name: 'Главная' })).toBeVisible()
    expect(services.getPosition).toHaveBeenCalledTimes(2)
  })





  it('игнорирует позднее разрешение startup GPS после ручного выбора', async () => {
    const permission = deferred<GeolocationPermission>()
    const services = createServices({ initialize: vi.fn().mockResolvedValue(initialized({ locationChoice: { mode: 'official', locationId: 'kazan', source: 'automatic' } })), getPermission: vi.fn(() => permission.promise) })
    render(<App services={services} />)
    await screen.findByRole('button', { name: 'Казань' })
    await chooseCity('Челны', /Набережные Челны.*Татарстан/)
    await act(async () => { permission.resolve('granted'); await permission.promise })
    expect(services.getPosition).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Набережные Челны' })).toBeVisible()
  })




















  it('при быстрых сменах города скрывает старую таблицу и игнорирует запоздалый ответ', async () => {
    const services = createServices()
    render(<App services={services} />)
    await screen.findByRole('timer')
    await chooseCity('Челны', /Набережные Челны.*Татарстан/)
    expect(screen.getByRole('timer')).toBeVisible()
    await expectSchedule()
    expect(within(screen.getByRole('list')).getByText('Аср')).toBeVisible()
    expect(services.getDays).not.toHaveBeenCalled()
  })










})

function homeDate() {
  const value = screen.getByRole('button', { name: 'Выбрать дату' }).querySelector('time')
  if (!value) throw new Error('Главная дата расписания не отображается')
  return value
}

async function chooseGregorianDate(date: string) {
  const [year, month, day] = date.split('-')
  await userEvent.click(screen.getByRole('button', { name: 'Выбрать дату' }))
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Год' }), String(Number(year)))
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Месяц' }), String(Number(month)))
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'День' }), String(Number(day)))
  await userEvent.click(screen.getByRole('button', { name: 'Назад' }))
  await screen.findByRole('list', { name: 'Расписание дня' })
}

async function showGpsKazan(deviceTimeZone: string, currentInstant: string) {
  const now = new Date(currentInstant)
  const services = createServices({
    initialize: vi.fn().mockResolvedValue(initialized({ locationChoice: null })),
    getDeviceTimeZone: () => deviceTimeZone,
    getPosition: vi.fn().mockResolvedValue(success({
      latitude: 55.7946,
      longitude: 49.1115,
      accuracy: 50,
      timestamp: now.getTime(),
    })),
    now: () => new Date(now),
    getDays: vi.fn().mockResolvedValue(success([])),
  })
  render(<App services={services} />)
  await userEvent.click(await screen.findByRole('button', { name: 'По геопозиции' }))
  await screen.findByRole('button', { name: '55.7946, 49.1115' })
  await screen.findByRole('list', { name: 'Расписание дня' })
  return services
}

async function expectSchedule() {
  expect(await screen.findByRole('list', { name: 'Расписание дня' })).toBeVisible()
}
async function openSource() {
  await userEvent.click(await screen.findByRole('button', { name: 'Настройки' }))
  await userEvent.click(screen.getByRole('button', { name: /^Расписание/ }))
}
async function backHomeFromSource() {
  await userEvent.click(screen.getByRole('button', { name: 'Назад' }))
  await waitFor(() => expect(screen.getByRole('button', { name: /^Расписание/ })).toHaveFocus())
  await userEvent.click(screen.getByRole('button', { name: 'Назад' }))
  await screen.findByRole('region', { name: 'Главная' })
}
async function chooseCity(query: string, result: string | RegExp, current: string | RegExp = 'Казань') {
  await userEvent.click(screen.getByRole('button', { name: current }))
  await userEvent.click(screen.getByRole('button', { name: 'Найти место' }))
  await userEvent.type(screen.getByRole('searchbox'), query)
  await userEvent.click(await screen.findByRole('button', { name: result }))
  await screen.findByRole('region', { name: 'Главная' })
}
