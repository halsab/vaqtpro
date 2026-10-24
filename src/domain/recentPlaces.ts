import { getDeviceTimeZone } from './locationTime'
import { haversineDistanceKm } from './location'
import type { Place, RestorablePlace } from './place'
import { restorePlaceMetadata } from './place'
import { isPlace, isRestorablePlace } from './placeMigration'

export const MAX_RECENT_PLACES = 10
export const GPS_HISTORY_DEDUPE_METERS = 500

function distanceMeters(a: Place, b: Place): number {
  return haversineDistanceKm(a.latitude, a.longitude, b.latitude, b.longitude) * 1_000
}

function gpsIdentity(place: Place): string {
  // Новая identity снимка не зависит от epoch запроса, времени фиксации или подписи.
  return `gps:history:${place.latitude.toFixed(6)}:${place.longitude.toFixed(6)}`
}

function historyIdentity(place: Place): string {
  return place.id.startsWith('gps:history:') ? place.id : gpsIdentity(place)
}

function uniqueIdentity(base: string, used: ReadonlySet<string>): string {
  if (!used.has(base)) return base
  let suffix = 1
  while (used.has(`${base}:recovered:${suffix}`)) suffix += 1
  return `${base}:recovered:${suffix}`
}

function canonicalPlace(place: RestorablePlace): Place {
  const { timeZoneOverride: _legacyOverride, ...withoutLegacyOverride } = place as Place & { timeZoneOverride?: unknown }
  const restored = restorePlaceMetadata(withoutLegacyOverride)
  if (restored.selection === 'gps') {
    const timeZone = getDeviceTimeZone()
    return { ...restored, timeZone, automaticTimeZone: { id: timeZone, source: 'device' } }
  }
  return restored
}

function sameIdentity(a: Place, b: Place): boolean {
  if (a.selection !== b.selection) return false
  if (a.selection !== 'gps') return a.id === b.id
  return a.id === b.id || distanceMeters(a, b) <= GPS_HISTORY_DEDUPE_METERS
}

function findGpsMatch(places: readonly Place[], candidate: Place): Place | undefined {
  return places
    .filter(place => place.selection === 'gps')
    .map((place, index) => ({ place, index, distance: distanceMeters(place, candidate) }))
    .filter(entry => entry.distance <= GPS_HISTORY_DEDUPE_METERS)
    .sort((a, b) => a.distance - b.distance || a.index - b.index)[0]?.place
}

export function findRecentPlace(places: readonly Place[], candidate: Place): Place | undefined {
  return candidate.selection === 'gps'
    ? places.find(place => place.selection === 'gps' && place.id === candidate.id) ?? findGpsMatch(places, candidate)
    : places.find(place => place.selection === candidate.selection && place.id === candidate.id)
}

function mergeInto(places: Place[], candidate: Place, promote: boolean): Place[] {
  const stableGpsId = candidate.selection === 'gps' && candidate.id.startsWith('gps:history:')
  const matched = candidate.selection === 'gps'
    ? (stableGpsId ? places.find(place => place.selection === 'gps' && place.id === candidate.id) : undefined)
      ?? findGpsMatch(places, candidate)
    : places.find(place => place.selection === candidate.selection && place.id === candidate.id)
  const generatedId = candidate.selection === 'gps'
    ? uniqueIdentity(historyIdentity(candidate), new Set(places.map(place => place.id)))
    : candidate.id
  const normalized = canonicalPlace({ ...candidate, id: matched?.id ?? generatedId })
  if (!matched) return [normalized, ...places]
  return promote
    ? [normalized, ...places.filter(place => place !== matched)]
    : places.map(place => place === matched ? normalized : place)
}

/** Нормализует только сохранённую историю; миграция активного места вызывается отдельно. */
export function restoreRecentPlaces(value: unknown): Place[] {
  const source = Array.isArray(value) ? value : []
  const valid = source.filter(isRestorablePlace).map(canonicalPlace)
  const normalized: Place[] = []
  const identities = new Set<string>()
  for (const place of valid) {
    const stableMatch = place.selection === 'gps'
      ? normalized.find(item => item.selection === 'gps' && item.id === place.id
        && distanceMeters(item, place) <= GPS_HISTORY_DEDUPE_METERS)
      : undefined
    const match = place.selection === 'gps'
      ? stableMatch ?? findGpsMatch(normalized, place)
      : normalized.find(item => item.selection === place.selection && item.id === place.id)
    if (match) continue
    const id = uniqueIdentity(place.selection === 'gps' ? historyIdentity(place) : place.id, identities)
    identities.add(id)
    normalized.push({ ...place, id })
  }
  return normalized.slice(0, MAX_RECENT_PLACES)
}

/** Добавляет активное место первым только при миграции сохранённой legacy-истории. */
export function migrateRecentPlaces(value: unknown, current?: Place | null): Place[] {
  const normalized = restoreRecentPlaces(value)
  if (!current || !isPlace(current)) return normalized
  const matching = current.selection === 'gps'
    ? normalized.find(place => place.selection === 'gps' && place.id === current.id)
      ?? findGpsMatch(normalized, current)
    : normalized.find(place => place.selection === current.selection && place.id === current.id)
  if (matching) {
    if (current.selection === 'gps') return [matching, ...normalized.filter(place => place !== matching)].slice(0, MAX_RECENT_PLACES)
    return rememberPlace(normalized, current)
  }
  const migrated = canonicalPlace(current)
  const id = uniqueIdentity(migrated.selection === 'gps' ? historyIdentity(migrated) : migrated.id,
    new Set(normalized.map(place => place.id)))
  return [{ ...migrated, id }, ...normalized].slice(0, MAX_RECENT_PLACES)
}

/** Поднимает явно выбранный снимок, сохраняя найденную GPS identity. */
export function rememberPlace(recent: Place[], selected: Place): Place[] {
  return mergeInto(recent, selected, true).slice(0, MAX_RECENT_PLACES)
}

/** Обогащает GPS-снимок только после подтверждения его связи с принятой операцией. */
export function updateRecentPlace(recent: Place[], selected: Place, historyId?: string): Place[] {
  if (selected.selection !== 'gps') return recent
  const matched = historyId ? recent.find(place => place.selection === 'gps' && place.id === historyId) : findGpsMatch(recent, selected)
  if (!matched) return recent
  const normalized = canonicalPlace({ ...selected, id: matched.id })
  return recent.flatMap(place => {
    if (place === matched) return [normalized]
    if (place.selection === 'gps' && (place.id === normalized.id || distanceMeters(place, normalized) <= GPS_HISTORY_DEDUPE_METERS)) return []
    return [place]
  }).slice(0, MAX_RECENT_PLACES)
}

export function isSameRecentPlace(a: Place, b: Place): boolean {
  return sameIdentity(a, b)
}
