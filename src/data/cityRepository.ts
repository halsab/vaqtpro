import type { DataFailure } from '../domain/errors'
import type { CityDataset } from '../domain/cities'
import { parseOfflineCitySeed } from '../domain/citySchema'
import { failure, success, type Result } from '../domain/result'
import { clearLegacyCatalogStorage } from '../storage/cityCatalogStorage'

const SEED_URL = '/data/cities/offline-seed.json'

export async function loadOfflineCitySeed(): Promise<Result<CityDataset, DataFailure>> {
  try {
    void clearLegacyCatalogStorage().catch(() => undefined)
    const response = await fetch(SEED_URL, { cache: 'no-store' })
    if (!response.ok) {
      const isOffline = (navigator as unknown as { onLine?: unknown }).onLine === false
      return failure({ kind: 'data', reason: isOffline ? 'offline' : 'unavailable' })
    }
    const data = await response.json() as unknown
    try {
      return success(parseOfflineCitySeed(data))
    } catch {
      return failure({ kind: 'data', reason: 'invalid' })
    }
  } catch {
    return failure({ kind: 'data', reason: 'unavailable' })
  }
}
