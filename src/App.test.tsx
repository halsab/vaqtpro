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
        Promise.resolve(success({cities:searchCities(cityDataset, query),status:'complete',missingPackages:[]})),
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

  it('показывает оболочку холодного запуска, пока IndexedDB ещё не ответила', async () => {
    vi.stubGlobal('localStorage', memoryStorage())
    const initialization = deferred<Awaited<ReturnType<AppServices['initialize']>>>()
    const services = createServices({ initialize: vi.fn(() => initialization.promise) })
    const view = render(<App services={services} />)

    expect(screen.getByRole('heading', { name: 'Выберите место' })).toBeVisible()
    expect(document.documentElement.dataset.theme).toBe('seasonal')
    expect(screen.queryByRole('button', { name: 'Настройки' })).not.toBeInTheDocument()
    expect(services.getPosition).not.toHaveBeenCalled()
    expect(services.initialize).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    await act(async () => { initialization.resolve(initialized()); await initialization.promise })
    view.unmount()
    vi.unstubAllGlobals()
  })

  it('calculates a selected place without waiting for or starting timetable updates', async () => {
    const initialization = deferred<Awaited<ReturnType<AppServices['initialize']>>>()
    const services = createServices({ initialize: vi.fn(() => initialization.promise) })
    render(<App services={services} />)

    await userEvent.click(screen.getByRole('button', { name: 'Найти город' }))
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

  it('continues using the calculated snapshot without requesting legacy schedule data', async () => {
    const initialization = deferred<Awaited<ReturnType<AppServices['initialize']>>>()
    const services = createServices({ initialize: vi.fn(() => initialization.promise),
      getDays: vi.fn().mockResolvedValue(failure({ kind: 'storage', reason: 'unavailable' })) })
    seedStartupSnapshot(services, 'warm-test', true)
    const view = render(<App services={services} version="warm-test" />)
    await screen.findByRole('timer')
    expect(services.getDays).not.toHaveBeenCalled()
    expect(within(screen.getByRole('list', { name: 'Расписание дня' })).getByText('16:24')).toBeVisible()
    view.unmount()
  })

  it('рисует проверенный однодневный снимок до завершения IndexedDB и дополняет контекст отдельно', async () => {
    const localStore = memoryStorage()
    vi.stubGlobal('localStorage', localStore)
    const initialization = deferred<Awaited<ReturnType<AppServices['initialize']>>>()
    const neighbors = deferred<unknown>()
    const services = createServices({
      initialize: vi.fn(() => initialization.promise),
      getDays: vi.fn<RemovedProviderTestStubs['getDays']>((_id, _dates) => neighbors.promise),
    })
    seedStartupSnapshot(services)

    const view = render(<App services={services} version="warm-test" />)
    const list = screen.getByRole('list', { name: 'Расписание дня' })
    expect(within(list).getByText('16:24')).toBeVisible()
    expect(services.initialize).toHaveBeenCalledTimes(1)
    expect(services.getDays).not.toHaveBeenCalled()
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()

    expect(await screen.findByRole('timer', { name: /До Асра/ })).toBeVisible()
    await act(async () => { initialization.resolve(initialized()); await initialization.promise })
    await expectSchedule()
    expect(services.initialize).toHaveBeenCalledTimes(1)
    view.unmount()
    vi.unstubAllGlobals()
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

  it('waits for in-flight repository work to drain before retry initialization', async () => {
    const drain = deferred<undefined>()
    const invalidateAndDrain = vi.fn(() => drain.promise)
    const initialize = vi.fn().mockResolvedValueOnce(failure({ kind: 'storage', reason: 'unavailable' }))
      .mockResolvedValue(initialized())
    const user = userEvent.setup()
    render(<App services={createServices({ initialize, invalidateAndDrain })} />)

    await screen.findByRole('alert')
    expect(initialize).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Попробовать снова' }))
    await waitFor(() => expect(invalidateAndDrain).toHaveBeenCalledOnce())
    expect(initialize).toHaveBeenCalledOnce()

    await act(async () => { drain.resolve(undefined); await drain.promise })
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(2))
  })

  it('объясняет ошибку дополнительных настроек без заявления о показанном сохранённом расписании', async () => {
    const services = createServices({
      loadOptionalSettings: vi.fn().mockRejectedValue(new Error('storage unavailable')),
    })
    render(<App services={services} />)

    const recovery = await screen.findByRole('alert')
    expect(recovery).toHaveTextContent('Не удалось загрузить дополнительные настройки из хранилища')
    expect(recovery).not.toHaveTextContent('Показано сохранённое расписание')
  })

  it('не запрашивает расписание после гидратации автоматического расчётного источника', async () => {
    const services = createServices()
    render(<App services={services} />)
    await screen.findByRole('timer')
    expect(services.getDays).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Казань/ })).toBeVisible()
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

  it('игнорирует необязательные настройки, прочитанные до успешного сброса', async () => {
    localStorage.setItem(THEME_PREFERENCE_CACHE_KEY, JSON.stringify({ version: 1, themeFamily: 'classic' }))
    localStorage.setItem('vaqtpro.analytics.enabled', 'false')
    const optional = deferred<Awaited<ReturnType<NonNullable<AppServices['loadOptionalSettings']>>>>()
    const clearAppData = vi.fn().mockResolvedValue(success(undefined))
    const loadOptionalSettings = vi.fn(() => optional.promise)
    const startupState: PrayerRepositoryState = { ...initializedState }
    delete startupState.themeFamily
    render(<App services={createServices({
      initializeStartup: vi.fn().mockResolvedValue(success(startupState)),
      loadOptionalSettings, clearAppData,
    })} />)
    await screen.findByRole('timer')
    await waitFor(() => expect(loadOptionalSettings).toHaveBeenCalledTimes(1))

    await userEvent.click(screen.getByRole('button', { name: 'Настройки' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Данные и конфиденциальность' }))
    await userEvent.click(screen.getByRole('button', { name: 'Удалить данные' }))
    await userEvent.click(screen.getByRole('button', { name: 'Удалить данные' }))
    await waitFor(() => expect(clearAppData).toHaveBeenCalledTimes(1))
    expect(localStorage.getItem(THEME_PREFERENCE_CACHE_KEY)).toBeNull()
    expect(localStorage.getItem('vaqtpro.analytics.enabled')).toBe('false')

    await act(async () => {
      optional.resolve(success({ recentPlaces: [], recentPlacesMigrated: false, calendarPreferences: { calendar: 'hijri', correction: 1 },
        themeFamily: 'seasonal', languagePreference: 'ru', fastingMode: { manualEnabled: true } }))
      await optional.promise
    })
    expect(localStorage.getItem(THEME_PREFERENCE_CACHE_KEY)).toBeNull()
    expect(localStorage.getItem('vaqtpro.analytics.enabled')).toBe('false')
    expect(document.documentElement.dataset.theme).toBe('seasonal')
  })

  it('не повторяет инициализацию и не сбрасывает текущий экран при смене языкового предпочтения', async () => {
    const services = createServices()
    render(<App services={services} />)
    await screen.findByRole('timer')
    expect(services.getDays).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Выбрать дату' }))
    const initializationCount = vi.mocked(services.initialize).mock.calls.length
    const refreshCount = vi.mocked(services.refresh).mock.calls.length

    try {
      act(() => setLanguagePreference('ru'))
      expect(await screen.findByRole('combobox', { name: 'Календарь' })).toBeVisible()
      expect(services.initialize).toHaveBeenCalledTimes(initializationCount)
      expect(services.refresh).toHaveBeenCalledTimes(refreshCount)
    } finally {
      act(() => setLanguagePreference('auto'))
    }
  })

  it('показывает icon-only кнопку настроек с доступным именем', async () => {
    render(<App services={createServices()} />)
    await screen.findByRole('timer')
    const settings = await screen.findByRole('button', { name: 'Настройки' })
    expect(settings.querySelectorAll(':scope > span')).toHaveLength(0)
    expect(settings.querySelector('svg[aria-hidden="true"] path')).toBeInTheDocument()
    expect(settings.querySelector('svg[aria-hidden="true"] circle')).toBeInTheDocument()
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
    await userEvent.click(screen.getByRole('button', { name: 'Найти город' }))
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

  it('сливает загруженную позднее legacy history с выбором, сделанным во время startup', async () => {
    const optional = deferred<Awaited<ReturnType<NonNullable<AppServices['loadOptionalSettings']>>>>()
    const oldManual = createLocalityPlace({ id: 'naberezhnye-chelny', name: 'Набережные Челны', latitude: 55.742, longitude: 52.3992 }, 1)
    const stored = { locationChoice: { mode: 'official' as const, locationId: 'kazan', source: 'default' as const },
      recentPlaces: [oldManual], recentPlacesMigrated: false }
    const saveSettings = vi.fn<AppServices['saveSettings']>(patch => {
      if (selectedPlaces(patch).length) {
        const baseline = stored.recentPlacesMigrated ? stored.recentPlaces : migrateRecentPlaces(stored.recentPlaces,
          defaultPlace)
        stored.recentPlaces = selectedPlaces(patch).reduce((history, place) => rememberPlace(history, place), baseline)
        stored.recentPlacesMigrated = true
      }
      Object.assign(stored, patch)
      return Promise.resolve(success(undefined))
    })
    let loadCount = 0
    const loadOptionalSettings = vi.fn<NonNullable<AppServices['loadOptionalSettings']>>().mockImplementation(() => {
      loadCount += 1
      return loadCount === 1 ? optional.promise : Promise.resolve(success({ recentPlaces: stored.recentPlaces,
        recentPlacesMigrated: stored.recentPlacesMigrated, calendarPreferences: { calendar: 'gregorian', correction: 0 },
        themeFamily: 'classic', languagePreference: 'ru', fastingMode: { manualEnabled: false } } satisfies PrayerRepositoryOptionalSettings))
    })
    const services = createServices({
      initializeStartup: vi.fn().mockResolvedValue(initialized()),
      loadOptionalSettings,
      saveSettings,
    })
    render(<App services={services} />)
    await screen.findByRole('timer')
    await waitFor(() => expect(services.loadOptionalSettings).toHaveBeenCalledOnce())
    await chooseCity('Москва', /Москва/)
    await waitFor(() => expect(services.loadOptionalSettings).toHaveBeenCalledTimes(2))
    await act(async () => {
      optional.resolve(success({ recentPlaces: [oldManual], recentPlacesMigrated: false,
        calendarPreferences: { calendar: 'gregorian', correction: 0 }, themeFamily: 'classic', languagePreference: 'ru', fastingMode: { manualEnabled: false } }))
      await optional.promise
    })
    await userEvent.click(screen.getByRole('button', { name: 'Москва' }))
    const recent = screen.getByRole('region', { name: 'Недавние места' })
    expect(within(recent).getByRole('button', { name: /Казань/ })).toBeVisible()
    expect(within(recent).getByRole('button', { name: /Набережные Челны/ })).toBeVisible()
    expect(stored.recentPlaces.map(place => place.id)).toEqual(expect.arrayContaining(['geonames:524901', 'geonames:551487', 'locality:naberezhnye-chelny']))
    expect(selectedPlaces(saveSettings.mock.calls[0]?.[0]).map(place => place.id)).toEqual(['geonames:524901'])
  })

  it('keeps the pre-startup selection newest while migrating a full legacy history', async () => {
    const storage = memoryStorage()
    storage.setItem = () => { throw new Error('fast cache unavailable') }
    vi.stubGlobal('localStorage', storage)
    const initialization = deferred<Awaited<ReturnType<NonNullable<AppServices['initializeStartup']>>>>()
    const optional = deferred<Awaited<ReturnType<NonNullable<AppServices['loadOptionalSettings']>>>>()
    const previousCurrent = createLocalityPlace({ id: 'naberezhnye-chelny', name: 'Набережные Челны', latitude: 55.742, longitude: 52.3992 }, 10)
    const legacyHistory = Array.from({ length: 10 }, (_, index) => index === 2
      ? previousCurrent
      : createLocalityPlace({ id: `legacy-${index}`, name: `Legacy ${index}`, latitude: 35 + index, longitude: 20 + index }, index))
    const startupState: PrayerRepositoryState = {
      ...initializedState,
      locationChoice: { mode: 'official', locationId: 'naberezhnye-chelny', source: 'manual' },
    }
    delete startupState.recentPlaces
    delete startupState.recentPlacesMigrated
    const persistedSettings = { locationChoice: { mode: 'official' as const, locationId: 'naberezhnye-chelny', source: 'manual' as const },
      recentPlaces: legacyHistory, recentPlacesMigrated: false }
    const saveSettings = vi.fn<AppServices['saveSettings']>(patch => {
      if (selectedPlaces(patch).length) {
        const baseline = persistedSettings.recentPlacesMigrated
          ? persistedSettings.recentPlaces
          : migrateRecentPlaces(persistedSettings.recentPlaces, previousCurrent)
        persistedSettings.recentPlaces = selectedPlaces(patch).reduce((history, place) => rememberPlace(history, place), baseline)
        persistedSettings.recentPlacesMigrated = true
      }
      if (patch.locationChoice) persistedSettings.locationChoice = patch.locationChoice as typeof persistedSettings.locationChoice
      return Promise.resolve(success(undefined))
    })
    const services = createServices({
      initializeStartup: vi.fn(() => initialization.promise),
      loadOptionalSettings: vi.fn().mockRejectedValueOnce(new Error('storage unavailable')).mockImplementationOnce(() => optional.promise),
      saveSettings,
    })
    render(<App services={services} />)

    await userEvent.click(screen.getByRole('button', { name: 'Найти город' }))
    await userEvent.type(screen.getByRole('searchbox'), 'Москва')
    await userEvent.click(await screen.findByRole('button', { name: /Москва/ }))
    expect(await screen.findByRole('button', { name: 'Москва' })).toBeVisible()
    await waitFor(() => expect(saveSettings).toHaveBeenCalledOnce())
    expect(saveSettings.mock.calls[0]?.[0]).toMatchObject({
      locationChoice: { mode: 'calculated', coordinates: { cityId: 524901 } },
    })
    expect(selectedPlaces(saveSettings.mock.calls[0]?.[0]).map(place => place.id)).toEqual(['geonames:524901'])
    expect(persistedSettings.locationChoice).toMatchObject({ source: 'manual', place: { id: 'geonames:524901' } })

    await act(async () => { initialization.resolve(success(startupState)); await initialization.promise })
    await waitFor(() => expect(services.loadOptionalSettings).toHaveBeenCalledOnce())
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить дополнительные настройки')
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(services.loadOptionalSettings).toHaveBeenCalledTimes(2))
    await act(async () => {
      optional.resolve(success({ recentPlaces: persistedSettings.recentPlaces, recentPlacesMigrated: persistedSettings.recentPlacesMigrated,
        calendarPreferences: { calendar: 'gregorian', correction: 0 }, themeFamily: 'classic', languagePreference: 'ru', fastingMode: { manualEnabled: false } }))
      await optional.promise
    })

    const expectedIds = [
      'geonames:524901', 'locality:naberezhnye-chelny',
      'locality:legacy-0', 'locality:legacy-1', 'locality:legacy-3', 'locality:legacy-4',
      'locality:legacy-5', 'locality:legacy-6', 'locality:legacy-7', 'locality:legacy-8',
    ]
    const persisted = persistedSettings.recentPlaces
    expect(persisted.map(place => place.id)).toEqual(expectedIds)
    expect(persistedSettings.locationChoice).toMatchObject({ source: 'manual', place: { id: 'geonames:524901' } })
    expect(persisted.filter(place => place.id === 'locality:naberezhnye-chelny')).toHaveLength(1)
    expect(persisted.some(place => place.id === 'locality:legacy-9')).toBe(false)

    await userEvent.click(screen.getByRole('button', { name: 'Москва' }))
    const recent = screen.getByRole('region', { name: 'Недавние места' })
    expect(within(recent).getAllByRole('button').map(button => button.textContent.trim())).toEqual([
      'Набережные Челны', 'Legacy 0', 'Legacy 1', 'Legacy 3', 'Legacy 4',
      'Legacy 5', 'Legacy 6', 'Legacy 7', 'Legacy 8',
    ])
    expect(within(recent).queryByRole('button', { name: 'Москва' })).not.toBeInTheDocument()
  })

  it('persists an accepted selection when optional history fails without retry and restores it after remount', async () => {
    const initialization = deferred<Awaited<ReturnType<NonNullable<AppServices['initializeStartup']>>>>()
    const stored: { locationChoice: PrayerRepositoryState['locationChoice'] } = { locationChoice: initializedState.locationChoice }
    const saveSettings = vi.fn<AppServices['saveSettings']>(patch => {
      if (patch.locationChoice) stored.locationChoice = patch.locationChoice
      return Promise.resolve(success(undefined))
    })
    const services = createServices({
      initializeStartup: vi.fn(() => initialization.promise),
      loadOptionalSettings: vi.fn().mockRejectedValue(new Error('optional storage unavailable')),
      saveSettings,
    })
    const first = render(<App services={services} />)
    await userEvent.click(screen.getByRole('button', { name: 'Найти город' }))
    await userEvent.type(screen.getByRole('searchbox'), 'Москва')
    await userEvent.click(await screen.findByRole('button', { name: /Москва/ }))
    await waitFor(() => expect(saveSettings).toHaveBeenCalledOnce())
    expect(selectedPlaces(saveSettings.mock.calls[0]?.[0])).toHaveLength(1)
    expect(stored.locationChoice).toMatchObject({ source: 'manual', place: { id: 'geonames:524901' } })

    await act(async () => { initialization.resolve(initialized()); await initialization.promise })
    await waitFor(() => expect(services.loadOptionalSettings).toHaveBeenCalledOnce())
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить дополнительные настройки')

    first.unmount()
    const restarted = createServices({
      initializeStartup: vi.fn().mockResolvedValue(initialized({ locationChoice: stored.locationChoice })),
      loadOptionalSettings: vi.fn().mockRejectedValue(new Error('optional storage still unavailable')),
    })
    render(<App services={restarted} />)
    expect(await screen.findByRole('button', { name: 'Москва' })).toBeVisible()
  })

  it('reports a failed explicit-place write and retries the same accepted selection atomically', async () => {
    const saveSettings = vi.fn<AppServices['saveSettings']>()
      .mockResolvedValueOnce(failure({ kind: 'storage', reason: 'unavailable' }))
      .mockResolvedValue(success(undefined))
    const services = createServices({
      initializeStartup: vi.fn().mockResolvedValue(initialized()),
      loadOptionalSettings: vi.fn().mockRejectedValue(new Error('optional storage unavailable')),
      saveSettings,
    })
    render(<App services={services} />)
    await screen.findByRole('timer')
    await chooseCity('Москва', /Москва/)
    expect(await screen.findByText('Не удалось сохранить изменения')).toBeVisible()
    const acceptedPatch = saveSettings.mock.calls[0]?.[0]
    expect(acceptedPatch).toMatchObject({
      locationChoice: { mode: 'calculated', coordinates: { cityId: 524901 } },
    })
    expect(selectedPlaces(acceptedPatch).map(place => place.id)).toEqual(['geonames:524901'])
    await userEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(2))
    if (!acceptedPatch) throw new Error('Expected the first accepted-place persistence attempt')
    expect(saveSettings.mock.calls[1]?.[0]).toMatchObject(acceptedPatch)
    expect(screen.queryByText('Не удалось сохранить изменения')).not.toBeInTheDocument()
  })

  it('переключает календарь без смены дня, применяет поправку и выбирает дату сразу', async () => {
    const services = createServices()
    render(<App services={services} />)
    await screen.findByRole('timer')
    await userEvent.click(screen.getByRole('button', { name: 'Выбрать дату' }))
    expect(screen.queryByRole('button', { name: 'Сегодня' })).not.toBeInTheDocument()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Календарь' }), 'hijri')
    expect(screen.getByRole('combobox', { name: 'День' })).toHaveValue('19')
    expect(screen.getByRole('combobox', { name: 'Месяц' })).toHaveValue('3')
    expect(screen.getByRole('combobox', { name: 'Год' })).toHaveValue('1448')
    expect(screen.queryByText(/Умм|Метод/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Готово' })).not.toBeInTheDocument()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Поправка даты' }), '1')
    expect(screen.getByRole('combobox', { name: 'День' })).toHaveValue('20')
    expect(screen.queryByRole('button', { name: 'Сегодня' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Назад' }))
    expect(await screen.findByRole('timer')).toHaveAccessibleName(/До Асра/)
    expect(screen.getByRole('button', { name: 'Выбрать дату' })).toHaveTextContent('20 раби авв.')
    expect(screen.getByRole('button', { name: 'Выбрать дату' })).toHaveAccessibleDescription(/раби аль-авваль/)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Выбрать дату' })).toHaveFocus())
    await userEvent.click(screen.getByRole('button', { name: 'Выбрать дату' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'День' }), '21')
    expect(screen.getByRole('button', { name: 'Сегодня' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Назад' }))
    expect(await screen.findByRole('list')).toHaveTextContent('Аср')
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Выбрать дату' }))
    await userEvent.click(screen.getByRole('button', { name: 'Сегодня' }))
    expect(screen.queryByRole('button', { name: 'Сегодня' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'День' })).toHaveFocus()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Календарь' }), 'gregorian')
    expect(screen.getByRole('combobox', { name: 'День' })).toHaveValue('1')
    expect(screen.queryByRole('combobox', { name: 'Поправка даты' })).not.toBeInTheDocument()
    await waitFor(() => expect(services.saveSettings).toHaveBeenLastCalledWith({ calendarPreferences: { calendar: 'gregorian', correction: 1 } }, expect.any(Function)))
  })

  it('открывает месячное расписание из выбора даты, переключает месяц и возвращается без выбора дня', async () => {
    render(<App services={createServices()} />)
    await screen.findByRole('timer')
    await userEvent.click(screen.getByRole('button', { name: 'Выбрать дату' }))
    await userEvent.click(screen.getByRole('button', { name: /Расписание на месяц/ }))

    expect(await screen.findByRole('heading', { name: 'сентябрь 2026' })).toBeVisible()
    expect(screen.getAllByRole('row')).toHaveLength(31)
    const firstRow = screen.getAllByRole('row')[1]
    if (!firstRow) throw new Error('Monthly schedule must render the first date row')
    expect(firstRow).toHaveTextContent('01.09.2026')
    expect(within(firstRow).getAllByRole('cell')).toHaveLength(6)
    expect(firstRow.querySelector('button, a')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Следующий месяц' }))
    expect(screen.getByRole('heading', { name: 'октябрь 2026' })).toBeVisible()
    expect(screen.getAllByRole('row')).toHaveLength(32)

    await userEvent.click(screen.getByRole('button', { name: 'Назад' }))
    expect(await screen.findByRole('combobox', { name: 'День' })).toBeVisible()
  })

  it('сохраняет автоактивацию текущей ночи Рамадана при просмотре другой даты', async () => {
    const services = createServices({
      now: () => new Date('2026-02-17T18:30:00.000Z'),
      getDays: vi.fn().mockResolvedValue(success([])),
    })
    render(<App services={services} />)

    await screen.findByRole('list', { name: 'Расписание дня' })
    expect(await screen.findByText('До начала поста')).toBeVisible()
    await chooseGregorianDate('2026-03-01')
    await userEvent.click(screen.getByRole('button', { name: 'Настройки' }))

    expect(screen.getByRole('switch', { name: 'Режим поста' })).toHaveAttribute('aria-checked', 'true')
  })

  it('восстанавливает ручное включение режима поста после перезапуска', async () => {
    let savedMode = { manualEnabled: false }
    const services = createServices({
      initialize: vi.fn(() => Promise.resolve(initialized({ fastingMode: savedMode }))),
      saveSettings: vi.fn((patch: SettingsPatch) => {
        if (patch.fastingMode) savedMode = { ...patch.fastingMode }
        return Promise.resolve(success(undefined))
      }),
    })
    const firstRun = render(<App services={services} />)

    await screen.findByRole('timer', { name: /До Асра/ })
    await userEvent.click(await screen.findByRole('button', { name: 'Настройки' }))
    await userEvent.click(screen.getByRole('switch', { name: 'Режим поста' }))
    await waitFor(() => expect(savedMode).toEqual({ manualEnabled: true }))
    firstRun.unmount()

    render(<App services={services} />)
    await screen.findByRole('timer', { name: /До Асра/ })
    await userEvent.click(await screen.findByRole('button', { name: 'Настройки' }))
    expect(screen.getByRole('switch', { name: 'Режим поста' })).toHaveAttribute('aria-checked', 'true')
  })

  it('восстанавливает календарь и поправку при запуске; метод доступен только в сведениях', async () => {
    render(<App services={createServices({ initialize: vi.fn().mockResolvedValue(initialized({ calendarPreferences: { calendar: 'hijri', correction: -1 } })) })} />)
    expect(await screen.findByRole('button', { name: 'Выбрать дату' })).toHaveTextContent('18 раби авв.')
    await userEvent.click(screen.getByRole('button', { name: 'Настройки' }))
    expect(screen.queryByText('Календарь')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'О приложении' }))
    expect(await screen.findByText('Дата хиджры рассчитывается по календарю Умм аль-Кура.')).toBeVisible()
  })

  it.each(['manual', 'default'] as const)(
    'не запрашивает позицию для сохранённого выбора с источником %s',
    async (source) => {
      const services = createServices({
        initialize: vi.fn().mockResolvedValue(initialized({
          locationChoice: {
            mode: 'official',
            locationId: 'naberezhnye-chelny',
            source,
          },
        })),
        getPermission: vi.fn().mockResolvedValue('granted'),
      })

      render(<App services={services} />)

      expect(await screen.findByRole('button', { name: /Набережные Челны/ })).toBeVisible()
      await waitFor(() => expect(services.initialize).toHaveBeenCalledTimes(1))
      expect(services.getPermission).not.toHaveBeenCalled()
      expect(services.getPosition).not.toHaveBeenCalled()
    },
  )

  it('обновляет на старте только ранее автоматический выбор', async () => {
    const services = createServices({
      initialize: vi.fn().mockResolvedValue(initialized({
        locationChoice: {
          mode: 'official',
          locationId: 'kazan',
          source: 'automatic',
        },
      })),
      getPermission: vi.fn().mockResolvedValue('granted'),
    })

    render(<App services={services} />)

    expect(await screen.findByRole('button', { name: '55.7420, 52.3992' })).toBeVisible()
    expect(services.getPermission).toHaveBeenCalledTimes(1)
    expect(services.getPosition).toHaveBeenNthCalledWith(1, 'coarse')
    expect(services.getPosition).toHaveBeenNthCalledWith(2, 'precise')
    expect(services.saveCalculatedLocation).toHaveBeenCalledWith(
      expect.objectContaining({ selection: 'gps' }), 'automatic', expect.any(Function),
    )
    expect(services.cities.load).not.toHaveBeenCalled()
    expect(services.cities.search).not.toHaveBeenCalled()
    expect(services.cities.findNearest).toHaveBeenCalledWith(55.742, 52.3992, 25, true)
  })

  it('показывает весь день и выделяет текущее событие после готовности соседних событий', async () => {
    render(<App services={createServices()} />)
    expect(await screen.findByRole('timer')).toHaveAccessibleName(/До Асра/)
    expect((await screen.findByText('Зухр', { exact: true })).closest('li')).toHaveAttribute('aria-current', 'true')
    expect(screen.queryByRole('button', { name: 'Расписание' })).not.toBeInTheDocument()
    await expectSchedule()
    const list = screen.getByRole('list', { name: 'Расписание дня' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(7)
    expect(within(list).getByText('Фаджр')).toBeVisible()
    expect(within(list).queryByText(/в мечети/)).not.toBeInTheDocument()
    expect(within(list).getByText('Зухр').closest('li')).toHaveAttribute('aria-current', 'true')
    expect(within(list).getByText('Аср').closest('li')).not.toHaveAttribute('aria-current')
  })

  it.each([
    ['2026-09-01T08:50:00Z', 'До Зухра, осталось 10 мин'],
    ['2026-09-01T00:00:00Z', 'До восхода, осталось 1 ч 48 мин'],
  ])('сохраняет подписи намазов и джамаата в %s', async (time, label) => {
    render(<App services={createServices({ now: () => new Date(time) })} />)
    expect(await screen.findByRole('timer')).toHaveAccessibleName(label)
  })

  it('обновляет событие после возвращения из фона', async () => {
    let now = new Date('2026-09-01T13:23:59Z')
    render(<App services={createServices({ now: () => now })} />)
    expect(await screen.findByRole('timer')).toHaveAccessibleName('До Асра, осталось 1 сек')
    act(() => { now = new Date('2026-09-01T13:24:00Z'); window.dispatchEvent(new Event('pageshow')) })
    expect((await screen.findByText('Аср', { exact: true })).closest('li')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('timer')).toHaveAccessibleName('До Магриба, осталось 2 ч 15 мин')
  })

  it('показывает версию и лицензии в О приложении', async () => {
    render(<App services={createServices()} version="v26.4" />)
    await screen.findByRole('timer')
    await userEvent.click(await screen.findByRole('button', { name: 'Настройки' }))
    await userEvent.click(screen.getByRole('button', { name: 'О приложении' }))
    expect(screen.getByText('Версия v26.4.')).toBeVisible()
    expect(screen.getByRole('heading', { level: 2, name: 'Источники и лицензии' })).toBeVisible()
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'SIL Open Font License 1.1' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'GeoNames' })).toBeVisible()
  })

  it('считает по часовому поясу города, а не устройства', async () => {
    render(<App services={createServices({ initialize: vi.fn().mockResolvedValue(initialized({ locationChoice: {
      mode: 'calculated', source: 'manual', coordinates: { latitude: 41.0138, longitude: 28.9497, timeZone: 'Europe/Istanbul', accuracy: null, timestamp: 1, name: 'Стамбул', cityId: 745044, source: 'preset' },
    } })), getDeviceTimeZone: () => 'America/Los_Angeles' })} />)
    await screen.findByRole('list', { name: 'Расписание дня' })
    await expectSchedule()
    expect(within(screen.getByRole('list')).getByText('04:53')).toBeVisible()
    expect(screen.getByText('1 сентября')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Стамбул 13:00' })).toBeVisible()
  })

  it.each([
    ['Мекка', 'Asia/Riyadh', 21.4225, 39.8262, 'Мекка'],
    ['Лиссабон', 'Europe/Lisbon', 38.7223, -9.1393, 'Лиссабон 11:00'],
  ] as const)('показывает дополнительное время только при другом UTC-offset: %s', async (name, timeZone, latitude, longitude, label) => {
    render(<App services={createServices({ initialize: vi.fn().mockResolvedValue(initialized({ locationChoice: {
      mode: 'calculated', source: 'manual', coordinates: { latitude, longitude, timeZone, accuracy: null, timestamp: 1, name, source: 'preset' },
    } })) })} />)
    expect(await screen.findByRole('button', { name: label })).toBeVisible()
  })

  it('скрывает дополнительное время, когда DST уравнивает текущие UTC-offset', async () => {
    let now = new Date('2026-03-29T00:59:00.000Z')
    const services = createServices({
      now: () => now,
      getDeviceTimeZone: () => 'Europe/Berlin',
      initialize: vi.fn().mockResolvedValue(initialized({ locationChoice: {
        mode: 'calculated', source: 'manual', coordinates: { latitude: -26.2041, longitude: 28.0473, timeZone: 'Africa/Johannesburg', accuracy: null, timestamp: 1, name: 'Йоханнесбург', source: 'preset' },
      } })),
    })
    render(<App services={services} />)
    expect(await screen.findByRole('button', { name: 'Йоханнесбург 02:59' })).toBeVisible()
    act(() => { now = new Date('2026-03-29T01:00:00.000Z'); window.dispatchEvent(new Event('pageshow')) })
    expect(await screen.findByRole('button', { name: 'Йоханнесбург' })).toBeVisible()
  })

  it('переключает сегодняшний день по московской полуночи, сохраняя выбранную чужую дату', async () => {
    let now = new Date('2026-08-31T20:59:59Z')
    const services = createServices({ now: () => now, getDeviceTimeZone: () => 'America/Los_Angeles' })
    render(<App services={services} />)
    await screen.findByRole('button', { name: /Казань/ })
    expect(screen.getByRole('button', { name: 'Выбрать дату' })).toHaveTextContent('31 августа')
    await userEvent.click(screen.getByRole('button', { name: 'Выбрать дату' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Месяц' }), '9')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'День' }), '2')
    await userEvent.click(screen.getByRole('button', { name: 'Назад' }))
    await screen.findByRole('list')
    act(() => { now = new Date('2026-08-31T21:00:00Z'); window.dispatchEvent(new Event('pageshow')) })
    expect(screen.getByText('2 сентября')).toBeVisible()
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Сегодня' }))
    expect(await screen.findByRole('timer')).toBeVisible()
    expect(screen.getByText('1 сентября')).toBeVisible()
  })

  it('рассчитывает GPS-расписание по локальной дате места без запроса таблицы', async () => {
    const services = await showGpsKazan('America/Los_Angeles', '2026-10-12T21:30:00Z')

    expect(homeDate()).toHaveAttribute('datetime', '2026-10-12')
    const list = screen.getByRole('list', { name: 'Расписание дня' })
    expect(within(list).getByText('Зухр')).toBeVisible()
    expect(services.getDays).not.toHaveBeenCalled()
  })

  it('сохраняет локальную дату места накануне DST-перехода устройства', async () => {
    const services = await showGpsKazan('America/Los_Angeles', '2026-10-31T21:30:00Z')

    expect(homeDate()).toHaveAttribute('datetime', '2026-10-31')
    const list = screen.getByRole('list', { name: 'Расписание дня' })
    expect(within(list).getByText('Зухр')).toBeVisible()
    expect(services.getDays).not.toHaveBeenCalled()
  })

  it('показывает дату по часовому поясу GPS-места, если устройство уже на следующем дне', async () => {
    const services = await showGpsKazan('Asia/Tokyo', '2026-10-12T15:30:00Z')

    expect(homeDate()).toHaveAttribute('datetime', '2026-10-13')
    const list = screen.getByRole('list', { name: 'Расписание дня' })
    expect(within(list).getByText('Зухр')).toBeVisible()
    expect(services.getDays).not.toHaveBeenCalled()
  })

  it('не запрашивает таблицу после полуночи по часовому поясу места', async () => {
    const services = await showGpsKazan('America/Los_Angeles', '2026-10-12T23:30:00Z')

    expect(homeDate()).toHaveAttribute('datetime', '2026-10-12')
    const list = screen.getByRole('list', { name: 'Расписание дня' })
    expect(within(list).getByText('Фаджр')).toBeVisible()
    expect(services.getDays).not.toHaveBeenCalled()
  })

  it.each(['2026-10-10', '2026-10-15'])('сохраняет явно выбранную дату %s при переходе official → calculated и смене места', async (date) => {
    await showGpsKazan('America/Los_Angeles', '2026-10-12T21:30:00Z')
    await chooseGregorianDate(date)
    expect(homeDate()).toHaveAttribute('datetime', date)

    await openSource()
    await userEvent.click(screen.getByRole('button', { name: /Способ/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Ручной выбор' }))
    await userEvent.click(screen.getByRole('button', { name: 'О расписании' }))
    expect(await screen.findByText('America/Los_Angeles')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Назад' }))
    await backHomeFromSource()

    await chooseCity('Стамбул', /Стамбул, Стамбул, Турция/, /55\.7946, 49\.1115/)
    expect(homeDate()).toHaveAttribute('datetime', date)
    await openSource()
    await userEvent.click(screen.getByRole('button', { name: 'О расписании' }))
    expect(await screen.findByText('Europe/Istanbul')).toBeVisible()
  })

  it('первый запуск не выбирает город и не запрашивает GPS сам', async () => {
    const services = createServices({ initialize: vi.fn().mockResolvedValue(initialized({ locationChoice: null })) })
    render(<App services={services} />)
    expect(await screen.findByRole('heading', { name: 'Выберите место' })).toBeVisible()
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
    expect(services.getPosition).not.toHaveBeenCalled()
    expect(services.refresh).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Найти город' }))
    await userEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(screen.getByRole('heading', { name: 'Выберите место' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'По геопозиции' }))
    expect(await screen.findByRole('region', { name: 'Главная' })).toBeVisible()
    expect(services.getPosition).toHaveBeenCalledTimes(2)
  })

  it('возвращает фокус между отдельными экранами с клавиатуры', async () => {
    render(<App services={createServices()} />)
    const location = await screen.findByRole('button', { name: 'Казань' })
    await userEvent.click(location)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Назад' })).toHaveFocus())
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Казань' })).toHaveFocus())
    await userEvent.click(screen.getByRole('button', { name: 'Казань' }))
    await userEvent.click(screen.getByRole('button', { name: 'Найти город' }))
    expect(screen.getByRole('searchbox')).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Найти город' })).toHaveFocus())
    expect(screen.getAllByRole('region', { name: 'Локация' })).toHaveLength(1)
    expect(screen.queryByRole('region', { name: 'Главная' })).not.toBeInTheDocument()
  })

  it('не загружает каталог до поиска и показывает ожидание', async () => {
    const loading = deferred<Awaited<ReturnType<AppServices['cities']['load']>>>()
    const services = createServices(); services.cities.load = vi.fn(() => loading.promise)
    render(<App services={services} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Казань' }))
    expect(services.cities.load).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Найти город' }))
    expect(screen.getByText('Загружаем города…')).toBeVisible()
    expect(screen.getByRole('searchbox')).toBeEnabled()
    await act(async () => { loading.resolve(success(undefined)); await loading.promise })
    expect(screen.queryByText('Загружаем города…')).not.toBeInTheDocument()
  })

  it.each([
    ['offline', 'Для поиска городов нужен интернет'],
    ['unavailable', 'Не удалось загрузить города'],
  ] as const)('показывает ошибку %s только после открытия поиска и позволяет повторить', async (reason, message) => {
    const services = createServices(); services.cities.load = vi.fn().mockResolvedValueOnce(failure({ kind: 'data', reason })).mockResolvedValue(success(undefined))
    render(<App services={services} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Казань' }))
    expect(screen.queryByText(message)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Найти город' }))
    expect(await screen.findByText(message)).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(screen.queryByText(message)).not.toBeInTheDocument())
    expect(services.cities.load).toHaveBeenCalledTimes(2)
  })

  it('повторно использует загруженный каталог и сохраняет регион города', async () => {
    const services = createServices()
    render(<App services={services} />)
    await screen.findByRole('button', { name: 'Казань' })
    await chooseCity('Стамбул', /Стамбул, Стамбул, Турция/)
    await expectSchedule()
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(7)
    await chooseCity('Казань', 'Казань, Татарстан, Россия', /Стамбул/)
    await expectSchedule()
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(7)
    expect(services.cities.load).toHaveBeenCalledTimes(1)
    expect(services.saveCalculatedLocation).toHaveBeenLastCalledWith(expect.objectContaining({ cityId: 551487, coverage: 'inside' }), 'manual', expect.any(Function))
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

  it('не записывает не принятую GPS-точку через optional hydration или будущий startup', async () => {
    const coarse = deferred<Awaited<ReturnType<AppServices['getPosition']>>>()
    const precise = deferred<Awaited<ReturnType<AppServices['getPosition']>>>()
    const optional = deferred<Awaited<ReturnType<NonNullable<AppServices['loadOptionalSettings']>>>>()
    const saveSettings = vi.fn<AppServices['saveSettings']>().mockResolvedValue(success(undefined))
    const services = createServices({
      initialize: vi.fn().mockResolvedValue(initialized({ locationChoice: null })),
      loadOptionalSettings: vi.fn(() => optional.promise),
      getPosition: vi.fn((accuracy: string) => accuracy === 'coarse' ? coarse.promise : precise.promise),
      saveSettings,
    })
    render(<App services={services} />)
    await userEvent.click(await screen.findByRole('button', { name: 'По геопозиции' }))
    await act(async () => {
      coarse.resolve(success({ latitude: 41.01, longitude: 28.95, accuracy: 2400, timestamp: 100 }))
      precise.resolve(failure({ kind: 'geolocation', reason: 'unavailable' }))
      await Promise.resolve()
    })
    await screen.findByText('41.0100, 28.9500')
    await act(async () => {
      optional.resolve(success({ recentPlaces: [], recentPlacesMigrated: false,
        calendarPreferences: { calendar: 'gregorian', correction: 0 }, themeFamily: 'classic', languagePreference: 'ru', fastingMode: { manualEnabled: false } }))
      await optional.promise
    })
    expect(saveSettings.mock.calls.flatMap(([patch]) => [patch.locationChoice?.place, ...(patch.recentPlaces ?? [])])
      .filter(Boolean).some(place => place?.selection === 'gps')).toBe(false)
    expect(saveSettings.mock.calls.some(([patch]) => patch.recentPlaces?.some(place => place.selection === 'gps'))).toBe(false)
  })

  it('отменяет непринятую низкоточную GPS-точку при возврате и восстанавливает прежнее расписание', async () => {
    const coarse = deferred<Awaited<ReturnType<AppServices['getPosition']>>>()
    const precise = deferred<Awaited<ReturnType<AppServices['getPosition']>>>()
    const saveSettings = vi.fn<AppServices['saveSettings']>().mockResolvedValue(success(undefined))
    const services = createServices({
      getPosition: vi.fn((accuracy: string) => accuracy === 'coarse' ? coarse.promise : precise.promise),
      saveSettings,
    })
    render(<App services={services} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Казань' }))
    await userEvent.click(screen.getByRole('button', { name: 'По геопозиции' }))
    await act(async () => { coarse.resolve(success({ latitude: 41.01, longitude: 28.95, accuracy: 2400, timestamp: 100 })); await Promise.resolve() })
    await screen.findByText('41.0100, 28.9500')
    expect(screen.queryByRole('region', { name: 'Главная' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Назад' }))
    expect(await screen.findByRole('region', { name: 'Главная' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Казань' })).toBeVisible()
    expect(within(screen.getByRole('list', { name: 'Расписание дня' })).getByText('16:24')).toBeVisible()
    const writesAfterCancel = saveSettings.mock.calls.length
    await act(async () => { precise.resolve(success({ latitude: 41.011, longitude: 28.951, accuracy: 10, timestamp: 200 })); await Promise.resolve() })
    expect(screen.getByRole('button', { name: 'Казань' })).toBeVisible()
    expect(within(screen.getByRole('list', { name: 'Расписание дня' })).getByText('16:24')).toBeVisible()
    expect(saveSettings.mock.calls).toHaveLength(writesAfterCancel)
    expect(saveSettings.mock.calls.flatMap(([patch]) => patch.recentPlaces ?? []).some(place => place.selection === 'gps')).toBe(false)
  })

  it.each(['persisted', 'in-flight'] as const)('persists GPS refinement and enrichment before hydration when acceptance is %s', async stage => {
    const repo = createPrayerRepository()
    await setSetting('locationChoice', initializedState.locationChoice)
    const optional = deferred<Awaited<ReturnType<NonNullable<AppServices['loadOptionalSettings']>>>>()
    const precise = deferred<Awaited<ReturnType<AppServices['getPosition']>>>()
    const nearest = deferred<Awaited<ReturnType<AppServices['cities']['findNearest']>>>()
    const selectionGate = deferred<undefined>()
    let firstSelection = true
    const saveSettings = vi.fn<AppServices['saveSettings']>(async (patch, isCurrent) => {
      if (firstSelection && selectedPlaces(patch).length) {
        firstSelection = false
        if (stage === 'in-flight') await selectionGate.promise
      }
      return repo.saveSettings(patch, isCurrent)
    })
    const services = createServices({
      initializeStartup: vi.fn().mockResolvedValue(initialized()),
      saveSettings,
      loadOptionalSettings: vi.fn(() => optional.promise),
      getPosition: vi.fn(accuracy => accuracy === 'coarse'
        ? Promise.resolve(success({ latitude: 41.01, longitude: 28.95, accuracy: 500, timestamp: 100 })) : precise.promise),
    })
    services.cities.findNearest = vi.fn(() => nearest.promise)
    const view = render(<App services={services} />)
    try {
      await userEvent.click(await screen.findByRole('button', { name: 'Казань' }))
      await userEvent.click(screen.getByRole('button', { name: 'По геопозиции' }))
      await screen.findByText('41.0100, 28.9500')
      await waitFor(() => expect(firstSelection).toBe(false))
      if (stage === 'persisted') await waitFor(async () => {
        expect(await getLocationChoice()).toMatchObject({ value: { place: { latitude: 41.01 } } })
      })
      await act(async () => { precise.resolve(success({ latitude: 41.03, longitude: 28.95, accuracy: 10, timestamp: 200 })); await Promise.resolve() })
      selectionGate.resolve(undefined)
      await waitFor(async () => {
        const value = await loadPrayerRepositoryOptionalSettings()
        expect(value.ok && value.value.recentPlaces).toEqual(expect.arrayContaining([expect.objectContaining({
          id: 'gps:history:41.010000:28.950000', latitude: 41.03, accuracy: 10, timestamp: 200,
        }), expect.objectContaining({ id: 'geonames:551487' })]))
      })
      await act(async () => {
        nearest.resolve(success({ id: 745044, name: 'Стамбул', countryCode: 'TR', admin1Code: '34', admin1Name: 'Стамбул',
          latitude: 41.03, longitude: 28.95, population: 1, timeZone: 'Europe/Istanbul' }))
        await Promise.resolve()
      })
      await waitFor(async () => {
        const value = await loadPrayerRepositoryOptionalSettings()
        expect(value.ok && value.value.recentPlaces).toEqual(expect.arrayContaining([
          expect.objectContaining({ name: 'Стамбул', timestamp: 200, accuracy: 10, latitude: 41.03, id: 'gps:history:41.010000:28.950000' }),
          expect.objectContaining({ id: 'geonames:551487' }),
        ]))
      })
      expect(await getLocationChoice()).toMatchObject({ value: { place: { name: 'Стамбул', timestamp: 200, latitude: 41.03 } } })
      expect(saveSettings.mock.calls.filter(([patch]) => patch.placeEvents?.some(event => event.change === 'refinement'))
        .every(([patch]) => patch.recentPlaces === undefined)).toBe(true)
      const loaded = await loadPrayerRepositoryOptionalSettings()
      await act(async () => { optional.resolve(loaded); await optional.promise })
      await chooseCity('Москва', /Москва/, 'Стамбул')
      await userEvent.click(screen.getByRole('button', { name: 'Москва' }))
      await userEvent.click(within(screen.getByRole('region', { name: 'Недавние места' })).getByRole('button', { name: 'Стамбул · GPS, 41.0300, 28.9500' }))
      expect(services.getPosition).toHaveBeenCalledTimes(2)
      await waitFor(async () => expect(await getLocationChoice()).toMatchObject({ value: { source: 'manual', place: {
        latitude: 41.03, longitude: 28.95, accuracy: 10, timestamp: 200,
      } } }))
    } finally {
      selectionGate.resolve(undefined)
      view.unmount()
      await deleteVaqtProDatabase()
    }
  })

  it('оставляет начальный выбор места до принятия низкоточной GPS-точки', async () => {
    const coarse = deferred<Awaited<ReturnType<AppServices['getPosition']>>>()
    const precise = deferred<Awaited<ReturnType<AppServices['getPosition']>>>()
    const saveSettings = vi.fn<AppServices['saveSettings']>().mockResolvedValue(success(undefined))
    const services = createServices({
      initialize: vi.fn().mockResolvedValue(initialized({ locationChoice: null })),
      getPosition: vi.fn((accuracy: string) => accuracy === 'coarse' ? coarse.promise : precise.promise),
      saveSettings,
    })
    render(<App services={services} />)
    await userEvent.click(await screen.findByRole('button', { name: 'По геопозиции' }))
    await act(async () => { coarse.resolve(success({ latitude: 41.01, longitude: 28.95, accuracy: 2400, timestamp: 100 })); await Promise.resolve() })
    expect(await screen.findByRole('heading', { name: 'Выберите место' })).toBeVisible()
    expect(screen.getByText('41.0100, 28.9500')).toBeVisible()
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
    expect(saveSettings.mock.calls.some(([patch]) => patch.locationChoice?.place?.selection === 'gps')).toBe(false)
    expect(saveSettings.mock.calls.flatMap(([patch]) => patch.recentPlaces ?? []).some(place => place.selection === 'gps')).toBe(false)

    await act(async () => { precise.resolve(failure({ kind: 'geolocation', reason: 'unavailable' })); await Promise.resolve() })
    await userEvent.click(screen.getByRole('button', { name: 'Использовать эту точку' }))
    expect(await screen.findByRole('timer')).toBeVisible()
    expect(saveSettings.mock.calls.some(([patch]) => patch.locationChoice?.place?.selection === 'gps')).toBe(true)
  })

  it('cancels pending GPS from the initial selection when opening city search', async () => {
    const coarse = deferred<Awaited<ReturnType<AppServices['getPosition']>>>()
    const precise = deferred<Awaited<ReturnType<AppServices['getPosition']>>>()
    const saveSettings = vi.fn<AppServices['saveSettings']>().mockResolvedValue(success(undefined))
    const services = createServices({
      initialize: vi.fn().mockResolvedValue(initialized({ locationChoice: null })),
      getPosition: vi.fn((accuracy: string) => accuracy === 'coarse' ? coarse.promise : precise.promise),
      saveSettings,
    })
    render(<App services={services} />)
    await userEvent.click(await screen.findByRole('button', { name: 'По геопозиции' }))
    await act(async () => { coarse.resolve(success({ latitude: 41.01, longitude: 28.95, accuracy: 2400, timestamp: 100 })); await Promise.resolve() })
    expect(await screen.findByText('41.0100, 28.9500')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Выберите место' })).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Найти город' }))
    expect(await screen.findByRole('region', { name: 'Поиск города' })).toBeVisible()
    const writesAfterNavigation = saveSettings.mock.calls.length
    await act(async () => { precise.resolve(success({ latitude: 41.011, longitude: 28.951, accuracy: 10, timestamp: 200 })); await Promise.resolve() })

    expect(screen.getByRole('region', { name: 'Поиск города' })).toBeVisible()
    expect(screen.queryByRole('region', { name: 'Главная' })).not.toBeInTheDocument()
    expect(saveSettings.mock.calls).toHaveLength(writesAfterNavigation)
    expect(saveSettings.mock.calls.flatMap(([patch]) => patch.recentPlaces ?? []).some(place => place.selection === 'gps')).toBe(false)
  })

  it('cancels a pending GPS preview from Location before opening city search', async () => {
    const coarse = deferred<Awaited<ReturnType<AppServices['getPosition']>>>()
    const precise = deferred<Awaited<ReturnType<AppServices['getPosition']>>>()
    const saveSettings = vi.fn<AppServices['saveSettings']>().mockResolvedValue(success(undefined))
    const services = createServices({
      initialize: vi.fn().mockResolvedValue(initialized()),
      getPosition: vi.fn((accuracy: string) => accuracy === 'coarse' ? coarse.promise : precise.promise),
      saveSettings,
    })
    render(<App services={services} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Казань' }))
    await userEvent.click(screen.getByRole('button', { name: 'По геопозиции' }))
    await act(async () => { coarse.resolve(success({ latitude: 41.01, longitude: 28.95, accuracy: 2400, timestamp: 100 })); await Promise.resolve() })
    await screen.findByText('41.0100, 28.9500')
    await userEvent.click(screen.getByRole('button', { name: 'Найти город' }))
    const search = await screen.findByRole('searchbox')
    await userEvent.type(search, 'Москва')
    const writesAtSearch = saveSettings.mock.calls.length
    await act(async () => { precise.resolve(success({ latitude: 41.011, longitude: 28.951, accuracy: 10, timestamp: 200 })); await Promise.resolve() })
    expect(screen.getByRole('searchbox')).toHaveValue('Москва')
    expect(await screen.findByRole('button', { name: /Москва/ })).toBeVisible()
    expect(saveSettings.mock.calls).toHaveLength(writesAtSearch)
    expect(saveSettings.mock.calls.flatMap(([patch]) => patch.recentPlaces ?? []).some(place => place.selection === 'gps')).toBe(false)
  })

  it('does not hide a saved GPS row merely because an unaccepted preview is nearby', async () => {
    const coarse = deferred<Awaited<ReturnType<AppServices['getPosition']>>>()
    const precise = deferred<Awaited<ReturnType<AppServices['getPosition']>>>()
    const savedGps = createGpsPlace({ latitude: 41.01, longitude: 28.95, accuracy: 1200, timestamp: 100 }, 'Europe/Moscow', null,
      'gps:history:41.010000:28.950000')
    const saveSettings = vi.fn<AppServices['saveSettings']>().mockResolvedValue(success(undefined))
    const services = createServices({
      initialize: vi.fn().mockResolvedValue(initialized({ recentPlaces: [savedGps], recentPlacesMigrated: true })),
      getPosition: vi.fn((accuracy: string) => accuracy === 'coarse' ? coarse.promise : precise.promise),
      saveSettings,
    })
    render(<App services={services} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Казань' }))
    await userEvent.click(screen.getByRole('button', { name: 'По геопозиции' }))
    await act(async () => { coarse.resolve(success({ ...savedGps, timestamp: 200 })); await Promise.resolve() })
    expect(await screen.findByRole('button', { name: 'Точка, 41.0100, 28.9500' })).toBeVisible()
    expect(saveSettings.mock.calls.flatMap(([patch]) => selectedPlaces(patch))).not.toContainEqual(expect.objectContaining({ timestamp: 200 }))
  })

  it('migrates the original persisted GPS snapshot after a passive refresh races optional hydration', async () => {
    const original = createGpsPlace({ latitude: 41.01, longitude: 28.95, accuracy: 80, timestamp: 100 }, 'Europe/Moscow', null, 'gps:legacy-current')
    const oldManual = createLocalityPlace({ id: 'naberezhnye-chelny', name: 'Набережные Челны', latitude: 55.742, longitude: 52.3992 }, 50)
    const startupState: PrayerRepositoryState = {
      ...initializedState,
      locationChoice: { mode: 'calculated', coordinates: original, place: original, source: 'automatic' },
    }
    delete startupState.recentPlaces
    delete startupState.recentPlacesMigrated
    const optional = deferred<Awaited<ReturnType<NonNullable<AppServices['loadOptionalSettings']>>>>()
    const repo = createPrayerRepository()
    const saveSettings = vi.fn<AppServices['saveSettings']>(repo.saveSettings)
    await setSetting('locationChoice', startupState.locationChoice as NonNullable<PrayerRepositoryState['locationChoice']>)
    await setSetting('recentPlaces', [oldManual])
    const services = createServices({
      initializeStartup: vi.fn().mockResolvedValue(success(startupState)),
      loadOptionalSettings: vi.fn(() => optional.promise),
      getPermission: vi.fn().mockResolvedValue('granted'),
      getPosition: vi.fn((accuracy: string) => Promise.resolve(accuracy === 'coarse'
        ? success({ latitude: 41.5, longitude: 30, accuracy: 100, timestamp: 300 })
        : failure({ kind: 'geolocation' as const, reason: 'unavailable' as const }))),
      saveSettings,
    })
    const view = render(<App services={services} />)
    try {
      await screen.findByRole('timer')
      await waitFor(() => expect(services.getPermission).toHaveBeenCalledOnce(), { timeout: 5000 })
      await waitFor(() => expect(services.getPosition).toHaveBeenCalledTimes(2), { timeout: 5000 })
      await screen.findByText('41.5000, 30.0000')
      await act(async () => {
        optional.resolve(success({ recentPlaces: [oldManual], recentPlacesMigrated: false,
          calendarPreferences: { calendar: 'gregorian', correction: 0 }, themeFamily: 'classic', languagePreference: 'ru', fastingMode: { manualEnabled: false } }))
        await optional.promise
      })

      await waitFor(async () => expect(await loadPrayerRepositoryOptionalSettings()).toMatchObject({ value: { recentPlaces: [
        expect.objectContaining({ id: 'gps:history:41.010000:28.950000', latitude: original.latitude,
          longitude: original.longitude, timestamp: original.timestamp, accuracy: original.accuracy }), oldManual,
      ] } }))
    } finally {
      view.unmount()
      await deleteVaqtProDatabase()
    }
  })

  it('acknowledges a committed place write after a theme save supersedes its response', async () => {
    const repo = createPrayerRepository()
    await setSetting('locationChoice', initializedState.locationChoice)
    const committed = deferred<undefined>()
    const returnResponse = deferred<Awaited<ReturnType<AppServices['saveSettings']>>>()
    let delayed = false
    const saveSettings = vi.fn<AppServices['saveSettings']>(async (patch, isCurrent) => {
      const result = await repo.saveSettings(patch, isCurrent)
      if (patch.placeEvents?.length && !delayed) {
        delayed = true
        committed.resolve(undefined)
        await returnResponse.promise
      }
      return result
    })
    const loadOptionalSettings = vi.fn(loadPrayerRepositoryOptionalSettings)
    const services = createServices({ saveSettings, loadOptionalSettings })
    render(<App services={services} version="ack-test" />)
    await screen.findByRole('timer')
    await chooseCity('Москва', /Москва/)
    await committed.promise
    await waitFor(async () => expect(await getLocationChoice()).toMatchObject({ value: { place: { id: 'geonames:524901' } } }))

    await userEvent.click(screen.getByRole('button', { name: 'Настройки' }))
    await screen.findByRole('region', { name: 'Настройки' })
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Тема' }), 'seasonal')
    returnResponse.resolve(success(undefined))

    await waitFor(() => expect(loadOptionalSettings.mock.calls.length).toBeGreaterThanOrEqual(2))
    await waitFor(async () => expect(await getLocationChoice()).toMatchObject({ value: { place: { id: 'geonames:524901' } } }))
    expect(saveSettings.mock.calls.some(([patch]) => patch.themeFamily === 'seasonal')).toBe(true)
    await waitFor(() => expect(readFastScheduleSnapshot({ appVersion: 'ack-test', now: services.now(),
      deviceTimeZone: services.getDeviceTimeZone() })).not.toBeNull())
  })

  it('does not migrate a passive GPS refresh after the one-time history migration completed', async () => {
    const selected = createGpsPlace({ latitude: 41.01, longitude: 28.95, accuracy: 30, timestamp: 100 }, 'Europe/Moscow', null, 'gps:refresh:100')
    const legacyHistory = [
      createLocalityPlace({ id: 'kazan', name: 'Казань', latitude: 55.7946, longitude: 49.1115 }, 1),
      createLocalityPlace({ id: 'naberezhnye-chelny', name: 'Набережные Челны', latitude: 55.742, longitude: 52.3992 }, 1),
    ]
    const state = initialized({ locationChoice: { mode: 'calculated', coordinates: selected, place: selected, source: 'automatic' },
      recentPlaces: legacyHistory, recentPlacesMigrated: true })
    const saveSettings = vi.fn<AppServices['saveSettings']>().mockResolvedValue(success(undefined))
    const services = createServices({
      initialize: vi.fn().mockResolvedValue(state),
      loadOptionalSettings: vi.fn().mockResolvedValue(success({ recentPlaces: legacyHistory, recentPlacesMigrated: true,
        calendarPreferences: { calendar: 'gregorian', correction: 0 }, themeFamily: 'classic', languagePreference: 'ru', fastingMode: { manualEnabled: false } })),
      saveSettings,
    })
    render(<App services={services} />)
    await screen.findByRole('timer')
    expect(saveSettings.mock.calls.flatMap(([patch]) => patch.recentPlaces ?? []).some(place => place.selection === 'gps')).toBe(false)
    expect(saveSettings.mock.calls.some(([patch]) => patch.recentPlacesMigrated === true)).toBe(false)
  })

  it('GPS внутри Татарстана использует ближайший опубликованный пункт', async () => {
    const services = createServices()
    render(<App services={services} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Казань' }))
    await userEvent.click(screen.getByRole('button', { name: 'По геопозиции' }))
    await screen.findByRole('button', { name: '55.7420, 52.3992' })
    await expectSchedule()
    expect(within(await screen.findByRole('list')).getByText('Зухр')).toBeVisible()
    expect(services.getDays).not.toHaveBeenCalled()
    expect(services.getPosition).toHaveBeenCalledTimes(2)
    expect(services.cities.findNearest).toHaveBeenCalledWith(55.742, 52.3992, 25, false)
    expect(services.saveCalculatedLocation).toHaveBeenCalledWith(expect.objectContaining({ selection: 'gps', latitude: 55.742, longitude: 52.3992 }), 'automatic', expect.any(Function))
  })

  it('вне Татарстана сохраняет грубые GPS-координаты при отказе точного запроса и каталога', async () => {
    const position = { latitude: 41.01, longitude: 28.95, accuracy: 200, timestamp: 1_788_265_600_000 }
    const services = createServices({
      initialize: vi.fn().mockResolvedValue(initialized({ locationChoice: null })),
      getPosition: vi.fn().mockResolvedValueOnce(success(position)).mockResolvedValueOnce(failure({ kind: 'geolocation', reason: 'unavailable' })),
    })
    services.cities.findNearest = vi.fn().mockRejectedValue(new Error('offline'))
    render(<App services={services} />)
    await userEvent.click(await screen.findByRole('button', { name: 'По геопозиции' }))
    await screen.findByRole('button', { name: '41.0100, 28.9500' })
    await expectSchedule()
    expect(await screen.findByText('Название места определить не удалось. Используем координаты.')).toBeVisible()
    expect(within(await screen.findByRole('list')).getAllByRole('listitem')).toHaveLength(7)
    expect(services.saveCalculatedLocation).toHaveBeenCalledWith(expect.objectContaining(position), 'automatic', expect.any(Function))
  })

  it('использует timezone устройства для GPS и сохраняет GPS-координаты', async () => {
    const position = { latitude: 41.01, longitude: 28.95, accuracy: 200, timestamp: 1_788_265_600_000 }
    const services = createServices({
      initialize: vi.fn().mockResolvedValue(initialized({ locationChoice: null })),
      getDeviceTimeZone: () => 'America/Los_Angeles',
      getPosition: vi.fn().mockResolvedValueOnce(success(position)).mockResolvedValueOnce(failure({ kind: 'geolocation', reason: 'unavailable' })),
    })
    services.cities.findNearest = vi.fn().mockResolvedValue(failure({ kind: 'data', reason: 'offline' }))
    render(<App services={services} />)
    await userEvent.click(await screen.findByRole('button', { name: 'По геопозиции' }))
    await screen.findByRole('button', { name: '41.0100, 28.9500' })
    expect(await screen.findByText('Нет интернета. Используем координаты.')).toBeVisible()
    await expectSchedule()
    await userEvent.click(screen.getByRole('button', { name: '41.0100, 28.9500' }))
    expect(screen.getByText('America/Los_Angeles')).toBeVisible()
    const savedSettings = vi.mocked(services.saveSettings).mock.lastCall?.[0]
    expect(savedSettings?.locationChoice).toMatchObject({ mode: 'calculated', coordinates: {
      ...position, timeZone: 'America/Los_Angeles',
    } })
    expect(savedSettings?.locationChoice).toMatchObject({ mode: 'calculated', coordinates: { latitude: position.latitude, longitude: position.longitude } })
    expect(selectedPlaces(savedSettings)).toEqual([expect.objectContaining({ selection: 'gps', latitude: position.latitude, longitude: position.longitude, timestamp: position.timestamp })])
  })

  it.each(['rejection', 'result'] as const)('при ошибке записи %s не откатывает выбранный город', async kind => {
    const saveSettings = vi.fn<AppServices['saveSettings']>().mockImplementationOnce(() => kind === 'rejection' ? Promise.reject(new Error('quota')) : Promise.resolve(failure({ kind: 'storage', reason: 'unavailable' }))).mockResolvedValue(success(undefined))
    const services = createServices({ saveSettings })
    render(<App services={services} />)
    await screen.findByRole('button', { name: 'Казань' })
    await chooseCity('Челны', /Набережные Челны.*Татарстан/)
    expect(await screen.findByText('Не удалось сохранить изменения')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Набережные Челны' })).toBeVisible()
    expect(screen.getAllByText('Не удалось сохранить изменения')).toHaveLength(1)
    await userEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(screen.queryByText('Не удалось сохранить изменения')).not.toBeInTheDocument())
    expect(saveSettings.mock.lastCall?.[0]).toMatchObject({ locationChoice: { mode: 'calculated', coordinates: { id: 'locality:naberezhnye-chelny' } } })
  })

  it('восстанавливается после смены неподдерживаемого профиля', async () => {
    const services = createServices({ initialize: vi.fn().mockResolvedValue(initialized({ preferences: manualCalculation({ profile: 'ummAlQura', overrides: {} }) })), getCalculationProfileCapability: profile => profile === 'ummAlQura' ? { supported: false, reason: 'ummAlQuraUnavailable' } : { supported: true } })
    render(<App services={services} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Профиль «Умм аль-Кура» недоступен')
    await openSource()
    await userEvent.click(screen.getByRole('button', { name: /Профиль/ }))
    expect(screen.getByRole('button', { name: /Умм аль-Кура/ })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Карачи' }))
    await backHomeFromSource()
    expect(await screen.findByRole('timer')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('открывает сведения и методику отдельными экранами', async () => {
    render(<App services={createServices({ initialize: vi.fn().mockResolvedValue(initialized({ preferences: manualCalculation({ profile: 'karachi', overrides: {} }) })) })} />)
    await screen.findByRole('timer')
    await openSource()
    await userEvent.click(screen.getByRole('button', { name: 'О расписании' }))
    expect(screen.getByRole('region', { name: 'Сведения об источнике' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Сведения об источнике' })).toHaveTextContent('Europe/Moscow')
    await userEvent.click(screen.getByRole('button', { name: 'Как считается время' }))
    expect(screen.getByRole('heading', { name: 'Как рассчитывается время' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Назад' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Как считается время' })).toHaveFocus())
  })

  it('показывает автоматический профиль и Asr, выбранные resolver для Москвы', async () => {
    const services = createServices()
    render(<App services={services} />)
    await screen.findByRole('button', { name: 'Казань' })
    await expectSchedule()
    const initialDatasetCalls = vi.mocked(services.getDays).mock.calls.length
    await chooseCity('Москва', /Москва/)
    await expectSchedule()
    expect(services.getDays).toHaveBeenCalledTimes(initialDatasetCalls)
    await openSource()
    await userEvent.click(screen.getByRole('button', { name: 'О расписании' }))
    const details = screen.getByRole('region', { name: 'Сведения об источнике' })
    expect(details).toHaveTextContent('Профиль расчёта: Россия')
    expect(details).toHaveTextContent('Шафиитский, маликитский и ханбалитский')
  })

  it('открывает Поделиться и возвращает фокус в настройки', async () => {
    render(<App services={createServices()} />)
    await screen.findByRole('timer')
    await userEvent.click(await screen.findByRole('button', { name: 'Настройки' }))
    await userEvent.click(screen.getByRole('button', { name: 'Поделиться' }))
    expect(screen.getByRole('img', { name: 'QR-код ссылки на приложение' })).toBeVisible()
    expect(screen.queryByRole('region', { name: 'Настройки' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Назад' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Поделиться' })).toHaveFocus())
  })

  it('повторяет инициализацию хранилища и продолжает расчёт без таблиц', async () => {
    const services = createServices({ initialize: vi.fn().mockResolvedValueOnce(failure({ kind: 'storage', reason: 'unavailable' })).mockResolvedValue(initialized()) })
    render(<App services={services} />)
    expect(await screen.findByRole('alert')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Попробовать снова' }))
    expect(await screen.findByRole('timer')).toBeVisible()
    expect(services.getDays).not.toHaveBeenCalled()
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

  it('выбор города сохраняет ручной способ, а Авто возвращает официальную таблицу', async () => {
    const services = createServices({ initialize: vi.fn().mockResolvedValue(initialized({ preferences: manualCalculation({ profile: 'karachi', overrides: {} }) })) })
    render(<App services={services} />)
    await screen.findByRole('timer')
    await chooseCity('Челны', /Набережные Челны.*Татарстан/)
    await expectSchedule()
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(7)
    await openSource()
    expect(screen.getByRole('button', { name: 'Способ Ручной' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Способ Ручной' }))
    await userEvent.click(screen.getByRole('button', { name: 'Автоматически' }))
    await backHomeFromSource()
    await expectSchedule()
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(7)
  })

  it('calculated startup does not depend on legacy timetable updates', async () => {
    const services = createServices({ initialize: vi.fn().mockResolvedValue(initialized()), refresh: vi.fn<RemovedProviderTestStubs['refresh']>(() => new Promise(() => {})) })
    render(<App services={services} />)
    await screen.findByRole('button', { name: 'Казань' })
    await chooseCity('Стамбул', /Стамбул, Стамбул, Турция/)
    expect(await screen.findByRole('timer')).toBeVisible()
    await expectSchedule()
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(7)
    expect(services.getDays).not.toHaveBeenCalled()
    expect(services.refresh).not.toHaveBeenCalled()
  })

  it.each([automaticPreferences(), manualCalculation({ profile: 'tatarstan', overrides: {} })])('рассчитывает будущую дату при любом сохранённом режиме источника', async preferences => {
    const services = createServices({ initialize: vi.fn().mockResolvedValue(initialized({ preferences })) })
    render(<App services={services} />)
    await screen.findByRole('button', { name: 'Казань' })
    await userEvent.click(screen.getByRole('button', { name: 'Выбрать дату' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Год' }), '2027')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Месяц' }), '1')
    await userEvent.click(screen.getByRole('button', { name: 'Назад' }))
    expect(within(await screen.findByRole('list')).getByText('Фаджр')).toBeVisible()
    expect(services.getDays).not.toHaveBeenCalled()
  })

  it('legacy appearance не управляет новой темой и не возвращает прежние разделы', async () => {
    render(<App services={createServices({ initialize: vi.fn().mockResolvedValue(initialized({ appearance: 'light' })) })} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Настройки' }))
    await waitFor(() => expect(document.documentElement.dataset.themeTone).toBe('light'))
    expect(document.documentElement.dataset.theme).toBe('classic')
    expect(screen.queryByRole('combobox', { name: 'Оформление' })).not.toBeInTheDocument()
    expect(screen.queryByText('Часовой пояс')).not.toBeInTheDocument()
  })

  it('применяет системную тему и меняет её без перезагрузки независимо от расписания', async () => {
    let listener: ((event: MediaQueryListEvent) => void) | undefined
    const media = {
      matches: false,
      addEventListener: vi.fn((_type: string, callback: (event: MediaQueryListEvent) => void) => { listener = callback }),
      removeEventListener: vi.fn(),
    }
    vi.stubGlobal('matchMedia', () => media)
    const view = render(<App services={createServices()} />)
    await waitFor(() => expect(document.documentElement.dataset.themeTone).toBe('light'))
    expect(document.documentElement.style.getPropertyValue('--background-secondary')).toBe('#F2F2EE')
    act(() => { listener?.({ matches: true } as MediaQueryListEvent) })
    await waitFor(() => expect(document.documentElement.dataset.themeTone).toBe('dark'))
    expect(document.documentElement.style.getPropertyValue('--background-secondary')).toBe('#282828')
    view.unmount()
    expect(media.removeEventListener).toHaveBeenCalledWith('change', listener)
    vi.unstubAllGlobals()
  })

  it('применяет закешированное семейство в первом React-коммите до ответа IndexedDB', async () => {
    localStorage.setItem(THEME_PREFERENCE_CACHE_KEY, JSON.stringify({ version: 1, themeFamily: 'classic' }))
    const initialization = deferred<Awaited<ReturnType<AppServices['initialize']>>>()
    const services = createServices({ initialize: vi.fn(() => initialization.promise) })
    render(<App services={services} />)

    expect(document.documentElement.dataset.theme).toBe('classic')
    expect(document.documentElement.dataset.season).toBe('autumn')
    expect(document.documentElement.style.getPropertyValue('--background-primary')).toBe('#000000')
    await act(async () => { initialization.resolve(initialized({ themeFamily: 'classic' })); await initialization.promise })
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('classic'))
  })

  it('оставляет seasonal без изменений между initializeStartup и optional hydration', async () => {
    localStorage.setItem(THEME_PREFERENCE_CACHE_KEY, JSON.stringify({ version: 1, themeFamily: 'seasonal' }))
    const optionalSettings = deferred<Awaited<ReturnType<NonNullable<AppServices['loadOptionalSettings']>>>>()
    const startupState: PrayerRepositoryState = { ...initializedState }
    delete startupState.themeFamily
    const initializeStartup = vi.fn().mockResolvedValue(success(startupState))
    const loadOptionalSettings = vi.fn(() => optionalSettings.promise)
    const services = createServices({ initializeStartup, loadOptionalSettings })
    render(<App services={services} />)

    await screen.findByRole('timer')
    expect(screen.getByRole('button', { name: 'Казань' })).toBeVisible()
    expect(document.documentElement.dataset.theme).toBe('seasonal')
    expect(JSON.parse(localStorage.getItem(THEME_PREFERENCE_CACHE_KEY) ?? 'null')).toEqual({ version: 1, themeFamily: 'seasonal' })

    await act(async () => {
      optionalSettings.resolve(success({ recentPlaces: [], recentPlacesMigrated: false, calendarPreferences: { calendar: 'gregorian', correction: 0 },
        themeFamily: 'seasonal', languagePreference: 'ru', fastingMode: { manualEnabled: true } }))
      await optionalSettings.promise
    })
    expect(document.documentElement.dataset.theme).toBe('seasonal')
    expect(JSON.parse(localStorage.getItem(THEME_PREFERENCE_CACHE_KEY) ?? 'null')).toEqual({ version: 1, themeFamily: 'seasonal' })
    expect(services.getDays).not.toHaveBeenCalled()
  })

  it('применяет сезон текущего дня, а не открытой даты, и сохраняет выбор без reload', async () => {
    const saveSettings = vi.fn().mockResolvedValue(success(undefined))
    render(<App services={createServices({ initialize: vi.fn().mockResolvedValue(initialized({ themeFamily: 'seasonal' })), saveSettings })} />)
    await waitFor(() => expect(document.documentElement.dataset.themeTone).toBe('light'))
    expect(document.documentElement.dataset.season).toBe('autumn')
    expect(document.documentElement.style.getPropertyValue('--background-primary')).toBe('#D6B29B')

    await userEvent.click(screen.getByRole('button', { name: 'Выбрать дату' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Месяц' }), '1')
    await userEvent.click(screen.getByRole('button', { name: 'Назад' }))
    expect(document.documentElement.dataset.season).toBe('autumn')

    await userEvent.click(screen.getByRole('button', { name: 'Настройки' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Тема' }), 'classic')
    expect(document.documentElement.dataset.theme).toBe('classic')
    expect(saveSettings).toHaveBeenCalledWith({ themeFamily: 'classic' }, expect.any(Function))
  })

  it('кеширует семейство только после успешного сохранения и после retry', async () => {
    localStorage.setItem(THEME_PREFERENCE_CACHE_KEY, JSON.stringify({ version: 1, themeFamily: 'seasonal' }))
    const saveSettings = vi.fn<AppServices['saveSettings']>()
      .mockResolvedValueOnce(failure({ kind: 'storage', reason: 'unavailable' }))
      .mockResolvedValue(success(undefined))
    render(<App services={createServices({ initialize: vi.fn().mockResolvedValue(initialized({ themeFamily: 'seasonal' })), saveSettings })} />)
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('seasonal'))
    await userEvent.click(screen.getByRole('button', { name: 'Настройки' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Тема' }), 'classic')

    expect(document.documentElement.dataset.theme).toBe('classic')
    await screen.findByText('Не удалось сохранить изменения')
    expect(JSON.parse(localStorage.getItem(THEME_PREFERENCE_CACHE_KEY) ?? 'null')).toEqual({ version: 1, themeFamily: 'seasonal' })

    await userEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(THEME_PREFERENCE_CACHE_KEY) ?? 'null')).toEqual({ version: 1, themeFamily: 'classic' }))
  })

  it('выбирает летнюю палитру по локальной текущей дате', async () => {
    const preferences = manualCalculation({ profile: 'tatarstan', overrides: {} })
    render(<App services={createServices({
      initialize: vi.fn().mockResolvedValue(initialized({ themeFamily: 'seasonal', preferences })),
      now: () => new Date('2026-06-15T09:00:00.000Z'),
    })} />)
    await waitFor(() => expect(document.documentElement.dataset.themeTone).toBe('light'))
    expect(document.documentElement.dataset.season).toBe('summer')
    expect(document.documentElement.style.getPropertyValue('--background-primary')).toBe('#B9D0CD')
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
  await userEvent.click(screen.getByRole('button', { name: 'Найти город' }))
  await userEvent.type(screen.getByRole('searchbox'), query)
  await userEvent.click(await screen.findByRole('button', { name: result }))
  await screen.findByRole('region', { name: 'Главная' })
}
