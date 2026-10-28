import { appendFile, readFile, readdir, mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { localCivilMonth } from '../src/domain/civilMonth'
import { materializeCity, type City, type CompactCityRecord } from '../src/domain/cities'
import { createCityPlace } from '../src/domain/place'
import { calculatePrayerSchedule, getCalculationProfileCapability, type CalculationProfileId } from '../src/domain/prayerCalculation'
import { resolvePrayerTimeSource } from '../src/domain/prayerSource'
import { getCivilDate, type CivilDate } from '../src/domain/locationTime'
import { parseCityShard, validateCityIndex } from '../src/domain/citySchema'
import type { CityIndex } from '../src/domain/cityIndex'
import type { PrayerSchedule } from '../src/domain/scheduleEvents'
import { verifiedTatarstanLocalityId } from '../src/domain/tatarstanDhuhr'
import { PrayerMonthTable, PRAYER_MONTH_KEYS } from '../src/features/schedule/PrayerMonthTable'
import { PrayerMonthView } from '../src/features/schedule/PrayerMonthView'
import { themePalettes, type ThemePalette } from '../src/ui/themePalette'
import { SEO_CITY_CANDIDATES, SEO_PUBLICATION_APPROVAL, type SeoCityCandidate } from './seo/cities'

const SITE_ORIGIN = 'https://vaqt.pro'
const SEO_GENERATOR_VERSION = '1'
const CITY_ROUTE_PREFIX = '/prayer-times/'
const SEASONS = ['winter', 'spring', 'summer', 'autumn'] as const

const PROFILE_LABELS: Record<CalculationProfileId, string> = {
  tatarstan: 'Татарстан',
  russia: 'Россия',
  turkey: 'Турция · Diyanet',
  muslimWorldLeague: 'Всемирная мусульманская лига (MWL)',
  karachi: 'Карачи',
  northAmerica: 'Исламское общество Северной Америки',
  ummAlQura: 'Умм аль-Кура',
  canadaFcna: 'Канада · FCNA',
  dubai: 'Дубай',
  qatar: 'Катар',
  kuwait: 'Кувейт',
  egyptian: 'Египет',
}

const HIGH_LATITUDE_LABELS = {
  tatarstan: 'Расчётный резерв · 120/90 мин',
  seventhOfNight: '1/7 ночи',
  twilightAngle: 'Доля ночи по углу',
  nearestDay: 'Ближайший день',
} as const

const ASR_METHOD_LABELS = {
  hanafi: 'Ханафитский',
  standard: 'Шафиитский, маликитский и ханбалитский',
} as const

export interface BuildSeoPagesOptions {
  distDirectory?: string
  publicDirectory?: string
  referenceInstant?: string
  previewCandidates?: boolean
  requirePublishedPages?: boolean
}

export interface ValidatedCity {
  candidate: SeoCityCandidate
  city: City
  place: ReturnType<typeof createCityPlace>
  profile: ReturnType<typeof resolvePrayerTimeSource>
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character)
}

function assertManifestShape(): void {
  if (SEO_CITY_CANDIDATES.length < 10 || SEO_CITY_CANDIDATES.length > 20) {
    throw new Error('SEO-кандидатов должно быть от 10 до 20')
  }
  const ids = new Set<number>()
  const routes = new Set<string>()
  for (const candidate of SEO_CITY_CANDIDATES) {
    const route = cityRoute(candidate)
    if (ids.has(candidate.id)) throw new Error(`Повторный GeoNames ID ${candidate.id}`)
    if (routes.has(route)) throw new Error(`Повторный SEO-маршрут ${route}`)
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate.slug)) throw new Error(`Некорректный slug: ${candidate.slug}`)
    if (!/^[A-Z]{2}$/.test(candidate.countryCode) || !Number.isSafeInteger(candidate.id) || candidate.id < 1) {
      throw new Error(`Некорректная идентичность города ${candidate.name}`)
    }
    if (!candidate.demandEvidence.length || candidate.demandEvidence.some(evidence => evidence.verification !== 'verified')) {
      if (SEO_PUBLICATION_APPROVAL.approvedCityIds.includes(candidate.id)) {
        throw new Error(`Город ${candidate.id} одобрен, но его спрос не подтверждён`)
      }
    }
    ids.add(candidate.id)
    routes.add(route)
  }
  for (const id of SEO_PUBLICATION_APPROVAL.approvedCityIds) {
    if (!ids.has(id)) throw new Error(`В публикации указан неизвестный GeoNames ID ${id}`)
    const candidate = SEO_CITY_CANDIDATES.find(city => city.id === id)
    if (!candidate?.ownerApproved) throw new Error(`Для города ${id} нет подтверждения владельца`)
  }
}

