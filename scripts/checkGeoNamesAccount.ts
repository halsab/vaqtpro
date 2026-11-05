import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

/** Release-only public GeoNames username smoke check (one credit, no GPS coordinates). */
export async function checkGeoNamesAccount(username: string, fetcher: typeof fetch = fetch): Promise<void> {
  if (!username.trim()) throw new Error('Missing GeoNames username')
  const url = new URL('https://secure.geonames.org/searchJSON')
  url.searchParams.set('name_startsWith', 'London')
  url.searchParams.set('featureClass', 'P')
  url.searchParams.set('maxRows', '1')
  url.searchParams.set('style', 'FULL')
  url.searchParams.set('username', username.trim())

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetcher(url, { cache: 'no-store', signal: controller.signal })
    if (!response.ok) throw new Error('GeoNames is unavailable or rejected the configured username')
    const payload: unknown = await response.json()
    if (!payload || typeof payload !== 'object' || !('geonames' in payload)
      || !Array.isArray(payload.geonames) || payload.geonames.length === 0) {
      throw new Error('GeoNames returned no usable result; check account activation and quotas')
    }
    const first: unknown = payload.geonames[0]
    if (!first || typeof first !== 'object' || !('geonameId' in first)) {
      throw new Error('GeoNames returned a malformed search result')
    }
  } finally {
    clearTimeout(timeout)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkGeoNamesAccount(process.env.GEONAMES_USERNAME ?? '')
    .then(() => { process.stdout.write('GeoNames search verified with configured username.\n') })
    .catch((error: unknown) => {
      process.stderr.write(error instanceof Error ? error.message : 'GeoNames account check failed')
      process.exitCode = 1
    })
}
