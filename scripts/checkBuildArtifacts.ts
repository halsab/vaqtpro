import { createHash } from 'node:crypto'
import { appendFile, readFile, readdir, stat } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

import { validateCityIndex, parseCityShard } from '../src/domain/citySchema'
import { createSearchFilter, type CityIndex } from '../src/domain/cityIndex'
import { localCivilMonth } from '../src/domain/civilMonth'
import { SEO_CITY_CANDIDATES, SEO_PUBLICATION_APPROVAL } from './seo/cities'

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
  expectedSeoCityIds?: readonly number[]
  referenceInstant?: string
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
  { name: 'cityIndex', matches: (path) => path === 'data/cities/index.json' },
  { name: 'notFoundPage', matches: (path) => path === '404.html' },
  { name: 'robots', matches: (path) => path === 'robots.txt' },
  { name: 'sitemap', matches: (path) => path === 'sitemap.xml' },
  { name: 'prayerTimesThemeCss', matches: (path) => path === 'prayer-times-theme.css' },
]

// Хеш фиксирует SVG-код, сгенерированный для официальной ссылки приложения.
const VAQTPRO_SHARE_QR_SHA256 = '3becf6afdf685b1737b83cd049eca14e233500fdef7a8c283416ecfe0046fa03'

const SIZE_METRIC_LABELS = [
  ['mainJavaScript', 'Main JavaScript'],
  ['totalJavaScript', 'Total JavaScript'],
  ['totalCss', 'Total CSS'],
] as const satisfies ReadonlyArray<readonly [keyof BuildSizeReport, string]>

