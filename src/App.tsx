import { DEFAULT_CALENDAR_PREFERENCES, restoreCalendarPreferences, supportsHijriCalendar, type CalendarPreferences } from './domain/calendar'
import { DateScreen } from './features/calendar/DateScreen'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import type { CityCatalogService } from './data/cityCatalog'
import { cityCatalogService } from './data/cityCatalogClient'
import { prayerRepository, type PrayerRepositoryState,
  type PrayerRepositoryOptionalSettings } from './data/prayerRepository'
import { loadLocalGeography } from './data/localGeography'
import type { CoverageGeometry } from './domain/localGeography'
import { TATARSTAN_LOCALITIES } from './data/tatarstanLocalities'
import { initialManualCalculation, resolvePrayerTimeSource } from './domain/prayerSource'
import { automaticPreferences, type SourcePreferences } from './domain/sourcePreferences'
import { effectiveCalculationSettings } from './domain/calculationSettings'
import { useSettingsPersistence } from './features/settings/useSettingsPersistence'
import { usePlaceSelection, type PlacePersistenceChange } from './features/location/usePlaceSelection'
import { nameLookupMessage } from './features/location/locationState'
import type { GeolocationFailure } from './domain/errors'
import {
  DEFAULT_CALCULATION_SETTINGS,
  CALCULATION_PROFILES,
  getCalculationProfileCapability,
  type CalculationProfileCapability,
  type CalculationProfileId,
} from './domain/prayerCalculation'
import { getDeviceTimeZone, getUtcOffset, getZonedTime } from './domain/locationTime'
import { getSystemDate } from './domain/date'
import type { Result } from './domain/result'
import { LocationScreen, SearchScreen } from './features/location/LocationScreens'
import { flushSync } from 'react-dom'
import { placeFromChoice } from './domain/placeMigration'
import { findRecentPlace, migrateRecentPlaces, rememberPlace, restoreRecentPlaces, updateRecentPlace } from './domain/recentPlaces'
import { homePlaceLabel, type Place } from './domain/place'
import { compactPlaceLabel } from './domain/countryLabels'
import { useCityCatalog } from './features/location/useCityCatalog'
import { ScheduleContent } from './features/schedule/ScheduleContent'
import { ReligiousEventsScreen } from './features/religiousEvents/ReligiousEventsScreen'
import { usePrayerSchedules } from './features/schedule/usePrayerSchedules'
import { activateFastScheduleContext, currentFastScheduleGeneration, invalidateFastScheduleSnapshot,
  readFastScheduleSnapshot, writeFastScheduleSnapshot } from './features/schedule/fastScheduleSnapshot'
import { useScheduleDate } from './features/schedule/useScheduleDate'
import { ShareDialog } from './features/share/ShareDialog'
import {
  getCurrentPosition,
  getGeolocationPermission,
  pulseHaptic,
  type Coordinates,
  type GeolocationPermission,
  type PositionAccuracy,
} from './platform/browser'
import type { LocationChoice, SettingsPatch } from './storage/database'
import { AppShell } from './ui/AppShell'
import { AppHeader } from './ui/AppHeader'
import { ActionButton, IconActionButton, ScreenFooter } from './ui/controls'
import { useDataReset } from './features/settings/useDataReset'
import { BackButton, Screen } from './ui/Screen'
import { useAppNavigation, type AppScreen } from './ui/useAppNavigation'
import { restoreThemeFamily, type ThemeFamily } from './domain/theme'
import { applyTheme, resolveTheme } from './ui/theme'
import { clearThemePreferenceCache, readThemePreferenceCache, writeThemePreferenceCache } from './ui/themePreferenceCache'
import { useSystemAppearance } from './ui/useSystemAppearance'
import { setExecutionQuiescence } from './platform/executionGate'
import { setLanguagePreference, useLocalization } from './localization'
import { PROFILE_LABEL_KEYS } from './ui/calculationLabels'
import { scheduleContextKey } from './domain/scheduleContext'
import {
  DEFAULT_FASTING_MODE_PREFERENCES,
  buildFastingScheduleEvents,
  isFastingModeActive,
  resolveActiveRamadanOccurrence,
  restoreFastingModePreferences,
  updateFastingModePreferences,
  type FastingModePreferences,
} from './domain/fasting'

const loadSecondaryScreens = () => import('./features/SecondaryScreens')
const SECONDARY_SCREENS: readonly AppScreen[] = ['settings', 'source', 'source-choice', 'profiles', 'parameters', 'source-info', 'methodology', 'privacy', 'reset', 'about']
const loadReligiousEventScreen = () => import('./features/religiousEvents/ReligiousEventScreen')
export interface AppServices extends Partial<Pick<typeof prayerRepository,
  'clearAppData' | 'initializeStartup' | 'loadOptionalSettings'>>,
  Pick<typeof prayerRepository, 'initialize' | 'saveSettings' | 'invalidateAndDrain'> {
  cities: CityCatalogService
  loadGeography: () => Promise<CoverageGeometry | null>
  getPermission: () => Promise<GeolocationPermission>
  getPosition: (
    accuracy: PositionAccuracy,
  ) => Promise<Result<Coordinates, GeolocationFailure>>
  getDeviceTimeZone: () => string
  getCalculationProfileCapability: (
    profile: CalculationProfileId,
  ) => CalculationProfileCapability
  now: () => Date
}

