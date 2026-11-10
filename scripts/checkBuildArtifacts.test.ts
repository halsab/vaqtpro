import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  checkBuildArtifacts,
  reportBuildArtifactFailure,
  validateBuildArtifacts,
  type BuildArtifact,
} from './checkBuildArtifacts'

const citySource = {
  name: 'GeoNames',
  url: 'https://www.geonames.org/',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  updatedAt: '2026-09-07',
}
const offlineSeed = {
  schemaVersion: 1,
  source: citySource,
  cities: [[1, 'Киров', ['киров'], 'RU', '33', 58.6, 49.6, 5000, 'Europe/Moscow', 'Кировская область', 'россия']],
}

function requiredArtifacts(): BuildArtifact[] {
  return [
    { path: 'index.html', size: 250 },
    { path: 'manifest.webmanifest', size: 100 },
    { path: 'share-qr.svg', size: 200 },
    { path: 'assets/index-a1b2c3.js', size: 100 },
    { path: 'assets/index-a1b2c3.css', size: 20 },
    { path: 'data/cities/offline-seed.json', size: 100 },
    { path: 'robots.txt', size: 80 },
    { path: 'sitemap.xml', size: 100 },
  ]
}

async function writeBuildArtifacts(
  root: string,
  options: {
    offlineSeed?: typeof offlineSeed
    mainJavaScript?: string
    css?: string
    html?: string
    manifest?: Record<string, unknown>
    shareQr?: string
    robots?: string
    sitemap?: string
  } = {},
): Promise<void> {
  await Promise.all([
    mkdir(join(root, 'assets'), { recursive: true }),
    mkdir(join(root, 'data/cities'), { recursive: true }),
  ])

  const appManifest = options.manifest ?? {
    name: 'VaqtPro — времена намаза',
    short_name: 'VaqtPro',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
  }
  const shareQr = options.shareQr ?? await readFile(join(process.cwd(), 'public/share-qr.svg'), 'utf8')
  await Promise.all([
    writeFile(join(root, 'assets/index-build.js'), options.mainJavaScript ?? 'application code'),
    writeFile(join(root, 'assets/index-build.css'), options.css ?? '.app { display: block; }'),
    writeFile(join(root, 'index.html'), options.html ?? '<html lang="ru"><head><meta name="description" content="Время намаза для выбранного города или геолокации. Расписание молитв на день и месяц, настройки расчёта и работа без интернета." /><meta name="keywords" content="время намаза, времена намаза, расписание намаза, время намаза сегодня, расписание молитв, время молитвы, время намаза на месяц, время намаза по городам, время намаза по геолокации, время намаза без интернета, приложение время намаза, VaqtPro" /><meta name="apple-mobile-web-app-title" content="VaqtPro" /><link rel="canonical" href="https://vaqt.pro/" /><title>Время намаза — расписание молитв | VaqtPro</title></head></html>'),
    writeFile(join(root, 'manifest.webmanifest'), JSON.stringify(appManifest)),
    writeFile(join(root, 'share-qr.svg'), shareQr),
    writeFile(join(root, 'robots.txt'), options.robots ?? 'User-agent: *\nAllow: /\nSitemap: https://vaqt.pro/sitemap.xml\n'),
    writeFile(join(root, 'sitemap.xml'), options.sitemap ?? '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://vaqt.pro/</loc></url></urlset>\n'),
    writeFile(join(root, 'sw.js'), 'offline worker data/cities/offline-seed.json'),
    writeFile(join(root, 'data/cities/offline-seed.json'), JSON.stringify(options.offlineSeed ?? offlineSeed)),
  ])

}

async function temporaryDirectory(prefix = 'vaqtpro-build-artifacts-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

describe('production artifact validation', () => {
  it('requires the app bundles and compact offline place seed', () => {
    expect(validateBuildArtifacts([])).toEqual(expect.arrayContaining([
      'mainJavaScript: artifact не найден',
      'mainCss: artifact не найден',
      'indexHtml: artifact не найден',
      'webManifest: artifact не найден',
      'shareQr: artifact не найден',
      'offlineCitySeed: artifact не найден',
      'robots: artifact не найден',
      'sitemap: artifact не найден',
    ]))
  })


  it('blocks duplicate required bundles and offline seed assets', () => {
    const artifacts = requiredArtifacts()
    artifacts.push(
      { path: 'assets/index-second.js', size: 1 },
      { path: 'assets/index-second.css', size: 1 },
      { path: 'data/cities/offline-seed.json', size: 1 },
    )

    expect(validateBuildArtifacts(artifacts)).toEqual(expect.arrayContaining([
      'mainJavaScript: найдено 2 artifacts',
      'mainCss: найдено 2 artifacts',
      'offlineCitySeed: найдено 2 artifacts',
    ]))
  })


  it('blocks extra city artifacts and obsolete monoliths', () => {
    expect(validateBuildArtifacts([
      ...requiredArtifacts(),
      { path: 'data/cities/stale/XX-0.json', size: 1 },
    ])).toContain('cities: лишний artifact data/cities/stale/XX-0.json')
    expect(validateBuildArtifacts([
      ...requiredArtifacts(),
      { path: 'data/cities-current.json', size: 1 },
    ])).toContain('cities: старый монолит недопустим')
  })


  it('rejects stale branding and a subpath PWA installation scope', async () => {
    const root = await temporaryDirectory()

    try {
      await writeBuildArtifacts(root, {
        html: '<meta name="apple-mobile-web-app-title" content="Salah" /><title>Salah — времена намаза</title>',
        manifest: {
          name: 'Salah — времена намаза',
          short_name: 'Salah',
          id: '/salah-pwa/',
          start_url: '/salah-pwa/',
          scope: '/salah-pwa/',
          display: 'standalone',
        },
      })

      let errorMessage = ''
      try {
        await checkBuildArtifacts(root, { log: () => undefined })
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error)
      }
      expect(errorMessage).toContain('seo: initial HTML must contain exactly one approved homepage title')
      expect(errorMessage).toContain('appleTitle: index.html не содержит название VaqtPro')
      expect(errorMessage).toContain('webManifest: имя приложения должно быть VaqtPro')
      expect(errorMessage).toContain('webManifest: id должен указывать на корень сайта')
      expect(errorMessage).toContain('webManifest: start_url должен указывать на корень сайта')
      expect(errorMessage).toContain('webManifest: scope должен указывать на корень сайта')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })









  it('rejects an invalid or oversized offline seed and forbids caching provider results', async () => {
    const root = await temporaryDirectory()
    try {
      await writeBuildArtifacts(root, { offlineSeed: { ...offlineSeed, schemaVersion: 99 } })
      await expect(checkBuildArtifacts(root)).rejects.toThrow('cities: Невалидный офлайн-набор мест')

      await writeBuildArtifacts(root)
      await writeFile(join(root, 'sw.js'), 'precache secure.geonames.org')
      await expect(checkBuildArtifacts(root)).rejects.toThrow('Service Worker должен кэшировать только компактный офлайн-набор')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })


})
