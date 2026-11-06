import { createHash } from 'node:crypto'
import { appendFile, readFile, readdir, stat } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

import { parseOfflineCitySeed } from '../src/domain/citySchema'

export interface BuildArtifact {
  path: string
  size: number
}

export interface SizeMetric {
  rawBytes: number
  gzipBytes: number
}

export interface BuildSizeReport {
  mainJavaScript: SizeMetric
  totalJavaScript: SizeMetric
  totalCss: SizeMetric
}

export interface CheckBuildArtifactsOptions {
  baselineDirectory?: string
  log?: (message: string) => void
  summaryPath?: string
}

const REQUIRED_ARTIFACTS: ReadonlyArray<{
  name: string
  matches: (path: string) => boolean
}> = [
  { name: 'indexHtml', matches: (path) => path === 'index.html' },
  { name: 'webManifest', matches: (path) => path === 'manifest.webmanifest' },
  { name: 'shareQr', matches: (path) => path === 'share-qr.svg' },
  { name: 'mainJavaScript', matches: (path) => /^assets\/index-[^/]+\.js$/.test(path) },
  { name: 'mainCss', matches: (path) => /^assets\/index-[^/]+\.css$/.test(path) },
  { name: 'offlineCitySeed', matches: (path) => path === 'data/cities/offline-seed.json' },
  { name: 'robots', matches: (path) => path === 'robots.txt' },
  { name: 'sitemap', matches: (path) => path === 'sitemap.xml' },
]
const MAX_OFFLINE_CITY_SEED_BYTES = 3 * 1024 * 1024

// Хеш фиксирует SVG-код, сгенерированный для официальной ссылки приложения.
const VAQTPRO_SHARE_QR_SHA256 = '3becf6afdf685b1737b83cd049eca14e233500fdef7a8c283416ecfe0046fa03'

const SIZE_METRIC_LABELS = [
  ['mainJavaScript', 'Main JavaScript'],
  ['totalJavaScript', 'Total JavaScript'],
  ['totalCss', 'Total CSS'],
] as const satisfies ReadonlyArray<readonly [keyof BuildSizeReport, string]>

export function validateBuildArtifacts(artifacts: readonly BuildArtifact[]): string[] {
  const errors: string[] = []

  for (const { name, matches } of REQUIRED_ARTIFACTS) {
    const matchesForCategory = artifacts.filter((artifact) => matches(artifact.path))
    if (matchesForCategory.length === 0) {
      errors.push(`${name}: artifact не найден`)
    } else if (matchesForCategory.length > 1) {
      errors.push(`${name}: найдено ${matchesForCategory.length} artifacts`)
    }
  }
  if (artifacts.some(({ path }) => /prayer-times-(?:current|manifest)\.json$/i.test(path))) {
    errors.push('prayerData: obsolete timetable artifacts must not be bundled')
  }
  for (const { path } of artifacts) {
    if (/^prayer-times\//.test(path)) {
      errors.push(`seo: cancelled SEO city page artifact ${path}`)
    } else if (path === 'prayer-times-theme.css') {
      errors.push(`seo: cancelled SEO city theme artifact ${path}`)
    } else if (path === '404.html') {
      errors.push(`seo: cancelled SEO-specific 404 artifact ${path}`)
    }
  }

  const cityArtifacts = artifacts.filter((artifact) => artifact.path.startsWith('data/cities/'))
  if (artifacts.some((artifact) => artifact.path === 'data/cities-current.json')) {
    errors.push('cities: старый монолит недопустим')
  }
  for (const artifact of cityArtifacts) {
    if (artifact.path !== 'data/cities/offline-seed.json') {
      errors.push(`cities: лишний artifact ${artifact.path}`)
    }
    if (artifact.path === 'data/cities/offline-seed.json' && artifact.size > MAX_OFFLINE_CITY_SEED_BYTES) {
      errors.push(`cities: офлайн-набор превышает ${MAX_OFFLINE_CITY_SEED_BYTES} байт`)
    }
  }
  return errors
}