function cityRoute(candidate: SeoCityCandidate): string {
  return `${CITY_ROUTE_PREFIX}${candidate.countryCode.toLowerCase()}/${candidate.slug}-${candidate.id}/`
}

async function loadCandidateRecords(publicDirectory: string): Promise<{ index: CityIndex; records: Map<number, CompactCityRecord> }> {
  assertManifestShape()
  const indexValue: unknown = JSON.parse(await readFile(join(publicDirectory, 'data/cities/index.json'), 'utf8'))
  const index = await validateCityIndex(indexValue)
  if (index.source.name !== 'GeoNames' || index.source.license !== 'CC BY 4.0') {
    throw new Error('Источником каталога городов должен оставаться GeoNames CC BY 4.0')
  }

  const candidatesByCountry = new Map<string, Set<number>>()
  for (const candidate of SEO_CITY_CANDIDATES) {
    const ids = candidatesByCountry.get(candidate.countryCode) ?? new Set<number>()
    ids.add(candidate.id)
    candidatesByCountry.set(candidate.countryCode, ids)
  }

  const records = new Map<number, CompactCityRecord>()
  for (const [countryCode, candidateIds] of candidatesByCountry) {
    const descriptors = index.shards.filter(shard => shard.country === countryCode)
    for (const descriptor of descriptors) {
      const text = await readFile(join(publicDirectory, `data/cities/${index.version}/${descriptor.id}.json`), 'utf8')
      const shard = await parseCityShard(text, index, descriptor)
      for (const record of shard.cities) {
        if (candidateIds.has(record[0])) records.set(record[0], record)
      }
    }
  }

  for (const candidate of SEO_CITY_CANDIDATES) {
    const record = records.get(candidate.id)
    if (!record) throw new Error(`GeoNames ID ${candidate.id} отсутствует в каталоге`)
    const actual = [record[1], record[3], record[4], record[5], record[6], record[8], record[9]]
    const expected = [candidate.name, candidate.countryCode, candidate.admin1Code, candidate.latitude,
      candidate.longitude, candidate.timeZone, candidate.admin1Name]
    if (actual.some((value, index) => value !== expected[index])) {
      throw new Error(`Справочник GeoNames изменился для ${candidate.id}: ${JSON.stringify({ expected, actual })}`)
    }
    if (candidate.demandEvidence.some(evidence => !/^https:\/\//.test(evidence.sourceUrl))) {
      throw new Error(`Некорректный URL источника спроса для ${candidate.id}`)
    }
  }
  return { index, records }
}

function resolveCityCandidates(records: ReadonlyMap<number, CompactCityRecord>): ValidatedCity[] {
  return SEO_CITY_CANDIDATES.map(candidate => {
    const record = records.get(candidate.id)
    if (!record) throw new Error(`Внутренняя ошибка проверки города ${candidate.id}`)
    const city = materializeCity(record)
    const place = createCityPlace(city, 0)
    const profile = resolvePrayerTimeSource(place, { mode: 'automatic' })
    if (profile.status !== 'ready') throw new Error(`Автоматический профиль ${profile.settings.profile} недоступен для ${candidate.id}`)
    const capability = getCalculationProfileCapability(profile.settings.profile)
    if (!capability.supported) throw new Error(`Профиль ${profile.settings.profile} не поддерживается для ${candidate.id}`)
    return { candidate, city, place, profile }
  })
}

export async function validateCityCandidates(publicDirectory = resolve('public')): Promise<ValidatedCity[]> {
  const { records } = await loadCandidateRecords(publicDirectory)
  return resolveCityCandidates(records)
}

function parseReferenceInstant(value: string | undefined): Date {
  if (!value) throw new Error('Для генерации расписания требуется SEO_REFERENCE_INSTANT в формате ISO 8601')
  const instant = new Date(value)
  if (!Number.isFinite(instant.getTime()) || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new Error(`Некорректное SEO_REFERENCE_INSTANT: ${value}`)
  }
  return instant
}

export const localCalendarMonth = localCivilMonth

function formatDate(date: string): string {
  const [year, month, day] = date.split('-')
  if (!year || !month || !day) throw new Error(`Некорректная гражданская дата: ${date}`)
  return `${day}.${month}.${year}`
}

const PRAYER_LABELS = {
  fajr: 'Фаджр', sunrise: 'Восход', dhuhr: 'Зухр', asr: 'Аср', maghrib: 'Магриб', isha: 'Иша',
} satisfies Record<(typeof PRAYER_MONTH_KEYS)[number], string>

function citySchedules(city: City, dates: readonly CivilDate[], settings: ReturnType<typeof resolvePrayerTimeSource>['settings']): PrayerSchedule[] {
  const place = createCityPlace(city, 0)
  const localityId = verifiedTatarstanLocalityId(place)
  const location = { id: place.id, latitude: place.latitude, longitude: place.longitude, ...(localityId ? { localityId } : {}) }
  if (dates.length === 0) throw new Error('Пустой диапазон дат расписания')
  return dates.map(date => calculatePrayerSchedule(location, date, city.timeZone, settings))
}

function seasonForDate(date: string): (typeof SEASONS)[number] {
  const month = Number(date.slice(5, 7))
  if (month === 12 || month <= 2) return 'winter'
  if (month <= 5) return 'spring'
  if (month <= 8) return 'summer'
  return 'autumn'
}

function paletteRule(season: (typeof SEASONS)[number], tone: 'light' | 'dark', palette: ThemePalette, opacity: number): string {
  const variables = {
    '--background-primary': palette.backgroundPrimary,
    '--app-shell-background': 'var(--background-primary)',
    '--background-secondary': palette.backgroundSecondary,
    '--background-tertiary': palette.backgroundTertiary,
    '--text-primary': palette.textPrimary,
    '--text-secondary': palette.textSecondary,
    '--accent-countdown': palette.accentCountdown,
    '--seasonal-pattern-opacity': String(opacity),
    'color-scheme': tone,
  }
  const declarations = Object.entries(variables).map(([name, value]) => `${name}:${value}`).join(';')
  return `:root[data-theme="seasonal"][data-season="${season}"]{${declarations}}`
}

function staticThemeStylesheet(): string {
  const light = SEASONS.map(season => paletteRule(season, 'light', themePalettes[`${season}-light`], 0.12)).join('\n')
  const darkOpacity = { winter: 0.225, spring: 0.3, summer: 0.2, autumn: 0.275 } as const
  const dark = SEASONS.map(season => paletteRule(season, 'dark', themePalettes[`${season}-dark`], darkOpacity[season])).join('\n')
  return `${light}\n@media(prefers-color-scheme:dark){${dark}}\n`
}

function sharedHead(title: string, description: string, canonical: string, appStylesheet: string): string {
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; object-src 'none'; script-src 'none'; style-src 'self'; style-src-attr 'none'; img-src 'self'; font-src 'self'; connect-src 'none'; frame-src 'none'; media-src 'none'; form-action 'none';">
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<link rel="stylesheet" href="${escapeHtml(appStylesheet)}">
<link rel="stylesheet" href="/prayer-times-theme.css">
<title>${escapeHtml(title)}</title>`
}

export function renderCityPage(city: City, candidate: SeoCityCandidate, profile: ReturnType<typeof resolvePrayerTimeSource>, dates: readonly CivilDate[], referenceInstant: Date, appStylesheet = '/assets/index.css'): string {
  const route = cityRoute(candidate)
  const canonical = `${SITE_ORIGIN}${route}`
  const asOfDate = getCivilDate(referenceInstant, city.timeZone)
  const dateStart = dates[0] ?? asOfDate
  const dateEnd = dates.at(-1) ?? asOfDate
  const profileLabel = PROFILE_LABELS[profile.settings.profile]
  const season = seasonForDate(asOfDate)
  const asrLabel = ASR_METHOD_LABELS[profile.settings.asrMethod]
  const highLatitudeLabel = HIGH_LATITUDE_LABELS[profile.settings.highLatitudeRule]
  const title = `Время намаза в ${candidate.locativeName}, ${candidate.countryName} | VaqtPro`
  const description = `Независимый расчёт расписания для города ${city.name}: Фаджр, восход, Зухр, Аср, Магриб и Иша с ${formatDate(dateStart)} по ${formatDate(dateEnd)}`
  const monthLabel = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .formatToParts(new Date(`${dateStart}T12:00:00.000Z`)).filter(part => part.type === 'month' || part.type === 'year')
    .map(part => part.value).join(' ')
  const schedules = citySchedules(city, dates, profile.settings)
  const monthView = renderToStaticMarkup(createElement(PrayerMonthView, {
    monthLabel,
    locationLabel: city.name,
    calculationProfileLabel: 'Профиль расчёта',
    profileLabel,
    methodology: createElement(Fragment, null,
      createElement('p', null, 'Время рассчитано VaqtPro для выбранного места и даты. Название профиля обозначает параметры расчёта.'),
      createElement('p', null, `Метод расчёта Асра: ${asrLabel}.`),
      createElement('p', null, `Правило высоких широт: ${highLatitudeLabel}.`),
      profile.settings.profile === 'tatarstan'
        ? createElement('p', null, 'В некоторых населённых пунктах Татарстана для Зухра используется фиксированное местное время. В остальных местах он рассчитывается как 12:00 или через минуту после солнечного зенита — выбирается более позднее время.')
        : null,
    ),
  }, createElement(Fragment, null,
    createElement(PrayerMonthTable, {
      schedules, labels: PRAYER_LABELS, dateLabel: 'Дата', tableLabel: 'Расписание намаза за месяц',
    }),
    createElement('footer', { className: 'prayer-month-method-body' },
      createElement('a', { href: 'https://github.com/batoulapps/adhan-js', rel: 'noreferrer' }, 'Расчётный движок Adhan JS (MIT)'),
      createElement('a', { href: 'https://www.geonames.org/', rel: 'noreferrer' }, 'Источник географических данных: GeoNames'),
      createElement('a', { href: 'https://creativecommons.org/licenses/by/4.0/', rel: 'noreferrer' }, 'Лицензия CC BY 4.0')),
  ))).replaceAll('dateTime=', 'datetime=')
  return `<!doctype html>
<html lang="ru" data-theme="seasonal" data-season="${season}">
<head>${sharedHead(title, description, canonical, appStylesheet)}</head>
<body><main class="seo-app-page"><section class="app-screen">
<header class="screen-top"><a class="pill pill--action" href="/" rel="noreferrer">Открыть приложение VaqtPro</a></header>
<div class="screen-panel"><div class="screen-content"><h1 class="sr-only">Время намаза в ${escapeHtml(candidate.locativeName)}</h1>${monthView}</div></div>
</section></main></body></html>`
}

function notFoundPage(appStylesheet: string): string {
  const season = seasonForDate(getCivilDate(new Date(), 'Europe/Moscow'))
  const head = sharedHead('Страница не найдена | VaqtPro', 'Страница не найдена.', '', appStylesheet)
    .replace('<link rel="canonical" href="">\n', '<meta name="robots" content="noindex">\n')
  return `<!doctype html><html lang="ru" data-theme="seasonal" data-season="${season}"><head>${head}</head>
<body><main class="seo-app-page"><section class="app-screen"><header class="screen-top"><a class="pill pill--action" href="/" rel="noreferrer">Открыть приложение VaqtPro</a></header>
<div class="screen-panel"><div class="screen-content"><div class="screen-stack">
<h1 class="screen-title">Страница не найдена</h1><p class="screen-copy">Возможно, адрес изменился или страница больше не существует.</p>
</div></div></div></section></main></body></html>`
}

function sitemap(routes: readonly string[], referenceInstant: Date): string {
  const lastmod = referenceInstant.toISOString().slice(0, 10)
  const urls = routes.map(route => `<url><loc>${SITE_ORIGIN}${route}</loc><lastmod>${lastmod}</lastmod></url>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>\n`
}

function robots(): string {
  return `User-agent: *\nAllow: /\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`
}

async function findAppStylesheet(distDirectory: string): Promise<string> {
  const files = await readdir(join(distDirectory, 'assets'))
  const matches = files.filter(file => /^index-[^/]+\.css$/.test(file))
  if (matches.length !== 1) throw new Error(`Ожидался один собранный CSS интерфейса приложения, найдено ${matches.length}`)
  return `/assets/${matches[0]}`
}

async function writeBuildSummary(options: {
  index: CityIndex
  selected: readonly ValidatedCity[]
  withheld: readonly ValidatedCity[]
  previewCandidates: boolean
  referenceInstant: Date
  dateRanges: readonly { name: string; start: string; end: string }[]
}): Promise<void> {
  const lines = [
    '## Static timetable generation',
    '',
    `- Generator version: ${SEO_GENERATOR_VERSION}`,
    `- Calculation source revision: ${process.env.SEO_SOURCE_COMMIT ?? process.env.GITHUB_SHA ?? 'local/uncommitted'}`,
    `- GeoNames catalog version/checksum: ${options.index.version} / ${options.index.checksum}`,
    `- Publication state: ${options.previewCandidates ? 'test-only candidate preview; not publishable' : options.selected.length > 0 ? 'published build' : 'blocked; no approved pages'}`,
    `- Active city manifest: ${options.selected.length > 0 ? options.selected.map(({ candidate }) => candidate.id).join(', ') : 'empty'}`,
    `- Generated at: ${options.referenceInstant.toISOString()}`,
    `- Withheld candidates: ${options.withheld.length > 0 ? options.withheld.map(({ candidate, city }) => `${city.name} (${candidate.id})`).join(', ') : 'none'}`,
    `- Local calendar months: ${options.dateRanges.length > 0 ? options.dateRanges.map(range => `${range.name}: ${range.start}–${range.end}`).join('; ') : 'none; publication is blocked'}`,
    '',
  ]
  console.log(lines.join('\n'))
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (summaryPath) await appendFile(summaryPath, `${lines.join('\n')}\n`)
}

export async function buildSeoPages(options: BuildSeoPagesOptions = {}): Promise<{ routes: string[]; cityIds: number[] }> {
  const distDirectory = resolve(options.distDirectory ?? 'dist')
  const publicDirectory = resolve(options.publicDirectory ?? 'public')
  await rm(join(distDirectory, 'prayer-times'), { recursive: true, force: true })
  const appStylesheet = await findAppStylesheet(distDirectory)
  await writeFile(join(distDirectory, 'prayer-times-theme.css'), staticThemeStylesheet())
  await writeFile(join(distDirectory, '404.html'), notFoundPage(appStylesheet))
  await writeFile(join(distDirectory, 'robots.txt'), robots())

  const { index, records } = await loadCandidateRecords(publicDirectory)
  const candidates = resolveCityCandidates(records)
  const previewCandidates = options.previewCandidates ?? process.env.SEO_PREVIEW_CANDIDATES === 'true'
  const approvedIds = new Set(SEO_PUBLICATION_APPROVAL.approvedCityIds)
  const productionEligible = candidates.filter(({ candidate }) => candidate.ownerApproved
    && approvedIds.has(candidate.id)
    && candidate.demandEvidence.length > 0
    && candidate.demandEvidence.every(evidence => evidence.verification === 'verified'))
  const selected = previewCandidates ? candidates : productionEligible

  const referenceValue = options.referenceInstant ?? process.env.SEO_REFERENCE_INSTANT
  const referenceInstant = selected.length > 0
    ? parseReferenceInstant(referenceValue)
    : referenceValue ? parseReferenceInstant(referenceValue) : new Date()
  const requirePublishedPages = options.requirePublishedPages ?? process.env.SEO_REQUIRE_PUBLICATION === 'true'
  const withheld = candidates.filter(({ candidate }) => !productionEligible.some(page => page.candidate.id === candidate.id))
  const dateRanges: { name: string; start: string; end: string }[] = []
  if (requirePublishedPages && selected.length === 0) {
    await writeBuildSummary({ index, selected, withheld, previewCandidates, referenceInstant, dateRanges })
    throw new Error(`Публикация заблокирована: ${SEO_PUBLICATION_APPROVAL.reason}`)
  }

  const routes: string[] = []
  for (const { candidate, city, profile, place } of selected) {
    const dates = localCalendarMonth(referenceInstant, city.timeZone)
    const start = dates[0]
    const end = dates.at(-1)
    if (!start || !end) throw new Error(`${city.name}: диапазон дат не сформирован`)
    dateRanges.push({ name: city.name, start, end })
    const page = renderCityPage(city, candidate, profile, dates, referenceInstant, appStylesheet)
    const route = cityRoute(candidate)
    const outputPath = join(distDirectory, route.slice(1), 'index.html')
    await mkdir(join(distDirectory, route.slice(1)), { recursive: true })
    await writeFile(outputPath, page)
    routes.push(route)

    // Проверка даты расчёта использует то же место, которое передаётся движку.
    const firstSchedule = calculatePrayerSchedule(place, dates[0] ?? '', city.timeZone, profile.settings)
    if (firstSchedule.date !== dates[0]) throw new Error(`${city.name}: дата расписания не совпала с местной датой`)
  }

  await writeFile(join(distDirectory, 'sitemap.xml'), sitemap(routes, referenceInstant))
  await writeBuildSummary({ index, selected, withheld, previewCandidates, referenceInstant, dateRanges })
  return { routes, cityIds: selected.map(({ candidate }) => candidate.id) }
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2))
  const result = await buildSeoPages({
    previewCandidates: args.has('--preview-candidates'),
    requirePublishedPages: args.has('--require-published') || process.env.SEO_REQUIRE_PUBLICATION === 'true',
    distDirectory: args.has('--out-dir')
      ? process.argv[process.argv.indexOf('--out-dir') + 1]
      : undefined,
  })
  console.log(`SEO routes: ${result.routes.length}; city pages: ${result.cityIds.length}`)
}

const entryPoint = process.argv[1]
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
