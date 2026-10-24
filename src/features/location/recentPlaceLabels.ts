import { compactPlaceLabel, getCountryLabel } from '../../domain/countryLabels'
import type { Place } from '../../domain/place'
import type { SupportedLocale } from '../../localization/locale'
import { formatCoordinates } from './locationState'

/** The exact primary text used for manually selected recent places. */
export function recentManualTitle(place: Place, locale: SupportedLocale): string {
  if (place.id.startsWith('geonames:')) return place.cityName?.trim() || place.name
  if (place.id.startsWith('locality:')) return place.name
  return compactPlaceLabel(place.name, locale)
}

function countryForRecent(place: Place, locale: SupportedLocale): string {
  // Place.region.code is structured metadata, not part of a formatted city label.
  // RU-TA is the verified special region code for official Tatarstan localities.
  const countryCode = /^([A-Z]{2})(?:\.|-|$)/.exec(place.region?.code ?? '')?.[1]
  return countryCode ? getCountryLabel(countryCode, locale) : ''
}

function geographicVariants(place: Place, locale: SupportedLocale): string[] {
  const region = place.region?.name.trim() ?? ''
  const country = countryForRecent(place, locale)
  const regionAndCountry = [region, country].filter(Boolean).join(', ')
  const coordinates = formatCoordinates(place.latitude, place.longitude)
  const geographicCoordinates = [regionAndCountry, coordinates].filter(Boolean).join(' · ')
  return [
    region,
    regionAndCountry,
    geographicCoordinates,
    `${geographicCoordinates} · ${place.id}`,
  ]
}

/**
 * Only manually selected rows with matching visible primary titles get a secondary label.
 * Escalate from region to country, coordinates, then stable identity only as needed.
 * Compare candidates across the entire visible collision group, not stored/hidden rows.
 */
export function recentManualDisambiguation(place: Place, visible: readonly Place[], locale: SupportedLocale): string | null {
  if (place.selection === 'gps') return null
  const normalizedTitle = recentManualTitle(place, locale).trim().toLocaleLowerCase(locale)
  const collisions = visible.filter(other => other.selection !== 'gps'
    && recentManualTitle(other, locale).trim().toLocaleLowerCase(locale) === normalizedTitle)
  if (collisions.length < 2) return null

  const options = geographicVariants(place, locale)
  for (let level = 0; level < options.length; level++) {
    const candidate = options[level]
    if (candidate && collisions.every(other => other === place
      || geographicVariants(other, locale)[level] !== candidate)) return candidate
  }
  // Distinct persisted identities are normally unique; malformed data is repaired at restore.
  return options[options.length - 1] ?? place.id
}
