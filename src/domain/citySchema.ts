import { isCityFeatureCode, normalizeCitySearch, type CityDataset, type CityDatasetSource, type CompactCityRecord } from './cities'
import { isValidTimeZone } from './locationTime'

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isSource(value: unknown): value is CityDatasetSource {
  return object(value)
    && ['name', 'url', 'license', 'licenseUrl', 'updatedAt'].every(key => typeof value[key] === 'string' && value[key].length > 0)
}

export function isCityRecord(value: unknown): value is CompactCityRecord {
  if (!Array.isArray(value) || (value.length !== 11 && value.length !== 12)) return false
  const row: unknown[] = value
  return typeof row[0] === 'number' && Number.isSafeInteger(row[0]) && row[0] > 0
    && typeof row[1] === 'string' && row[1].trim().length > 0
    && Array.isArray(row[2]) && row[2].length > 0
    && row[2].every(name => typeof name === 'string' && name.length > 0 && normalizeCitySearch(name) === name)
    && row[2][0] === normalizeCitySearch(row[1])
    && typeof row[3] === 'string' && /^[A-Z]{2}$/.test(row[3])
    && typeof row[4] === 'string'
    && typeof row[5] === 'number' && Number.isFinite(row[5]) && Math.abs(row[5]) <= 90
    && typeof row[6] === 'number' && Number.isFinite(row[6]) && Math.abs(row[6]) <= 180
    && typeof row[7] === 'number' && Number.isSafeInteger(row[7]) && row[7] >= 0
    && typeof row[8] === 'string' && isValidTimeZone(row[8])
    && typeof row[9] === 'string'
    && typeof row[10] === 'string' && normalizeCitySearch(row[10]) === row[10]
    && (row[11] === undefined || isCityFeatureCode(row[11]))
}

export function parseOfflineCitySeed(value: unknown): CityDataset {
  if (!object(value) || value.schemaVersion !== 1 || !isSource(value.source)
    || !Array.isArray(value.cities) || value.cities.length > 1000
    || !value.cities.every(isCityRecord)
    || new Set(value.cities.map(city => city[0])).size !== value.cities.length) {
    throw new Error('Невалидный офлайн-набор мест')
  }
  return { source: value.source, cities: value.cities }
}