export function validateBuildArtifacts(
  artifacts: readonly BuildArtifact[],
  catalog?: Pick<CityIndex, 'version' | 'shards'>,
): string[] {
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

  const cityArtifacts = artifacts.filter((artifact) => artifact.path.startsWith('data/cities/'))
  if (artifacts.some((artifact) => artifact.path === 'data/cities-current.json')) {
    errors.push('cities: старый монолит недопустим')
  }

  const expectedCityArtifacts = new Set([
    'data/cities/index.json',
    ...(catalog?.shards.map((shard) => `data/cities/${catalog.version}/${shard.id}.json`) ?? []),
  ])
  for (const artifact of cityArtifacts) {
    if (!expectedCityArtifacts.has(artifact.path)) {
      errors.push(`cities: лишний artifact ${artifact.path}`)
    }
  }
  for (const path of expectedCityArtifacts) {
    const count = artifacts.filter((artifact) => artifact.path === path).length
    if (count === 0) errors.push(`cities: отсутствует ${path}`)
    if (count > 1) errors.push(`cities: повторный artifact ${path}`)
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
    if (!/<title>VaqtPro — времена намаза<\/title>/i.test(html)) {
      errors.push('appTitle: index.html не содержит название VaqtPro')
    }
    if (!/<meta\s+name="apple-mobile-web-app-title"\s+content="VaqtPro"\s*\/>/i.test(html)) {
      errors.push('appleTitle: index.html не содержит название VaqtPro')
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
): Promise<{ catalog?: CityIndex; errors: string[] }> {
  const errors: string[] = []
  let catalog: CityIndex | undefined

  if (artifacts.some((artifact) => artifact.path === 'data/cities/index.json')) {
    try {
      catalog = await validateCityIndex(JSON.parse(
        await readFile(join(distDirectory, 'data/cities/index.json'), 'utf8'),
      ) as unknown)
      const ids = new Set<number>()
      for (const descriptor of catalog.shards) {
        const shard = await parseCityShard(
          await readFile(join(distDirectory, `data/cities/${catalog.version}/${descriptor.id}.json`), 'utf8'),
          catalog,
          descriptor,
        )
        if (createSearchFilter(shard.cities) !== descriptor.filter) {
          throw new Error(`Повреждён поисковый индекс ${descriptor.id}`)
        }
        for (const city of shard.cities) {
          if (ids.has(city[0])) throw new Error(`Повторный GeoNames ID ${city[0]}`)
          ids.add(city[0])
          const overview = catalog.overview.find((candidate) => candidate[0] === city[0])
          if (overview && JSON.stringify(overview) !== JSON.stringify(city)) {
            throw new Error(`Обзор расходится с пакетом для ${city[0]}`)
          }
        }
      }
      if (catalog.overview.some((city) => !ids.has(city[0]))) {
        throw new Error('Обзор содержит отсутствующий город')
      }
    } catch (error) {
      errors.push(`cities: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return { catalog, errors }
}

async function validateSeoArtifacts(
  distDirectory: string,
  artifacts: readonly BuildArtifact[],
  expectedSeoCityIds?: readonly number[],
  referenceInstantValue?: string,
): Promise<string[]> {
  const errors: string[] = []
  const expectedCityIds = expectedSeoCityIds ?? SEO_PUBLICATION_APPROVAL.approvedCityIds.filter(id => {
    const candidate = SEO_CITY_CANDIDATES.find(city => city.id === id)
    return Boolean(candidate?.ownerApproved && candidate.demandEvidence.length > 0
      && candidate.demandEvidence.every(evidence => evidence.verification === 'verified'))
  })
  const expectedRoutes = expectedCityIds.map(id => {
      const candidate = SEO_CITY_CANDIDATES.find(city => city.id === id)
      return candidate ? `/prayer-times/${candidate.countryCode.toLowerCase()}/${candidate.slug}-${candidate.id}/` : ''
    })

  try {
    const robots = await readFile(join(distDirectory, 'robots.txt'), 'utf8')
    if (!robots.includes('User-agent: *\nAllow: /') || !robots.includes(`Sitemap: https://vaqt.pro/sitemap.xml`)) {
      errors.push('seo: robots.txt должен разрешать публикацию и указывать абсолютный sitemap')
    }

    const sitemapXml = await readFile(join(distDirectory, 'sitemap.xml'), 'utf8')
    const sitemapRoutes = [...sitemapXml.matchAll(/<loc>https:\/\/vaqt\.pro(\/[^<]*)<\/loc>/g)].map(match => match[1] ?? '')
    if (sitemapRoutes.length !== new Set(sitemapRoutes).size) errors.push('seo: sitemap.xml содержит повторные URL')
    if (sitemapRoutes.some(route => !/^\/prayer-times\/[a-z]{2}\/[a-z0-9-]+-\d+\/$/.test(route))) {
      errors.push('seo: sitemap.xml содержит URL вне утверждённого маршрута')
    }
    if ([...sitemapXml.matchAll(/<loc>/g)].length !== sitemapRoutes.length) {
      errors.push('seo: sitemap.xml содержит некорректный или посторонний URL')
    }
    if ([...sitemapRoutes].sort().join('\n') !== [...expectedRoutes].sort().join('\n')) {
      errors.push('seo: sitemap.xml не соответствует фактически одобренным страницам')
    }

    const actualPagePaths = artifacts
      .map(artifact => artifact.path)
      .filter(path => /^prayer-times\/(?:.+\/)?index\.html$/.test(path))
      .map(path => `/${path.slice(0, -'index.html'.length)}`)
      .sort()
    if (actualPagePaths.join('\n') !== [...expectedRoutes].sort().join('\n')) {
      errors.push('seo: сгенерированные страницы не соответствуют публикационному manifest')
    }

    const themeCss = await readFile(join(distDirectory, 'prayer-times-theme.css'), 'utf8')
    if (!themeCss.includes('--background-secondary') || !themeCss.includes('--text-primary')
      || !themeCss.includes('prefers-color-scheme:dark')) {
      errors.push('seo: сезонные токены статической страницы должны использовать палитры приложения')
    }

    const notFound = await readFile(join(distDirectory, '404.html'), 'utf8')
    if (!/<html lang="ru"(?:\s[^>]*)?>/.test(notFound) || !/<h1\b[^>]*>Страница не найдена<\/h1>/.test(notFound)
      || !/<meta name="referrer" content="no-referrer">/.test(notFound)
      || !/<meta name="robots" content="noindex">/.test(notFound)
      || /<script\b|\son[a-z]+=/i.test(notFound)) {
      errors.push('seo: 404.html должен быть русской статической страницей без скриптов')
    }

    const referenceValue = referenceInstantValue ?? process.env.SEO_REFERENCE_INSTANT
    const referenceInstant = referenceValue ? new Date(referenceValue) : undefined
    if (expectedCityIds.length > 0 && (!referenceInstant || !Number.isFinite(referenceInstant.getTime()))) {
      errors.push('seo: отсутствует корректный SEO_REFERENCE_INSTANT для проверки календарного месяца')
    }
    for (const route of expectedRoutes) {
      const idMatch = /-(\d+)\/$/.exec(route)
      const id = Number(idMatch?.[1])
      const candidate = SEO_CITY_CANDIDATES.find(city => city.id === id)
      if (!candidate) continue
      const html = await readFile(join(distDirectory, route.slice(1), 'index.html'), 'utf8')
      const canonical = `https://vaqt.pro${route}`
      const headHasPolicy = /<html lang="ru" data-theme="seasonal" data-season="(?:winter|spring|summer|autumn)">/.test(html)
        && /<meta name="referrer" content="no-referrer">/.test(html)
        && /<meta http-equiv="Content-Security-Policy" content="[^"]*script-src 'none';/.test(html)
      if (!/<html lang="ru" data-theme="seasonal" data-season="(?:winter|spring|summer|autumn)">/.test(html) || !headHasPolicy
        || !new RegExp(`<link rel="canonical" href="${canonical}">`).test(html)
        || (html.match(/<h1\b/g) ?? []).length !== 1
        || /<script\b|\son[a-z]+=|static\.cloudflareinsights\.com|googletagmanager|google-analytics|metrika\.yandex/i.test(html)) {
        errors.push(`seo: страница ${route} нарушает статический HTML, canonical, CSP или privacy contract`)
      }
      if (!/<table class="prayer-month-table">/.test(html) || !/<caption>Расписание намаза за месяц<\/caption>/.test(html)
        || !/href="\/assets\/index-[^"]+\.css"/.test(html) || !/href="\/prayer-times-theme\.css"/.test(html)) {
        errors.push(`seo: страница ${route} не содержит семантическую таблицу расписания`)
      }
      const rows = [...html.matchAll(/<tr><th scope="row"><time datetime="(\d{4}-\d{2}-\d{2})">(\d{2}\.\d{2}\.\d{4})<\/time><\/th>([\s\S]*?)<\/tr>/g)]
      const rowDates = rows.map(match => match[1] ?? '')
      const displayedDates = rows.map(match => match[2] ?? '')
      const expectedDates = referenceInstant ? localCivilMonth(referenceInstant, candidate.timeZone) : []
      const expectedLabels = expectedDates.map(date => `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`)
      if (rowDates.length === 0 || new Set(rowDates).size !== rowDates.length
        || rowDates.join('\n') !== expectedDates.join('\n')
        || displayedDates.join('\n') !== expectedLabels.join('\n')) {
        errors.push(`seo: страница ${route} должна содержать каждую дату текущего местного календарного месяца в формате ДД.ММ.ГГГГ`)
      }
      for (const row of rows) {
        const cells = row[3] ?? ''
        if ((cells.match(/<td>/g) ?? []).length !== 6 || (cells.match(/<time datetime=/g) ?? []).length !== 6
          || /<a\b|<button\b/.test(row[0])) {
          errors.push(`seo: строка даты ${route} должна содержать дату и шесть неинтерактивных времён`)
          break
        }
      }
      if (!/<details class="prayer-month-method">/.test(html) || /<details class="prayer-month-method"[^>]*\bopen(?:\s|>)/.test(html)
        || html.includes('≈')) errors.push(`seo: страница ${route} должна кратко показывать и сворачивать методику без символа ≈`)
    }

    const serviceWorker = await readFile(join(distDirectory, 'sw.js'), 'utf8')
    if (!serviceWorker.includes('prayer-times')) errors.push('seo: service worker должен исключать маршруты расписаний из navigation fallback')
    if (expectedCityIds.some(id => serviceWorker.includes(`/${id}/`))) {
      errors.push('seo: сгенерированные страницы городов не должны входить в precache service worker')
    }
  } catch (error) {
    errors.push(`seo: ${error instanceof Error ? error.message : String(error)}`)
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
  const city = await validateCityArtifacts(distDirectory, artifacts)
  const errors = [
    ...validateBuildArtifacts(artifacts, city.catalog),
    ...await validateApplicationIdentity(distDirectory, artifacts),
    ...await validateSeoArtifacts(distDirectory, artifacts, options.expectedSeoCityIds, options.referenceInstant),
    ...city.errors,
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
