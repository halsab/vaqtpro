import type { City } from '../domain/cities'
import type { DataFailure } from '../domain/errors'
import type { Result } from '../domain/result'

export interface CitySearchResult {
  cities: City[]
  status: 'complete' | 'offline-seed'
}

export interface CityCatalogService {
  load: () => Promise<Result<undefined, DataFailure>>
  search: (query: string, language?: string) => Promise<Result<CitySearchResult, DataFailure>>
  // Радиус 0–200 км. Город — подсказка названия, не регион или timezone GPS-точки.
  findNearest: (
    latitude: number,
    longitude: number,
    maxDistanceKm: number,
    localOnly?: boolean,
  ) => Promise<Result<City | null, DataFailure>>
  cancelSearch?: () => void
  cancelPending?: () => void
}
