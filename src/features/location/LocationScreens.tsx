import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { CityCatalogService, CitySearchResult } from '../../data/cityCatalog'
import { cityFeatureKind, type City } from '../../domain/cities'
import { compactPlaceLabel, getCountryLabel } from '../../domain/countryLabels'
import type { Place } from '../../domain/place'
import type { Locality } from '../../domain/types'
import { BackButton, Screen } from '../../ui/Screen'
import { ActionRow, ActionButton } from '../../ui/controls'
import type { CityCatalogStatus } from './useCityCatalog'
import { formatAccuracy, formatCoordinates, geolocationFailureMessage, nameLookupMessage, type GpsUiState, type NameLookupState } from './locationState'
import { useLocalization } from '../../localization'
import type { Translator } from '../../localization/messages'
import type { SupportedLocale } from '../../localization/locale'
import { localizedCityLabel, localizedCityRegion } from '../../localization/place'
import { getUtcOffset } from '../../domain/locationTime'
import { isSameRecentPlace } from '../../domain/recentPlaces'
import { recentManualDisambiguation, recentManualTitle } from './recentPlaceLabels'

const idleGpsState: GpsUiState = { status: 'idle' }

function cityFeatureLabel(city: City, t: Translator): string {
  switch (cityFeatureKind(city.featureCode ?? null)) {
    case 'district': return t('cityTypeDistrict')
    case 'administrative-seat': return t('cityTypeAdministrativeSeat')
    case 'capital': return t('cityTypeCapital')
    case 'farm-village': return t('cityTypeFarmVillage')
    case 'small-locality': return t('cityTypeSmallLocality')
    case 'settlement': return t('cityTypeSettlement')
  }
}

function locationStatus(gpsState: GpsUiState, nameLookupState: NameLookupState, gpsPlace: boolean, locale: SupportedLocale, t: Translator): string | null {
  if (gpsState.status === 'locating') return t('locating')
  if (gpsState.status === 'refining') return t('refiningLocation')
  if (gpsState.status === 'ready' && gpsState.lowAccuracy) return t('lowAccuracyLocation')
  if (!gpsPlace || gpsState.status === 'error') return null
  return nameLookupMessage(nameLookupState, locale)
}