async function validateApplicationIdentity(
  distDirectory: string,
  artifacts: readonly BuildArtifact[],
): Promise<string[]> {
  const errors: string[] = []
  if (artifacts.some((artifact) => artifact.path === 'index.html')) {
    const html = await readFile(join(distDirectory, 'index.html'), 'utf8')
    const titles = [...html.matchAll(/<title>([\s\S]*?)<\/title>/gi)]
    if (titles.length !== 1 || titles[0]?.[1] !== 'Время намаза — расписание молитв | VaqtPro') {
      errors.push('seo: initial HTML must contain exactly one approved homepage title')
    }
    if (!/<meta\s+name="apple-mobile-web-app-title"\s+content="VaqtPro"\s*\/>/i.test(html)) {
      errors.push('appleTitle: index.html не содержит название VaqtPro')
    }
    const descriptions = [...html.matchAll(/<meta\s+name="description"\s+content="([^"]*)"\s*\/?>/gi)]
    if (descriptions.length !== 1 || descriptions[0]?.[1] !== 'Время намаза для выбранного города или геолокации. Расписание молитв на день и месяц, настройки расчёта и работа без интернета.') {
      errors.push('seo: initial HTML must preserve exactly one accurate title and description')
    }
    const keywordTags = [...html.matchAll(/<meta\s+name="keywords"\s+content="([^"]*)"\s*\/?\s*>/gi)]
    const approvedKeywords = 'время намаза, времена намаза, расписание намаза, время намаза сегодня, расписание молитв, время молитвы, время намаза на месяц, время намаза по городам, время намаза по геолокации, время намаза без интернета, приложение время намаза, VaqtPro'
    if (keywordTags.length !== 1 || keywordTags[0]?.[1] !== approvedKeywords) {
      errors.push('seo: initial HTML must contain exactly one approved concise keywords tag')
    }
    const canonicalLinks = [...html.matchAll(/<link\b[^>]*\brel="canonical"[^>]*>/gi)]
    const hasHomepageCanonical = canonicalLinks.length === 1
      && /\bhref="https:\/\/vaqt\.pro\/"/.test(canonicalLinks[0]?.[0] ?? '')
    if (!hasHomepageCanonical) {
      errors.push('seo: initial HTML must contain exactly one static homepage canonical')
    }
    if (!/<html\b[^>]*\blang="ru"/i.test(html)) {
      errors.push('seo: homepage HTML language must remain Russian')
    }
  }

  if (!artifacts.some((artifact) => artifact.path === 'manifest.webmanifest')) return errors
  try {
    const input: unknown = JSON.parse(await readFile(join(distDirectory, 'manifest.webmanifest'), 'utf8'))
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('manifest.webmanifest должен содержать объект')
    }
    const manifest = input as Record<string, unknown>
    if (manifest.name !== 'VaqtPro — времена намаза' || manifest.short_name !== 'VaqtPro') {
      errors.push('webManifest: имя приложения должно быть VaqtPro')
    }
    for (const field of ['id', 'start_url', 'scope'] as const) {
      if (typeof manifest[field] !== 'string') {
        errors.push(`webManifest: ${field} должен указывать на корень сайта`)
        continue
      }
      const url = new URL(manifest[field], 'https://vaqt.pro/')
      if (url.origin !== 'https://vaqt.pro' || url.pathname !== '/') {
        errors.push(`webManifest: ${field} должен указывать на корень сайта`)
      }
    }
    if (manifest.display !== 'standalone') {
      errors.push('webManifest: display должен оставаться standalone')
    }
  } catch (error) {
    errors.push(`webManifest: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (artifacts.some((artifact) => artifact.path === 'share-qr.svg')) {
    const qrCode = await readFile(join(distDirectory, 'share-qr.svg'))
    const checksum = createHash('sha256').update(qrCode).digest('hex')
    if (checksum !== VAQTPRO_SHARE_QR_SHA256) {
      errors.push('shareQr: QR-код не соответствует проверенной ссылке https://vaqt.pro/')
    }
  }
  return errors
}

async function validateHomepageCrawlerFiles(distDirectory: string): Promise<string[]> {
  const errors: string[] = []
  try {
    const robots = await readFile(join(distDirectory, 'robots.txt'), 'utf8')
    if (robots !== 'User-agent: *\nAllow: /\nSitemap: https://vaqt.pro/sitemap.xml\n') {
      errors.push('seo: robots.txt must allow public crawling and reference the sitemap')
    }
  } catch {
    errors.push('seo: robots.txt is missing or unreadable')
  }

  try {
    const sitemap = await readFile(join(distDirectory, 'sitemap.xml'), 'utf8')
    const homepageOnlySitemap = /^\s*(?:<\?xml version="1\.0" encoding="UTF-8"\?>\s*)?<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"><url><loc>https:\/\/vaqt\.pro\/<\/loc><\/url><\/urlset>\s*$/.test(sitemap)
    if (!homepageOnlySitemap || /<lastmod\b/i.test(sitemap)) {
      errors.push('seo: sitemap.xml must contain exactly the homepage URL and no lastmod')
    }
  } catch {
    errors.push('seo: sitemap.xml is missing or unreadable')
  }
  return errors
}

async function collectBuildArtifacts(root: string, directory = root): Promise<BuildArtifact[]> {
  const artifacts: BuildArtifact[] = []
  const entries = await readdir(directory, { withFileTypes: true })

  for (const entry of entries) {
    const absolutePath = join(directory, entry.name)
    if (entry.isDirectory()) {
      artifacts.push(...await collectBuildArtifacts(root, absolutePath))
    } else if (entry.isFile()) {
      const metadata = await stat(absolutePath)
      artifacts.push({
        path: relative(root, absolutePath).split(sep).join('/'),
        size: metadata.size,
      })
    }
  }

  return artifacts
}

async function validateCityArtifacts(
  distDirectory: string,
  artifacts: readonly BuildArtifact[],
): Promise<string[]> {
  const errors: string[] = []
  const seedArtifact = artifacts.find((artifact) => artifact.path === 'data/cities/offline-seed.json')
  if (seedArtifact) {
    try {
      parseOfflineCitySeed(JSON.parse(await readFile(join(distDirectory, 'data/cities/offline-seed.json'), 'utf8')) as unknown)
      if (seedArtifact.size > MAX_OFFLINE_CITY_SEED_BYTES) throw new Error('Офлайн-набор превышает 3 МиБ')
      const worker = await readFile(join(distDirectory, 'sw.js'), 'utf8')
      if (!worker.includes('data/cities/offline-seed.json') || /(?:api|secure)\.geonames\.org|geocoding-api\.open-meteo\.com/.test(worker)) {
        throw new Error('Service Worker должен кэшировать только компактный офлайн-набор, без ответов API')
      }
    } catch (error) {
      errors.push(`cities: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return errors
}

function isJavaScript(path: string): boolean {
  return /\.(?:js|mjs|cjs)$/.test(path)
}

function isCss(path: string): boolean {
  return path.endsWith('.css')
}

async function measureBuildSizes(directory: string, artifacts: readonly BuildArtifact[]): Promise<BuildSizeReport> {
  const javaScript = artifacts.filter((artifact) => isJavaScript(artifact.path))
  const css = artifacts.filter((artifact) => isCss(artifact.path))
  const main = javaScript.filter((artifact) => /^assets\/index-[^/]+\.js$/.test(artifact.path))
  const mainCss = css.filter((artifact) => /^assets\/index-[^/]+\.css$/.test(artifact.path))
  if (main.length !== 1 || mainCss.length !== 1) {
    throw new Error('Невозможно определить единственные main JavaScript и CSS bundles')
  }

  const gzipByPath = new Map<string, number>()
  for (const artifact of [...javaScript, ...css]) {
    if (gzipByPath.has(artifact.path)) continue
    gzipByPath.set(artifact.path, gzipSync(await readFile(join(directory, artifact.path))).byteLength)
  }

  const measure = (files: readonly BuildArtifact[]): SizeMetric => ({
    rawBytes: files.reduce((total, file) => total + file.size, 0),
    gzipBytes: files.reduce((total, file) => total + (gzipByPath.get(file.path) ?? 0), 0),
  })

  return {
    mainJavaScript: measure(main),
    totalJavaScript: measure(javaScript),
    totalCss: measure(css),
  }
}

function formatBytes(bytes: number): string {
  return `${bytes.toLocaleString('en-US')} bytes`
}

function formatDelta(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${Math.abs(value).toLocaleString('en-US')} bytes`
}

function increasedGzipMetrics(current: BuildSizeReport, baseline: BuildSizeReport): string[] {
  return SIZE_METRIC_LABELS.flatMap(([key, label]) => {
    const increase = current[key].gzipBytes - baseline[key].gzipBytes
    return increase > 0 ? [`${label} +${formatBytes(increase)}`] : []
  })
}

function createSizeReportText(current: BuildSizeReport, baseline?: BuildSizeReport): string {
  const rows = SIZE_METRIC_LABELS.map(([key, label]) => {
    const size = current[key]
    const deltas = baseline
      ? `; Δ vs PR base ${formatDelta(size.rawBytes - baseline[key].rawBytes)} raw, ${formatDelta(size.gzipBytes - baseline[key].gzipBytes)} gzip`
      : ''
    return `${label}: ${formatBytes(size.rawBytes)} raw, ${formatBytes(size.gzipBytes)} gzip${deltas}`
  })
  const baselineLine = baseline
    ? 'Comparison baseline: PR base production build.'
    : 'Comparison baseline unavailable; absolute sizes only.'
  return `Production asset sizes (informational):\n${rows.join('\n')}\n${baselineLine}`
}

function createSummaryMarkdown(current: BuildSizeReport, baseline?: BuildSizeReport): string {
  const header = baseline
    ? '| Metric | Raw | gzip | Δ raw vs PR base | Δ gzip vs PR base |\n| --- | ---: | ---: | ---: | ---: |'
    : '| Metric | Raw | gzip |\n| --- | ---: | ---: |'
  const rows = SIZE_METRIC_LABELS.map(([key, label]) => {
    const size = current[key]
    return baseline
      ? `| ${label} | ${formatBytes(size.rawBytes)} | ${formatBytes(size.gzipBytes)} | ${formatDelta(size.rawBytes - baseline[key].rawBytes)} | ${formatDelta(size.gzipBytes - baseline[key].gzipBytes)} |`
      : `| ${label} | ${formatBytes(size.rawBytes)} | ${formatBytes(size.gzipBytes)} |`
  })
  const baselineNote = baseline
    ? 'Compared with a production build from the PR base using the same Node version and dependency lockfile.'
    : 'A reliable PR base build was unavailable; absolute sizes are shown.'
  return `## Production asset sizes\n\n${baselineNote}\n\n${header}\n${rows.join('\n')}\n\nGzip size is summed across individual emitted JavaScript/CSS files. Any gzip increase is highlighted in the workflow log; no size threshold affects CI.`
}

async function writeStepSummary(path: string | undefined, markdown: string, log: (message: string) => void): Promise<void> {
  if (!path) return
  try {
    await appendFile(path, `${markdown}\n\n`)
  } catch (error) {
    log(`::warning::Could not write production asset summary: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function reportBuildSizes(
  distDirectory: string,
  artifacts: readonly BuildArtifact[],
  options: CheckBuildArtifactsOptions,
): Promise<void> {
  const log = options.log ?? console.log
  const current = await measureBuildSizes(distDirectory, artifacts)
  let baseline: BuildSizeReport | undefined

  if (options.baselineDirectory) {
    try {
      baseline = await measureBuildSizes(
        options.baselineDirectory,
        await collectBuildArtifacts(options.baselineDirectory),
      )
    } catch (error) {
      log(`::notice::PR base size comparison unavailable: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  log(createSizeReportText(current, baseline))
  if (baseline) {
    const increases = increasedGzipMetrics(current, baseline)
    if (increases.length > 0) {
      log(`::warning title=Production asset size increased::${increases.join('; ')} gzip vs PR base. This is informational and does not fail CI.`)
    }
  }
  await writeStepSummary(
    options.summaryPath ?? process.env.GITHUB_STEP_SUMMARY,
    createSummaryMarkdown(current, baseline),
    log,
  )
}

export async function checkBuildArtifacts(
  distDirectory: string,
  options: CheckBuildArtifactsOptions = {},
): Promise<void> {
  const artifacts = await collectBuildArtifacts(distDirectory)
  const errors = [
    ...validateBuildArtifacts(artifacts),
    ...await validateApplicationIdentity(distDirectory, artifacts),
    ...await validateHomepageCrawlerFiles(distDirectory),
    ...await validateCityArtifacts(distDirectory, artifacts),
  ]

  if (errors.length > 0) {
    throw new Error(`Нарушена целостность production-артефактов:\n${errors.join('\n')}`)
  }

  await reportBuildSizes(distDirectory, artifacts, options)
}

export function reportBuildArtifactFailure(error: unknown): void {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}

const entryPoint = process.argv[1]
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  void checkBuildArtifacts(resolve('dist'), {
    baselineDirectory: process.env.BUILD_SIZE_BASELINE_DIR || undefined,
  }).catch(reportBuildArtifactFailure)
}
