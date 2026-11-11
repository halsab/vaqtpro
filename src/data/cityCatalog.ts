import type { City } from '../domain/cities'
import type { DataFailure } from '../domain/errors'
import type { Result } from '../domain/result'

export interface CitySearchResult {
  cities: City[]
  status: 'complete' | 'limited' | 'offline-seed'
  nextOffset?: number
  providerWarning?: 'quota' | 'authorization' | 'service'
}

export interface CityCatalogService {
  load: () => Promise<Result<undefined, DataFailure>>
  search: (query: string, language?: string, startRow?: number) => Promise<Result<CitySearchResult, DataFailure>>
  // Радиус 0–200 км; для GPS-вызова выбранный город становится каноническим якорем расчёта.
  findNearest: (
    latitude: number,
    longitude: number,
    maxDistanceKm: number,
    localOnly?: boolean,
    language?: string,
  ) => Promise<Result<City | null, DataFailure>>
  cancelSearch?: () => void
  cancelNearest?: () => void
  cancelPending?: () => void
}