export function LocationScreen({ place, activePlace, recentPlaces, onBack, onSearch, onSelectRecent, onLocate, onAcceptGps = () => undefined,
  gpsState = idleGpsState, nameLookupState = 'idle', notice, initial = false, bottom, currentTime = new Date(), activeHistoryId }: {
  place: Place | null; activePlace?: Place | null; recentPlaces: Place[]; onBack: () => void; onSearch: () => void
  onSelectRecent: (place: Place) => void; onLocate: () => void | Promise<void>; onAcceptGps?: () => void
  gpsState?: GpsUiState; nameLookupState?: NameLookupState; notice?: ReactNode; initial?: boolean; bottom?: ReactNode
  currentTime?: Date; activeHistoryId?: string
}) {
  const { locale, t } = useLocalization()
  const selected = activePlace === undefined ? place : activePlace
  const recent = recentPlaces.filter(item => item.id !== activeHistoryId && (!selected || !isSameRecentPlace(item, selected)))
  const gpsPlace = place?.selection === 'gps'
  const busy = gpsState.status === 'locating' || gpsState.status === 'refining'
  const lowAccuracy = gpsState.status === 'ready' && gpsState.lowAccuracy
  const status = locationStatus(gpsState, nameLookupState, gpsPlace, locale, t)
  const error = gpsState.status === 'error' ? geolocationFailureMessage(gpsState.reason, locale) : null
  return <Screen label={initial ? t('selectPlace') : t('location')} top={initial ? undefined : <BackButton onClick={onBack} />} bottom={initial ? undefined : bottom}
    contentClassName={initial ? 'screen-center initial-location-content' : ''}>
    {initial ? <div className="initial-location-brand">
      <picture><source media="(prefers-color-scheme: dark)" srcSet="/icons/dark/icon.svg" />
        <img src="/icons/light/icon.svg" width="64" height="64" alt="" /></picture>
      <p className="initial-location-wordmark">{t('appBrand')}</p>
      <h1 className="screen-title">{t('selectPlace')}</h1>
      <p className="note">{t('locationPrayerTimesIntro')}</p>
    </div> : null}
    {place ? <div className="location-current"><p className="screen-title">{gpsPlace
      ? place.nearbyCity ? t('nearestPlace', { name: compactPlaceLabel(place.nearbyCity.name, locale) }) : t('nearestPlaceUnknown')
      : compactPlaceLabel(place.name, locale)}</p>
      {gpsPlace ? <><p className="note location-coordinates">{formatCoordinates(place.latitude, place.longitude)}</p><p className="note">{formatAccuracy(place.accuracy, locale)}</p></>
        : place.region ? <p className="note">{place.region.name}</p> : null}
      <div className="location-timezone" aria-label={t('timezone')}>
        <p className="note"><span>{t('timezone')}:</span> <code>{place.timeZone}</code> <span>({getUtcOffset(currentTime, place.timeZone)})</span></p>
      </div>
    </div> : null}
    <div className="screen-stack">
      <ActionButton variant="field" id="location-search" onClick={onSearch}>{t('locationSearch')}</ActionButton>
      <ActionButton variant="primary" onClick={() => void onLocate()} disabled={busy}>{lowAccuracy || gpsState.status === 'error' ? t('retry') : t('geolocation')}</ActionButton>
      {initial ? <p className="note initial-location-permission">{t('locationPermissionNotice')}</p> : null}
      {gpsPlace && (gpsState.status === 'refining' || lowAccuracy) ? <ActionButton variant="primary" onClick={onAcceptGps}>{t('useThisPoint')}</ActionButton> : null}
      {status ? <p className="note" role="status" aria-live="polite">{status}</p> : null}
      {error ? <p className="note" role="alert">{error}</p> : null}
    </div>
    {recent.length ? <section className="screen-space" aria-label={t('recentPlaces')}><p className="screen-heading">{t('recent')}</p><div className="screen-stack screen-space">
      {recent.map(item => {
        if (item.selection === 'gps') {
          // Название nearby city — только подпись снимка, координаты остаются исходными GPS.
          const cityName = item.nearbyCity && item.nearbyCity.distanceKm <= 25
            ? (item.nearbyCity.cityName?.trim() || item.nearbyCity.name.trim())
            : ''
          const title = cityName ? t('recentGpsCity', { name: cityName }) : t('recentPoint')
          const coordinates = formatCoordinates(item.latitude, item.longitude)
          return <ActionRow key={item.id} title={title} secondary={<span className="note">{coordinates}</span>}
            aria-label={`${title}, ${coordinates}`} onClick={() => onSelectRecent(item)} />
        }
        const title = recentManualTitle(item, locale)
        const disambiguation = recentManualDisambiguation(item, recent, locale)
        return <ActionRow key={item.id} title={title}
          {...(disambiguation ? {
            secondary: <span className="note">{disambiguation}</span>,
            'aria-label': `${title}, ${disambiguation}`,
          } : {})}
          onClick={() => onSelectRecent(item)} />
      })}
    </div></section> : null}
    {notice}
  </Screen>
}

interface SearchScreenProps {
  locations: Locality[]
  catalogStatus: CityCatalogStatus
  onLoadCities: (retry?: boolean) => void
  onCancelSearch?: () => void
  onSearchCities: CityCatalogService['search']
  onBack: () => void
  onSelectLocality: (id: string) => void
  onSelectCity: (city: City) => void
  notice?: ReactNode
}
interface SearchCompletion { query: string; data: CitySearchResult | null; failed: boolean }

