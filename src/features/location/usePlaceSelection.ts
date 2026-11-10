import { useCallback, useEffect, useRef, useState } from 'react'
import type { CityCatalogService } from '../../data/cityCatalog'
import type { CoverageGeometry } from '../../domain/localGeography'
import type { LocationChoice } from '../../storage/database'
import type { LocationSelectionSource } from '../../domain/locationSelection'
import { shouldStartAutomaticLocation } from '../../domain/locationSelection'
import { createCityPlace, createGpsPlace, createLocalityPlace, isFreshGpsPlace, isUsefulRefinement, refineGpsPlace, type Place } from '../../domain/place'
import { placeFromChoice } from '../../domain/placeMigration'
import { validPosition } from '../../domain/localGeography'
import { haversineDistanceKm } from '../../domain/location'
import type { City } from '../../domain/cities'
import type { GeolocationFailure } from '../../domain/errors'
import type { Result } from '../../domain/result'
import type { Locality } from '../../domain/types'
import { translate } from '../../localization'
import type { Coordinates, GeolocationPermission, PositionAccuracy } from '../../platform/browser'
import { geolocationFailureMessage, isLowAccuracy, preferredGeolocationFailure, type GpsUiState, type NameLookupState } from './locationState'

export type PlacePersistenceChange = 'automatic' | 'selection' | 'refinement'

interface PlaceSelectionServices {
  cities: Pick<CityCatalogService, 'findNearest'>
  getDeviceTimeZone: () => string
  getPermission: () => Promise<GeolocationPermission>
  getPosition: (accuracy: PositionAccuracy) => Promise<Result<Coordinates, GeolocationFailure>>
  loadGeography: () => Promise<CoverageGeometry | null>
  now: () => Date
}