const defaultServices: AppServices = {
  ...prayerRepository,
  cities: cityCatalogService,
  loadGeography: loadLocalGeography,
  getPermission: getGeolocationPermission,
  getPosition: getCurrentPosition,
  getDeviceTimeZone,
  getCalculationProfileCapability,
  now: () => new Date(),
}

export function App({
  services = defaultServices,
  version = (import.meta.env.VITE_APP_VERSION
    || import.meta.env.VITE_APP_PACKAGE_VERSION) as string | undefined,
}: {
  services?: AppServices
  version?: string
}) {
  const { locale, t } = useLocalization()
  const appVersion: string = version || (import.meta.env.VITE_APP_PACKAGE_VERSION as string | undefined) || 'dev'
  const [startupSnapshot] = useState(() => {
    try {
      return readFastScheduleSnapshot({ appVersion, now: services.now(), deviceTimeZone: services.getDeviceTimeZone() })
    } catch {
      return null
    }
  })
  const [fastGeneration, setFastGeneration] = useState<string | null>(() => startupSnapshot?.generation ?? currentFastScheduleGeneration())
  const [fastCacheReady, setFastCacheReady] = useState(false)
  const pendingFastIdentityWrite = useRef(false)
  const fastGenerationRef = useRef(fastGeneration)
  const activeFastContext = useRef(startupSnapshot ? scheduleContextKey(startupSnapshot.context) : null)
  const optionalSettingsToken = useRef(0)
  const pendingPlaceWrite = useRef(false)
  const retryOptionalSettings = useRef<() => void>(() => {})
  const themePreferenceRevision = useRef(0)
  const invalidateFastCache = useCallback(() => {
    activeFastContext.current = null
    const generation = invalidateFastScheduleSnapshot()
    fastGenerationRef.current = generation
    setFastGeneration(generation)
  }, [])
  const [preferences, setPreferences] = useState<SourcePreferences>(() => startupSnapshot?.preferences ?? automaticPreferences())
  const [storedCalendarPreferences, setCalendarPreferences] = useState<CalendarPreferences>(DEFAULT_CALENDAR_PREFERENCES)
  const [themeFamily, setThemeFamily] = useState<ThemeFamily>(readThemePreferenceCache)
  const [themeEditedLocally, setThemeEditedLocally] = useState(false)
  const persistedThemeFamily = useRef(themeFamily)
  const editedTheme = useRef(false)
  const [fastingMode, setFastingMode] = useState<FastingModePreferences>({ ...DEFAULT_FASTING_MODE_PREFERENCES })
  const [hijriSupported] = useState(supportsHijriCalendar)
  const calendarPreferences = useMemo<CalendarPreferences>(() => hijriSupported ? storedCalendarPreferences
    : { ...storedCalendarPreferences, calendar: 'gregorian' }, [hijriSupported, storedCalendarPreferences])
  const [error, setError] = useState(false)
  const [startupRecoveryError, setStartupRecoveryError] = useState(false)
  const [optionalSettingsError, setOptionalSettingsError] = useState(false)
  const persistSettings = useCallback(async (
    patch: Parameters<AppServices['saveSettings']>[0],
    isGenerationCurrent?: Parameters<AppServices['saveSettings']>[1],
    isLocationCurrent?: () => boolean,
  ) => {
    const result = await services.saveSettings(patch, isGenerationCurrent)
    const generationIsCurrent = isGenerationCurrent?.() ?? true
    const locationIsCurrent = isLocationCurrent?.() ?? true
    if (result.ok) {
      if (patch.placeEvents?.length && generationIsCurrent && locationIsCurrent) {
        pendingPlaceWrite.current = false
        retryOptionalSettings.current()
      }
      if ((patch.locationChoice || patch.sourcePreferences) && generationIsCurrent && locationIsCurrent) {
        invalidateFastCache()
        pendingFastIdentityWrite.current = false
        setFastCacheReady(true)
      }
    }
    return result
  }, [invalidateFastCache, services])
  const persistence = useSettingsPersistence(persistSettings)
  const saveSettings = persistence.save
  const invalidateSaves = persistence.invalidateAndDrain
  const themeChannel = useRef<BroadcastChannel | null>(null)
  useEffect(() => {
    if (persistence.status !== 'saved' || !themeEditedLocally) return
    persistedThemeFamily.current = themeFamily
    writeThemePreferenceCache(themeFamily)
    themeChannel.current?.postMessage(themeFamily)
  }, [persistence.status, themeFamily, themeEditedLocally])
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const openChannel = () => {
      if (!themeChannel.current) themeChannel.current = new BroadcastChannel('salah-theme-preference-v1')
    }
    const closeChannel = () => {
      themeChannel.current?.close()
      themeChannel.current = null
    }
    openChannel()
    window.addEventListener('pagehide', closeChannel)
    window.addEventListener('pageshow', openChannel)
    return () => {
      window.removeEventListener('pagehide', closeChannel)
      window.removeEventListener('pageshow', openChannel)
      closeChannel()
    }
  }, [])
  const [recentPlaces, setRecentPlaces] = useState<Place[]>([])
  const editedPreferences = useRef(false)
  const editedCalendar = useRef(false)
  const editedFasting = useRef(false)
  const editedRecentPlaces = useRef(false)
  const recentPlacesLoaded = useRef(false)
  const recentPlacesMigrationComplete = useRef(false)
  const [activeHistoryId, setActiveHistoryId] = useState<string | undefined>()
  const recentRef = useRef<Place[]>([])
  const previousPlace = useRef<Place | null>(null)
  const historyAnchorPlace = useRef<Place | null>(null)
  const legacyHistoryAnchorCaptured = useRef(false)
  const acceptedGpsHistory = useRef<{ runtimeId: string; historyId: string } | null>(null)
  const persistPlace = useCallback((choice: LocationChoice, change: PlacePersistenceChange = 'automatic') => {
    const next = placeFromChoice(choice, TATARSTAN_LOCALITIES)
    if (!next || change === 'refinement' && acceptedGpsHistory.current?.runtimeId !== next.id) return
    pendingFastIdentityWrite.current = true
    setFastCacheReady(false)
    invalidateFastCache()
    const expectedPlaceId = change === 'refinement' ? next.id
      : previousPlace.current?.id ?? (change === 'selection' && !legacyHistoryAnchorCaptured.current ? undefined : null)
    const patch: SettingsPatch = { locationChoice: choice,
      placeEvents: [{ change, choice, ...(expectedPlaceId !== undefined ? { expectedPlaceId } : {}) }] }
    pendingPlaceWrite.current = true
    if (change === 'selection') {
      const existing = recentPlacesLoaded.current ? recentRef.current
        : recentPlacesMigrationComplete.current ? restoreRecentPlaces(recentRef.current)
          : migrateRecentPlaces(recentRef.current, historyAnchorPlace.current)
      const recent = rememberPlace(existing, next)
      recentRef.current = recent
      editedRecentPlaces.current = true
      recentPlacesMigrationComplete.current = true
      setRecentPlaces(recent)
      setActiveHistoryId(next.selection === 'gps' ? recent[0]?.id : undefined)
      acceptedGpsHistory.current = next.selection === 'gps' && recent[0]
        ? { runtimeId: next.id, historyId: recent[0].id }
        : null
    } else if (change === 'refinement') {
      const historyId = acceptedGpsHistory.current?.runtimeId === next.id ? acceptedGpsHistory.current.historyId : undefined
      const recent = updateRecentPlace(recentRef.current, next, historyId)
      if (recent !== recentRef.current && JSON.stringify(recent) !== JSON.stringify(recentRef.current)) {
        recentRef.current = recent
        editedRecentPlaces.current = true
        setRecentPlaces(recent)
      }
    }
    previousPlace.current = next
    saveSettings(patch)
  }, [invalidateFastCache, saveSettings])
  const navigation = useAppNavigation()
  const { open: openImmediately, openPrepared: openScreenPrepared, back: backScreen, home: homeScreen } = navigation
  const [secondaryScreens, setSecondaryScreens] = useState<typeof import('./features/SecondaryScreens') | null>(null)
  const [screenLoadFailed, setScreenLoadFailed] = useState(false)
  const openScreen = useCallback((target: AppScreen) => {
    setScreenLoadFailed(false)
    if (!secondaryScreens && SECONDARY_SCREENS.includes(target)) {
      void openScreenPrepared(target, async () => {
        const screens = await loadSecondaryScreens()
        flushSync(() => setSecondaryScreens(screens))
      }).catch(() => setScreenLoadFailed(true))
    } else openImmediately(target)
  }, [openImmediately, openScreenPrepared, secondaryScreens])
  const SettingsScreens = secondaryScreens?.SettingsScreens
  const SourceInfo = secondaryScreens?.SourceInfo
  const MethodologyDialog = secondaryScreens?.MethodologyDialog
  const [religiousEventScreen, setReligiousEventScreen] = useState<typeof import('./features/religiousEvents/ReligiousEventScreen')['ReligiousEventScreen'] | null>(null)
  const [religiousEventLoadError, setReligiousEventLoadError] = useState<string | null>(null)
  const locationDialogOpen = navigation.screen === 'location' || navigation.screen === 'search'
  const settingsDialogOpen = ['settings', 'source', 'source-choice', 'profiles', 'parameters', 'privacy', 'reset', 'about'].includes(navigation.screen)
  const methodologyDialogOpen = navigation.screen === 'methodology'
  const shareDialogOpen = navigation.screen === 'share'
  const [retryCount, setRetryCount] = useState(0)
  const locationButtonRef = useRef<HTMLButtonElement>(null)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)
  const LoadedReligiousEventScreen = religiousEventScreen

  const onPlaceChosen = useCallback(() => { homeScreen(); pulseHaptic() }, [homeScreen])
  const locations = TATARSTAN_LOCALITIES
  const { place, gpsPreview, source: placeSelectionSource, notice: locationNotice, gpsState, nameLookupState, restore, locate: locateAutomatically, acceptGps,
    cancelInteractive: cancelInteractiveGps,
    selectLocality, selectCity: selectPresetCity, selectRecent, invalidate: invalidateLocation } = usePlaceSelection(
    services, locations, onPlaceChosen, persistPlace,
    startupSnapshot ? { place: startupSnapshot.place, source: startupSnapshot.selectionSource } : undefined,
  )
  const closeLocationDialog = useCallback(() => {
    cancelInteractiveGps()
    backScreen()
  }, [backScreen, cancelInteractiveGps])
  const { reset, drain: drainReset, hasPendingReset } = useDataReset({ invalidateLocation, invalidateSaves,
    invalidateRepository: services.invalidateAndDrain, clear: services.clearAppData ?? prayerRepository.clearAppData })
  const quiescenceOperation = useRef<() => Promise<void>>(async () => {})
  const quiescenceInFlight = useRef<Promise<void> | null>(null)
  const initializationDrain = useRef<Promise<void> | null>(null)
  useEffect(() => {
    quiescenceOperation.current = () => {
      if (quiescenceInFlight.current) return quiescenceInFlight.current
      const failures: unknown[] = []
      try { services.cities.cancelPending?.() }
      catch (error) { failures.push(error) }
      const drains = hasPendingReset() ? [() => drainReset()] : [
        () => services.invalidateAndDrain(),
        () => invalidateSaves(),
        () => drainReset(),
      ]
      const operation = Promise.allSettled(drains.map(drain => Promise.resolve().then(drain))).then(results => {
        for (const result of results) if (result.status === 'rejected') failures.push(result.reason)
        if (failures.length) throw new AggregateError(failures)
      })
      quiescenceInFlight.current = operation
      void operation.then(
        () => { if (quiescenceInFlight.current === operation) quiescenceInFlight.current = null },
        () => { if (quiescenceInFlight.current === operation) quiescenceInFlight.current = null },
      )
      return operation
    }
  }, [services, invalidateSaves, drainReset, hasPendingReset])
  useEffect(() => {
    setExecutionQuiescence(() => quiescenceOperation.current())
    return () => { setExecutionQuiescence(() => quiescenceOperation.current()) }
  }, [])
  const locationSelectionVisible = navigation.screen === 'location' || (navigation.screen === 'home' && !place)
  const previousLocationSelectionVisible = useRef(locationSelectionVisible)
  useEffect(() => {
    const wasVisible = previousLocationSelectionVisible.current
    previousLocationSelectionVisible.current = locationSelectionVisible
    if (wasVisible && !locationSelectionVisible && navigation.screen !== 'search') cancelInteractiveGps()
  }, [cancelInteractiveGps, locationSelectionVisible, navigation.screen])
  const resetWithFastCache = useCallback(() => {
    pendingPlaceWrite.current = false
    pendingFastIdentityWrite.current = true
    optionalSettingsToken.current += 1
    themePreferenceRevision.current += 1
    setFastCacheReady(false)
    invalidateFastCache()
    clearThemePreferenceCache()
    setThemeEditedLocally(false)
    return reset(cleared => {
      if (!cleared) {
        pendingFastIdentityWrite.current = false
        setFastCacheReady(true)
        themePreferenceRevision.current += 1
        editedTheme.current = false
        setThemeEditedLocally(false)
        setThemeFamily(persistedThemeFamily.current)
        writeThemePreferenceCache(persistedThemeFamily.current)
        retryOptionalSettings.current()
      }
    })
  }, [invalidateFastCache, reset])
  const capabilities = useMemo(() => CALCULATION_PROFILES.filter(p => services.getCalculationProfileCapability(p.id).supported).map(p => p.id), [services])

  useEffect(() => {
    let active = true
    const acceptState = (state: PrayerRepositoryState) => {
      if (!active) return
      setFastCacheReady(!pendingFastIdentityWrite.current)
      restore(state.locationChoice, TATARSTAN_LOCALITIES)
      if (!editedRecentPlaces.current) recentPlacesMigrationComplete.current = state.recentPlacesMigrated === true
      previousPlace.current = state.locationChoice
        ? placeFromChoice(state.locationChoice, TATARSTAN_LOCALITIES)
        : null
      if (state.recentPlacesMigrated === true) {
        historyAnchorPlace.current = previousPlace.current
        legacyHistoryAnchorCaptured.current = true
      } else if (!legacyHistoryAnchorCaptured.current) {
        historyAnchorPlace.current = previousPlace.current
        legacyHistoryAnchorCaptured.current = true
      }
      setActiveHistoryId(undefined)
      if (!editedRecentPlaces.current && state.recentPlaces !== undefined) {
        const recent = state.recentPlacesMigrated
          ? restoreRecentPlaces(state.recentPlaces)
          : migrateRecentPlaces(state.recentPlaces, historyAnchorPlace.current)
        recentPlacesLoaded.current = true
        recentPlacesMigrationComplete.current = true
        recentRef.current = recent
        setRecentPlaces(recent)
        if (state.recentPlacesMigrated !== true || JSON.stringify(recent) !== JSON.stringify(state.recentPlaces)) {
          editedRecentPlaces.current = true
          saveSettings({ normalizeRecentPlaces: true })
        }
      }
      if (!editedPreferences.current) setPreferences(state.preferences)
      if (state.languagePreference !== undefined) setLanguagePreference(state.languagePreference)
      if (!editedCalendar.current && state.calendarPreferences !== undefined) setCalendarPreferences(restoreCalendarPreferences(state.calendarPreferences))
      if (!editedTheme.current && state.themeFamily !== undefined) {
        const nextThemeFamily = restoreThemeFamily(state.themeFamily)
        themePreferenceRevision.current += 1
        persistedThemeFamily.current = nextThemeFamily
        setThemeFamily(nextThemeFamily)
        writeThemePreferenceCache(nextThemeFamily)
        themeChannel.current?.postMessage(nextThemeFamily)
      }
      if (!editedFasting.current && state.fastingMode !== undefined) setFastingMode(restoreFastingModePreferences(state.fastingMode))
      setError(false)
      setStartupRecoveryError(false)
      setOptionalSettingsError(false)
    }
    const hydrateOptionalSettings = () => {
      if (!services.loadOptionalSettings) return
      retryOptionalSettings.current = () => hydrateOptionalSettings()
      const token = ++optionalSettingsToken.current
      const themeRevision = themePreferenceRevision.current
      void services.loadOptionalSettings().then(result => {
        if (!active || token !== optionalSettingsToken.current) return
        if (!result.ok) { setOptionalSettingsError(true); return }
        const value: PrayerRepositoryOptionalSettings = result.value
        if (!pendingPlaceWrite.current) {
          const migrated = value.recentPlacesMigrated
            ? restoreRecentPlaces(value.recentPlaces)
            : migrateRecentPlaces(value.recentPlaces, historyAnchorPlace.current)
          const recent = migrated
          recentPlacesLoaded.current = true
          recentPlacesMigrationComplete.current = true
          recentRef.current = recent
          setRecentPlaces(recent)
          const accepted = acceptedGpsHistory.current
          if (accepted && previousPlace.current?.id === accepted.runtimeId) {
            const storedEntry = findRecentPlace(recent, previousPlace.current)
            if (storedEntry) {
              accepted.historyId = storedEntry.id
              setActiveHistoryId(storedEntry.id)
            }
          }
          if (!value.recentPlacesMigrated || JSON.stringify(recent) !== JSON.stringify(value.recentPlaces)) {
            editedRecentPlaces.current = true
            saveSettings({ normalizeRecentPlaces: true })
          }
        }
        if (!editedCalendar.current) setCalendarPreferences(restoreCalendarPreferences(value.calendarPreferences))
        if (!editedTheme.current && themeRevision === themePreferenceRevision.current) {
          const nextThemeFamily = restoreThemeFamily(value.themeFamily)
          persistedThemeFamily.current = nextThemeFamily
          setThemeFamily(nextThemeFamily)
          writeThemePreferenceCache(nextThemeFamily)
          themeChannel.current?.postMessage(nextThemeFamily)
        }
        if (!editedFasting.current) setFastingMode(restoreFastingModePreferences(value.fastingMode))
        setLanguagePreference(value.languagePreference)
        setOptionalSettingsError(false)
      }).catch(() => {
        if (active && token === optionalSettingsToken.current) setOptionalSettingsError(true)
      })
    }
    const startupBarrier = initializationDrain.current
    const initialize = services.initializeStartup ?? services.initialize
    const startupGeneration = fastGenerationRef.current
    const acceptInitialization = (result: Awaited<ReturnType<typeof initialize>> | null) => {
      if (!result) return
      if (!active) return
      if (startupGeneration !== fastGenerationRef.current) {
        hydrateOptionalSettings()
        return
      }
      if (!result.ok) {
        if (startupSnapshot) setStartupRecoveryError(true)
        else setError(true)
        return
      }
      acceptState(result.value)
      hydrateOptionalSettings()
    }
    const failInitialization = () => {
      if (!active) return
      if (startupGeneration !== fastGenerationRef.current) return
      if (startupSnapshot) setStartupRecoveryError(true)
      else setError(true)
    }
    const initializeCurrent = () => {
      if (!active) return
      return initialize().then(acceptInitialization).catch(failInitialization)
    }
    if (startupBarrier) void startupBarrier.then(initializeCurrent).catch(failInitialization)
    else void initializeCurrent()
    return () => {
      active = false
      const drain = quiescenceOperation.current()
      initializationDrain.current = drain
      retryOptionalSettings.current = () => {}
    }
  }, [retryCount, services, restore, startupSnapshot, saveSettings])

  const { cityCatalogStatus, loadCities } = useCityCatalog(services)
  const deviceTimeZone = services.getDeviceTimeZone()
  const {
    selectedDateOverride,
    currentTime,
    changeDate,
    syncCurrentTime,
  } = useScheduleDate(services)
  const currentResolution = place
    ? resolvePrayerTimeSource(place, preferences, capabilities)
    : null
  const todayTimeZone = currentResolution?.timeZone ?? place?.timeZone ?? deviceTimeZone
  const today = getSystemDate(currentTime, todayTimeZone)
  const selectedDate = selectedDateOverride ?? today
  const resolution = place
    ? resolvePrayerTimeSource(place, preferences, capabilities)
    : null
  const changeScheduleDate = useCallback((date: string) => {
    changeDate(date === today ? null : date)
  }, [changeDate, today])
  const calculationSettings = resolution?.kind === 'calculated' ? resolution.settings
    : preferences.calculationDraft ? effectiveCalculationSettings(preferences.calculationDraft) : DEFAULT_CALCULATION_SETTINGS
  const systemTone = useSystemAppearance()
  const theme = useMemo(() => resolveTheme(themeFamily, today, systemTone), [systemTone, themeFamily, today])
  useLayoutEffect(() => { applyTheme(theme) }, [theme])
  const {
    schedule,
    context,
    contextKey: selectedContextKey,
    schedules,
    scheduleLoading,
    scheduleError,
    contextReady,
    enrichmentError,
    retrySchedule,
    retryEnrichment,
  } = usePrayerSchedules({
    location: place,
    resolution,
    mode: preferences.mode,
    selectedDate,
    initialSnapshot: selectedDate === today ? startupSnapshot : null,
  })
  const fastingEvents = useMemo(() => buildFastingScheduleEvents(schedules, context?.timeZone), [schedules, context?.timeZone])
  // Не используем расписания выбранной даты для вычисления режима текущего дня.
  const currentSchedules = usePrayerSchedules({
    location: selectedDate === today ? null : place,
    resolution: selectedDate === today ? null : currentResolution,
    mode: preferences.mode,
    selectedDate: today,
    initialSnapshot: selectedDate === today ? null : startupSnapshot,
  })
  const todaySchedule = selectedDate === today ? schedule : currentSchedules.schedule
  const todayContext = selectedDate === today ? context : currentSchedules.context
  const todayContextKey = todayContext?.date === today
    ? selectedDate === today ? selectedContextKey : currentSchedules.contextKey
    : null
  useLayoutEffect(() => {
    if (pendingFastIdentityWrite.current || !todayContextKey || !fastGeneration) return
    if (activeFastContext.current && activeFastContext.current !== todayContextKey) {
      invalidateFastCache()
      return
    }
    if (activateFastScheduleContext(todayContextKey, fastGeneration)) activeFastContext.current = todayContextKey
  }, [fastCacheReady, fastGeneration, invalidateFastCache, todayContextKey])
  useEffect(() => {
    if (!fastCacheReady || !place || !todaySchedule || !todayContext || todayContext.date !== today) return
    writeFastScheduleSnapshot({
      appVersion, now: services.now(), deviceTimeZone, context: todayContext, schedule: todaySchedule, generation: fastGeneration,
      place, selectionSource: placeSelectionSource, preferences,
    })
  }, [appVersion, fastCacheReady, fastGeneration, place, placeSelectionSource, preferences,
    deviceTimeZone, services, today, todayContext, todaySchedule])
  const activeScheduleContext = selectedDate === today ? context : currentSchedules.context
  const activeFastingEvents = useMemo(() => selectedDate === today
    ? fastingEvents
    : buildFastingScheduleEvents(currentSchedules.schedules, currentSchedules.context?.timeZone),
  [selectedDate, today, fastingEvents, currentSchedules.schedules, currentSchedules.context?.timeZone])
  const activeRamadanOccurrence = resolveActiveRamadanOccurrence({
    today, correction: calendarPreferences.correction, hijriSupported,
    now: currentTime, timeZone: activeScheduleContext?.timeZone, events: activeFastingEvents,
  })
  const fastingModeEnabled = isFastingModeActive(fastingMode, activeRamadanOccurrence)

  const openLocationDialog = useCallback(() => {
    openScreen('location')
  }, [openScreen])

  const openSettingsDialog = useCallback(() => { openScreen('settings') }, [openScreen])
  const openReligiousEvent = useCallback((religiousEventId: import('./domain/religiousEvents').ReligiousEventId) => {
    setReligiousEventLoadError(null)
    void openScreenPrepared({ screen: 'religious-event', religiousEventId }, async () => {
      const module = await loadReligiousEventScreen()
      flushSync(() => setReligiousEventScreen(() => module.ReligiousEventScreen))
    }).catch(() => {
      setReligiousEventLoadError(t('eventUnavailable'))
    })
  }, [openScreenPrepared, t])

  if (error) {
    return (
      <AppShell>
        <Screen label={t('eventLoadError')} contentClassName="screen-center">
          <p role="alert">{t('appLoadError')}</p>
          <ActionButton onClick={() => setRetryCount((count) => count + 1)}>
            {t('retryAgain')}
          </ActionButton>
        </Screen>
      </AppShell>
    )
  }

  const updatePreferences = (next: SourcePreferences) => {
    pendingFastIdentityWrite.current = true
    setFastCacheReady(false)
    invalidateFastCache()
    editedPreferences.current = true
    setPreferences(next)
    persistence.save({ sourcePreferences: next })
  }
  const updateCalendarPreferences = (next: CalendarPreferences) => {
    editedCalendar.current = true
    setCalendarPreferences(next)
    persistence.save({ calendarPreferences: next })
  }
  const updateThemeFamily = (next: ThemeFamily) => {
    themePreferenceRevision.current += 1
    editedTheme.current = true
    setThemeFamily(next)
    setThemeEditedLocally(true)
    persistence.save({ themeFamily: next })
  }
  const updateFastingMode = (enabled: boolean) => {
    editedFasting.current = true
    const next = updateFastingModePreferences(fastingMode, enabled, activeRamadanOccurrence)
    setFastingMode(next)
    saveSettings({ fastingMode: next })
  }
  const homeLocationLabel = homePlaceLabel(place, t('locationUnknown'))
  const sourcePlaceLabel = compactPlaceLabel(place?.name || t('selectPlace'), locale)
  const locationTime = place && getUtcOffset(currentTime, place.timeZone) !== getUtcOffset(currentTime, deviceTimeZone)
    ? getZonedTime(currentTime, place.timeZone)
    : undefined
  const dialogOpen = locationDialogOpen
    || settingsDialogOpen
    || methodologyDialogOpen
    || shareDialogOpen
    || navigation.screen === 'source-info'
    || navigation.screen === 'religious-events'
    || navigation.screen === 'religious-event'
    || navigation.screen === 'date'

  const persistenceNotice = persistence.status === 'failed' ? (
        <div className="screen-status" role="status">
          <span>{t('saveFailed')}</span>
          <ActionButton onClick={persistence.retry}>{t('retry')}</ActionButton>
        </div>
      ) : null
  const nearbyCityNotice = place?.selection === 'gps' ? nameLookupMessage(nameLookupState, locale) : null
  const recoveryNotices = <>
    {screenLoadFailed ? <div className="screen-status" role="alert">
      <span>{t('screenLoadFailed')}</span>
      <ActionButton onClick={() => window.location.reload()}>{t('retry')}</ActionButton>
    </div> : null}
    {startupRecoveryError ? <div className="screen-status" role="alert">
      <span>{t('startupRecoveryError')}</span>
      <ActionButton onClick={() => setRetryCount(count => count + 1)}>{t('retry')}</ActionButton>
    </div> : null}
    {optionalSettingsError ? <div className="screen-status" role="alert">
      <span>{t('optionalSettingsRecoveryError')}</span>
      <ActionButton onClick={() => setRetryCount(count => count + 1)}>{t('retry')}</ActionButton>
    </div> : null}
  </>

  return (
    <AppShell>
      {!dialogOpen ? <div
        className="app-background screen-background"
      >
          {!place ? <LocationScreen initial place={gpsPreview} activePlace={place} recentPlaces={recentPlaces} onSelectRecent={selectRecent}
            onBack={backScreen} onSearch={() => { cancelInteractiveGps(); flushSync(() => openScreen('search')); document.querySelector<HTMLInputElement>('input[type="search"]')?.focus() }} onLocate={locateAutomatically}
            gpsState={gpsState} nameLookupState={nameLookupState} onAcceptGps={acceptGps}
            notice={<>{persistenceNotice}{recoveryNotices}</>} bottom={<ScreenFooter align="end"><ActionButton variant="auxiliary" id="home-settings" onClick={openSettingsDialog}>{t('settings')}</ActionButton></ScreenFooter>} /> : <ScheduleContent
            schedule={schedule}
            schedules={schedules}
            scheduleLoading={scheduleLoading}
            scheduleError={scheduleError}
            contextReady={contextReady}
            enrichmentError={enrichmentError}
            onRetryEnrichment={retryEnrichment}
            selectedDate={selectedDate}
            calendarPreferences={calendarPreferences}
            today={today}
            currentTime={currentTime}
            now={services.now}
            hijriSupported={hijriSupported}
            fastingMode={fastingMode}
            fastingModeEnabled={fastingModeEnabled}
            fastingEvents={fastingEvents}
            timeZone={context?.timeZone}
            onSystemClockChange={syncCurrentTime}
            onOpenReligiousEvent={openReligiousEvent}
            top={<AppHeader locationButtonRef={locationButtonRef} locationLabel={homeLocationLabel} locationTime={locationTime} selectedDate={selectedDate}
              calendarPreferences={calendarPreferences} onOpenLocation={openLocationDialog} onOpenDate={() => openScreen('date')} />}
            actions={<IconActionButton id="home-settings" ref={settingsButtonRef} label={t('settings')} title={t('settings')} onClick={openSettingsDialog}>
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 3.75 19.15 7.9v8.2L12 20.25 4.85 16.1V7.9L12 3.75Z" stroke="currentColor" strokeWidth="1.55" strokeLinejoin="round" />
                <circle cx="12" cy="12" r="1.6" fill="currentColor" />
              </svg>
            </IconActionButton>}
            notice={<>{religiousEventLoadError ? <p role="alert">{religiousEventLoadError}</p> : null}
              {locationNotice ? <p className="note" role="status">{locationNotice}</p> : null}
              {!locationNotice && nearbyCityNotice ? <p className="note" role="status">{nearbyCityNotice}</p> : null}{persistenceNotice}{recoveryNotices}</>}
            onChangeDate={changeScheduleDate}
            onRetrySchedule={retrySchedule}
          />}

      </div> : null}

      {navigation.screen === 'date' ? <DateScreen selectedDate={selectedDate} today={today} preferences={calendarPreferences} hijriSupported={hijriSupported}
        onDateChange={changeScheduleDate} onPreferencesChange={updateCalendarPreferences} onOpenReligiousEvents={() => openScreen('religious-events')}
        onBack={backScreen} notice={persistenceNotice} /> : null}

      {navigation.screen === 'religious-events' ? <ReligiousEventsScreen today={today} correction={calendarPreferences.correction}
        hijriSupported={hijriSupported} onOpenEvent={openReligiousEvent} onBack={backScreen} loadError={religiousEventLoadError} /> : null}

      {navigation.screen === 'location' ? <LocationScreen place={gpsPreview ?? place} activePlace={place} recentPlaces={recentPlaces} {...(activeHistoryId ? { activeHistoryId } : {})} onSelectRecent={selectRecent}
        onBack={closeLocationDialog} onSearch={() => { cancelInteractiveGps(); flushSync(() => openScreen('search')); document.querySelector<HTMLInputElement>('input[type="search"]')?.focus() }} onLocate={locateAutomatically}
        onAcceptGps={acceptGps} gpsState={gpsState} nameLookupState={nameLookupState} currentTime={currentTime} notice={persistenceNotice} /> : null}
      {navigation.screen === 'search' ? <SearchScreen locations={locations} catalogStatus={cityCatalogStatus} onLoadCities={loadCities}
        onSearchCities={services.cities.search} onBack={backScreen} onSelectCity={selectPresetCity} onSelectLocality={selectLocality} notice={persistenceNotice} /> : null}
      {navigation.screen === 'source-info' ? schedule && context
        ? SourceInfo ? <SourceInfo open onClose={backScreen} context={context} schedule={schedule} placeLabel={sourcePlaceLabel}
            onOpenMethodology={() => openScreen('methodology')} /> : null
        : <Screen label={t('scheduleInfo')} top={<BackButton onClick={backScreen} />}><p className="screen-copy">{place ? t('scheduleForDate') : t('noSchedulePlace')}</p></Screen>
        : null}
      {navigation.screen === 'religious-event' && navigation.religiousEventId
        ? LoadedReligiousEventScreen ? <LoadedReligiousEventScreen eventId={navigation.religiousEventId} onBack={backScreen} /> : null
        : null}
      {settingsDialogOpen && SettingsScreens ? <SettingsScreens screen={navigation.screen} preferences={preferences} onChange={updatePreferences}
        fastingModeEnabled={fastingModeEnabled} onFastingModeChange={updateFastingMode}
        themeFamily={themeFamily} onThemeFamilyChange={updateThemeFamily}
        onOpen={openScreen} onBack={backScreen} getCapability={services.getCalculationProfileCapability} onReset={resetWithFastCache} version={version} notice={persistenceNotice}
        sourceLabel={t(PROFILE_LABEL_KEYS[calculationSettings.profile])}
        effectiveSource={resolution}
        initialManualCalculation={place ? initialManualCalculation(place, capabilities) : undefined} /> : null}
      {MethodologyDialog ? <MethodologyDialog open={methodologyDialogOpen} onClose={backScreen} /> : null}
      <ShareDialog open={shareDialogOpen} onClose={backScreen} />
    </AppShell>
  )
}