export function SearchScreen({ locations, catalogStatus, onLoadCities, onCancelSearch, onSearchCities, onBack, onSelectLocality, onSelectCity, notice }: SearchScreenProps) {
  const { locale, t } = useLocalization()
  const [text, setText] = useState('')
  const [completion, setCompletion] = useState<SearchCompletion | null>(null)
  const [retry, setRetry] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreFailed, setMoreFailed] = useState(false)
  const pageRevision = useRef(0)
  const query = text.trim()
  useEffect(() => { onLoadCities() }, [onLoadCities])
  useEffect(() => () => onCancelSearch?.(), [onCancelSearch])
  useEffect(() => {
    if (!query) return
    let active = true
    const timer = setTimeout(() => {
      void onSearchCities(query, locale).then(result => {
        if (active) setCompletion({ query, data: result.ok ? result.value : null, failed: !result.ok })
      }).catch(() => { if (active) setCompletion({ query, data: null, failed: true }) })
    }, 350)
    return () => { active = false; clearTimeout(timer) }
  }, [query, onSearchCities, locale, retry])
  const localities = useMemo(() => query ? locations.filter(item => item.name.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru'))) : [], [locations, query])
  const ready = completion?.query === query ? completion : null
  const pending = query.length >= 2 && !ready
  const cities = ready?.data?.cities ?? []
  const retrySearch = () => { pageRevision.current += 1; setCompletion(null); setMoreFailed(false); setRetry(value => value + 1); onLoadCities(true) }
  const loadMore = () => {
    const offset = ready?.data?.nextOffset
    if (offset === undefined || loadingMore || !ready?.data) return
    const revision = ++pageRevision.current
    setLoadingMore(true)
    setMoreFailed(false)
    void onSearchCities(query, locale, offset).then(result => {
      if (revision !== pageRevision.current) return
      if (!result.ok) { setMoreFailed(true); return }
      setCompletion(previous => {
        if (previous?.query !== query || !previous.data) return previous
        const citiesById = new Map([...previous.data.cities, ...result.value.cities].map(city => [city.id, city]))
        return { query, failed: false, data: { ...result.value, cities: [...citiesById.values()] } }
      })
    }).catch(() => { if (revision === pageRevision.current) setMoreFailed(true) })
      .finally(() => { if (revision === pageRevision.current) setLoadingMore(false) })
  }
  const status = query && query.length < 2 ? t('cityEnterMore')
    : pending ? t('citySearching')
    : query && ready?.data?.providerWarning === 'quota' ? t('cityGeoNamesQuota')
    : query && ready?.data?.providerWarning === 'authorization' ? t('cityGeoNamesAuth')
    : query && ready?.data?.providerWarning === 'service' ? t('cityGeoNamesService')
    : query && ready?.failed ? t('citySearchFailed')
      : query && ready?.data?.status === 'offline-seed' ? t('cityOfflineSeed')
        : query && ready?.data?.status === 'limited' ? t('citySearchLimited')
        : query && ready && !cities.length && !localities.length ? t('cityNotFound')
          : !query && catalogStatus === 'offline' ? t('citySearchNeedsInternet')
            : !query && catalogStatus === 'error' ? t('cityLoadFailed')
              : !query && (catalogStatus === 'loading' || catalogStatus === 'idle') ? t('cityLoading') : null
  const canRetry = ready?.failed || ready?.data?.status === 'offline-seed'
    || (!query && ['offline', 'error'].includes(catalogStatus))
  return <Screen label={t('searchCity')} top={<BackButton onClick={onBack} label={t('cancel')} />}>
    <input className="text-field" data-screen-focus type="search" aria-label={t('searchPlaceLabel')} placeholder={t('locationSearch')} value={text}
      onChange={event => { onCancelSearch?.(); pageRevision.current += 1; setMoreFailed(false); setLoadingMore(false); setText(event.target.value); if (event.target.value.trim() !== query) setCompletion(null) }} autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="search" />
    <ul className="city-results" aria-label={t('searchResults')} aria-busy={pending || loadingMore}>
      {localities.map(item => <li key={item.id}><ActionRow className="city-result" title={item.name}
        secondary={<span className="note">{t('tatarstanLocalityResult')}</span>} onClick={() => onSelectLocality(item.id)} />
      </li>)}
      {cities.map(city => {
        const sameLabel = cities.some(other => other.id !== city.id && localizedCityLabel(other, false, locale, t) === localizedCityLabel(city, false, locale, t))
        const entityContext = [city.admin2Name, localizedCityRegion(city, t), getCountryLabel(city.countryCode, locale), cityFeatureLabel(city, t)].filter(Boolean).join(', ')
        const nearby = city.nearbyMajorCity
        return <li key={city.id}><ActionRow className="city-result" aria-label={`${localizedCityLabel(city, sameLabel, locale, t)}, ${cityFeatureLabel(city, t)}`} title={city.name}
          secondary={<span className="note">{entityContext}{sameLabel ? ` · ${city.id}` : ''}</span>}
          onClick={() => onSelectCity(city)} />
          {nearby ? <ActionRow className="city-result" title={t('cityNearbyMajor', {
            name: nearby.city.name, distance: Math.round(nearby.distanceKm),
          })} secondary={<span className="note">{t('cityNearbyMajorHint')}</span>}
            onClick={() => onSelectCity(nearby.city)} /> : null}
        </li>
      })}
    </ul>
    {status ? <p className="note screen-space" role="status">{status}</p> : null}
    {ready?.data?.nextOffset !== undefined ? <ActionButton className="screen-space" onClick={loadMore} disabled={loadingMore}>{t('cityMoreResults')}</ActionButton> : null}
    {moreFailed ? <p className="note" role="alert">{t('cityMoreFailed')}</p> : null}
    {canRetry ? <ActionButton className="screen-space" onClick={retrySearch}>{t('retry')}</ActionButton> : null}
    {notice}
  </Screen>
}