export function usePlaceSelection(services: PlaceSelectionServices, locations: Locality[], onChosen: () => void,
  persist: (choice: LocationChoice, change?: PlacePersistenceChange) => void,
  initial?: { place: Place; source: LocationSelectionSource }) {
  const [place, setPlace] = useState<Place | null>(() => initial?.place ?? null)
  const [source, setSource] = useState<LocationSelectionSource>(() => initial?.source ?? 'default')
  const [notice, setNotice] = useState<string | null>(null)
  const [gpsState, setGpsState] = useState<GpsUiState>({ status: 'idle' })
  const [gpsPreview, setGpsPreview] = useState<Place | null>(null)
  const [nameLookupState, setNameLookupState] = useState<NameLookupState>('idle')
  const current = useRef<Place | null>(initial?.place ?? null)
  const gpsPreviewRef = useRef<Place | null>(null)
  const initialPlace = useRef<Place | null>(initial?.place ?? null)
  const confirmed = useRef<Place | null>(initial?.place ?? null)
  const confirmedSource = useRef<LocationSelectionSource>(initial?.source ?? 'default')
  const currentSource = useRef<LocationSelectionSource>(initial?.source ?? 'default')
  const epoch = useRef(0)
  const activeInteractive = useRef<{ operation: number; navigated: boolean; recorded: boolean } | null>(null)
  const started = useRef(false)
  const restored = useRef(false)
  useEffect(() => () => { epoch.current += 1; activeInteractive.current = null }, [])

  const saveChoice = useCallback((next: Place, selectionSource: LocationSelectionSource, change: PlacePersistenceChange = 'automatic') => {
    persist({ mode: 'calculated', coordinates: next, source: selectionSource, place: next }, change)
  }, [persist])

  const apply = useCallback((next: Place, selectionSource: LocationSelectionSource, operation: number,
    change: 'automatic' | 'selection' | 'refinement' = 'automatic') => {
    if (operation !== epoch.current) return
    const pendingInteractiveGps = next.selection === 'gps'
      && activeInteractive.current?.operation === operation
      && !activeInteractive.current.navigated
      && current.current?.id !== next.id
    current.current = next
    currentSource.current = selectionSource
    setPlace(next)
    setSource(selectionSource)
    if (!pendingInteractiveGps || change === 'selection' || change === 'refinement') {
      confirmed.current = next
      confirmedSource.current = selectionSource
    }
    if (pendingInteractiveGps && change === 'automatic') return
    saveChoice(next, selectionSource, change)
  }, [saveChoice])

  const restore = useCallback((choice: LocationChoice | null, availableLocations: Locality[]) => {
    if (current.current && current.current !== initialPlace.current) {
      restored.current = true
      return
    }
    if (restored.current) return
    restored.current = true
    if (!choice) {
      started.current = true
      return
    }
    const saved = placeFromChoice(choice.place && choice.place.selection === 'gps'
      ? { mode: 'calculated', coordinates: choice.place, source: choice.source, place: choice.place }
      : choice, availableLocations)
    current.current = saved
    currentSource.current = choice.source
    confirmed.current = saved
    confirmedSource.current = choice.source
    setPlace(saved)
    setSource(choice.source)
  }, [])

  const finishInteractive = useCallback((operation: number) => {
    const active = activeInteractive.current
    if (!active || active.operation !== operation) return
    if (!active.recorded && current.current?.selection === 'gps') {
      active.recorded = true
      confirmed.current = current.current
      confirmedSource.current = currentSource.current
      saveChoice(current.current, 'automatic', 'selection')
    }
    if (active.navigated) return
    active.navigated = true
    onChosen()
  }, [onChosen, saveChoice])

  const locate = useCallback(async (interactive = true, existingEpoch?: number) => {
    const operation = existingEpoch ?? ++epoch.current
    started.current = true
    setNotice(null)
    setNameLookupState('idle')
    if (interactive) {
      activeInteractive.current = { operation, navigated: false, recorded: false }
      gpsPreviewRef.current = null
      setGpsPreview(null)
      setGpsState({ status: 'locating' })
    } else {
      activeInteractive.current = null
    }
    const geometry = services.loadGeography().catch(() => null)
    const operationResult: { best: Place | null; selectedCity?: Place } = { best: null }
    const runtimeId = `gps:${crypto.randomUUID()}`
    let preciseAccepted = false
    const failures: GeolocationFailure[] = []
    const finished = { coarse: false, precise: false }

    const lookupName = async (next: Place) => {
      setNameLookupState('loading')
      // Интерактивный запрос может загрузить только вычисленный spatial package; фон остаётся local-only.
      try {
        const result = await services.cities.findNearest(next.latitude, next.longitude, 25, !interactive)
        if (operation !== epoch.current) return
        if (!result.ok) {
          setNameLookupState(result.error.reason === 'offline' ? 'offline' : 'failed')
          return
        }
        if (!result.value) {
          setNameLookupState('not-found')
          return
        }
        if (haversineDistanceKm(next.latitude, next.longitude, result.value.latitude, result.value.longitude) > 25) {
          setNameLookupState('not-found')
          return
        }
        if (operationResult.selectedCity) return
        operationResult.selectedCity = createCityPlace(result.value, next.timestamp)
        apply(operationResult.selectedCity, 'automatic', operation, interactive ? 'selection' : 'automatic')
        if (interactive) finishInteractive(operation)
        setNameLookupState('resolved')
      } catch {
        if (operation === epoch.current) setNameLookupState('failed')
      }
    }

    const receive = async (accuracy: 'coarse' | 'precise') => {
      try {
        const result = await services.getPosition(accuracy)
        if (operation !== epoch.current) return
        if (!result.ok) { failures.push(result.error); return }
        if (!validPosition(result.value) || !Number.isFinite(result.value.timestamp)) {
          failures.push({ kind: 'geolocation', reason: 'unavailable' })
          return
        }
        const data = await geometry
        if (operation !== epoch.current || operationResult.selectedCity || (accuracy === 'coarse' && preciseAccepted)) return
        // После выбора населённого пункта координаты GPS уже не должны менять расчётный якорь.
        const pendingInteractive = interactive && activeInteractive.current?.operation === operation && !activeInteractive.current.navigated
        const basePreview = pendingInteractive ? gpsPreviewRef.current : null
        const enriched = current.current?.selection === 'gps' && current.current.id === operationResult.best?.id
          ? current.current
          : null
        const base = enriched ?? basePreview ?? operationResult.best
        const next = base
          ? refineGpsPlace(base, result.value, services.getDeviceTimeZone(), data)
          : createGpsPlace(result.value, services.getDeviceTimeZone(), data, runtimeId)
        const isNewPreciseFix = accuracy === 'precise' && result.value.timestamp > (operationResult.best?.timestamp ?? -Infinity)
        if (operationResult.best && !isNewPreciseFix && !isUsefulRefinement(operationResult.best, next)) {
          if (accuracy === 'precise') preciseAccepted = true
          return
        }
        if (accuracy === 'precise') preciseAccepted = true
        operationResult.best = next
        if (pendingInteractive && isLowAccuracy(next.accuracy)) {
          gpsPreviewRef.current = next
          setGpsPreview(next)
        } else {
          gpsPreviewRef.current = null
          setGpsPreview(null)
          apply(next, 'automatic', operation,
            activeInteractive.current?.operation === operation && activeInteractive.current.navigated ? 'refinement' : 'automatic')
        }
        if (interactive) {
          const lowAccuracy = isLowAccuracy(next.accuracy)
          if (!lowAccuracy) {
            setGpsState({ status: 'ready', lowAccuracy: false })
            finishInteractive(operation)
          } else if (accuracy === 'coarse' && !finished.precise) {
            setGpsState({ status: 'refining' })
          } else {
            setGpsState({ status: 'ready', lowAccuracy: true })
          }
        }
      } catch {
        failures.push({ kind: 'geolocation', reason: 'unavailable' })
      } finally {
        finished[accuracy] = true
        if (interactive && operation === epoch.current && accuracy === 'precise' && operationResult.best && isLowAccuracy(operationResult.best.accuracy)) {
          setGpsState({ status: 'ready', lowAccuracy: true })
        }
      }
    }
    // getCurrentPosition не отменяется AbortController; epoch отсекает обе одноразовые операции.
    await Promise.all([receive('coarse'), receive('precise')])
    if (operation !== epoch.current) return
    if (operationResult.best && !operationResult.selectedCity) void lookupName(operationResult.best)
    if (operationResult.best) {
      if (interactive && isLowAccuracy(operationResult.best.accuracy)) setGpsState({ status: 'ready', lowAccuracy: true })
      return
    }
    const reason = preferredGeolocationFailure(failures.map(error => error.reason))
    if (interactive) setGpsState({ status: 'error', reason })
    else setNotice(`${geolocationFailureMessage(reason)} ${translate('ru', 'savedPlaceStillAvailable')}`)
  }, [apply, finishInteractive, services])

  useEffect(() => {
    if (!place || started.current || !shouldStartAutomaticLocation({ source }) || isFreshGpsPlace(place, services.now().getTime())) return
    started.current = true
    const operation = ++epoch.current
    void services.getPermission().then(permission => {
      if (operation === epoch.current && permission === 'granted') void locate(false, operation)
    }).catch(() => undefined)
  }, [locate, place, services, source])

  const selectLocality = useCallback((id: string) => {
    const location = locations.find(item => item.id === id)
    if (!location) return
    setNotice(null)
    setGpsState({ status: 'idle' })
    setNameLookupState('idle')
    activeInteractive.current = null
    gpsPreviewRef.current = null
    setGpsPreview(null)
    apply(createLocalityPlace(location, services.now().getTime()), 'manual', ++epoch.current, 'selection')
    onChosen()
  }, [apply, locations, onChosen, services])
  const selectCity = useCallback((city: City) => {
    setNotice(null)
    setGpsState({ status: 'idle' })
    setNameLookupState('idle')
    activeInteractive.current = null
    gpsPreviewRef.current = null
    setGpsPreview(null)
    apply(createCityPlace(city, services.now().getTime()), 'manual', ++epoch.current, 'selection')
    onChosen()
  }, [apply, onChosen, services])
  const selectRecent = useCallback((recent: Place) => {
    setNotice(null)
    setGpsState({ status: 'idle' })
    setNameLookupState('idle')
    activeInteractive.current = null
    gpsPreviewRef.current = null
    setGpsPreview(null)
    const selected = recent.selection === 'gps'
      ? { ...recent, timeZone: services.getDeviceTimeZone(), automaticTimeZone: { id: services.getDeviceTimeZone(), source: 'device' as const } }
      : recent
    apply(selected, 'manual', ++epoch.current, 'selection')
    onChosen()
  }, [apply, onChosen, services])
  const synchronizeDeviceTimeZone = useCallback(() => {
    const timeZone = services.getDeviceTimeZone()
    const selected = confirmed.current
    if (selected?.selection === 'gps' && (selected.timeZone !== timeZone || selected.automaticTimeZone.id !== timeZone)) {
      const { timeZoneOverride: _legacyOverride, ...base } = selected as Place & { timeZoneOverride?: unknown }
      apply({ ...base, timeZone, automaticTimeZone: { id: timeZone, source: 'device' } }, source, epoch.current)
    }
    const preview = gpsPreviewRef.current
    if (preview && (preview.timeZone !== timeZone || preview.automaticTimeZone.id !== timeZone)) {
      const { timeZoneOverride: _legacyOverride, ...base } = preview as Place & { timeZoneOverride?: unknown }
      const synchronized = { ...base, timeZone, automaticTimeZone: { id: timeZone, source: 'device' as const } }
      gpsPreviewRef.current = synchronized
      setGpsPreview(synchronized)
    }
  }, [apply, services, source])
  useEffect(() => {
    window.addEventListener('pageshow', synchronizeDeviceTimeZone)
    document.addEventListener('visibilitychange', synchronizeDeviceTimeZone)
    synchronizeDeviceTimeZone()
    return () => {
      window.removeEventListener('pageshow', synchronizeDeviceTimeZone)
      document.removeEventListener('visibilitychange', synchronizeDeviceTimeZone)
    }
  }, [synchronizeDeviceTimeZone, place])
  const acceptGps = useCallback(() => {
    const active = activeInteractive.current
    const selected = gpsPreviewRef.current
    if (!active || active.operation !== epoch.current || !selected || selected.selection !== 'gps') return
    gpsPreviewRef.current = null
    setGpsPreview(null)
    apply(selected, 'automatic', active.operation)
    setGpsState({ status: 'ready', lowAccuracy: isLowAccuracy(selected.accuracy) })
    finishInteractive(active.operation)
  }, [apply, finishInteractive])
  const cancelInteractive = useCallback(() => {
    const active = activeInteractive.current
    if (!active || active.operation !== epoch.current || active.navigated) return
    epoch.current += 1
    activeInteractive.current = null
    started.current = true
    gpsPreviewRef.current = null
    setGpsPreview(null)
    setNotice(null)
    setGpsState({ status: 'idle' })
    setNameLookupState('idle')
  }, [])
  const invalidate = useCallback(() => {
    epoch.current += 1
    started.current = true
    activeInteractive.current = null
    gpsPreviewRef.current = null
    setGpsPreview(null)
    setGpsState({ status: 'idle' })
    setNameLookupState('idle')
  }, [])
  return { place, gpsPreview, source, notice, gpsState, nameLookupState, restore, locate, acceptGps, cancelInteractive, selectLocality, selectCity, selectRecent, invalidate }
}
