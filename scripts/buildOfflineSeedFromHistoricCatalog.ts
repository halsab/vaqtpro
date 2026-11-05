/** Reproducible offline major-place subset from the previously reviewed GeoNames snapshot. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { CompactCityRecord, CityDatasetSource } from '../src/domain/cities'

const SOURCE_COMMIT = '89e1f3d6a51de529f111f7f271531e2866e99c49'
const MIN_MAJOR_POPULATION = 150_000
const TOP_PER_COUNTRY = 3
const MAX_SEED_BYTES = 3 * 1024 * 1024
const output = fileURLToPath(new URL('../public/data/cities/offline-seed.json', import.meta.url))

interface ShardDescriptor { id: string; count: number; sha256: string }
interface HistoricalIndex { version: string; source: CityDatasetSource; shards: ShardDescriptor[] }
interface HistoricalShard { schemaVersion: number; version: string; id: string; cities: CompactCityRecord[] }

function atCommit(path: string): string {
  return execFileSync('git', ['show', `${SOURCE_COMMIT}:${path}`], {
    encoding: 'utf8', maxBuffer: 3 * 1024 * 1024,
  })
}
function digest(value: string): string { return createHash('sha256').update(value).digest('hex') }

export function buildOfflineSeed(): string {
  const index = JSON.parse(atCommit('public/data/cities/index.json')) as HistoricalIndex
  const all: CompactCityRecord[] = []
  const unique = new Set<number>()
  for (const descriptor of index.shards) {
    const json = atCommit(`public/data/cities/${index.version}/${descriptor.id}.json`)
    if (digest(json) !== descriptor.sha256) throw new Error(`Invalid source hash: ${descriptor.id}`)
    const shard = JSON.parse(json) as HistoricalShard
    if (shard.schemaVersion !== 4 || shard.version !== index.version || shard.id !== descriptor.id
      || shard.cities.length !== descriptor.count) throw new Error(`Invalid source metadata: ${descriptor.id}`)
    for (const row of shard.cities) {
      if (unique.has(row[0])) throw new Error(`Duplicate GeoNames ID ${row[0]}`)
      unique.add(row[0])
      all.push(row)
    }
  }
  const byCountry = new Map<string, CompactCityRecord[]>()
  for (const row of all) {
    const group = byCountry.get(row[3]) ?? []
    group.push(row)
    byCountry.set(row[3], group)
  }
  const top = new Set<number>()
  for (const group of byCountry.values()) {
    group.sort((a, b) => b[7] - a[7] || a[0] - b[0])
    for (const row of group.slice(0, TOP_PER_COUNTRY)) top.add(row[0])
  }
  const cities = all.filter(row => row[7] >= MIN_MAJOR_POPULATION || top.has(row[0]))
    .sort((a, b) => a[3].localeCompare(b[3]) || b[7] - a[7] || a[0] - b[0])
  const result = JSON.stringify({ schemaVersion: 1, source: index.source, cities })
  if (Buffer.byteLength(result) > MAX_SEED_BYTES) throw new Error('Offline seed exceeds 3 MiB')
  return result
}

const generated = buildOfflineSeed()
if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8') !== generated) throw new Error('Offline seed is out of date')
  process.stdout.write('Verified pinned offline GeoNames source and generated seed.\n')
} else {
  writeFileSync(output, generated)
  process.stdout.write(`Generated ${Buffer.byteLength(generated)} bytes of major-place offline data.\n`)
}
