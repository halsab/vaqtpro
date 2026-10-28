import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import type { CompactCityRecord } from '../src/domain/cities'
import { buildCityPackages } from './buildCityPackages'
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
const generated = buildCityPackages([
  [1, 'Киров', ['киров'], 'RU', '33', 58.6, 49.6, 5000, 'Europe/Moscow', 'Кировская область', 'россия'],
], citySource)
const catalog = generated.index
const shardPath = `data/cities/${catalog.version}/RU-0.json`

function requiredArtifacts(cityCatalog = catalog): BuildArtifact[] {
  return [
    { path: 'index.html', size: 250 },
    { path: 'manifest.webmanifest', size: 100 },
    { path: 'share-qr.svg', size: 200 },
    { path: 'assets/index-a1b2c3.js', size: 100 },
    { path: 'assets/index-a1b2c3.css', size: 20 },
    { path: 'data/cities/index.json', size: 200 },
    { path: `data/cities/${cityCatalog.version}/${cityCatalog.shards[0]?.id}.json`, size: 300 },
    { path: 'robots.txt', size: 80 },
    { path: 'sitemap.xml', size: 100 },
  ]
}

async function writeBuildArtifacts(
  root: string,
  options: {
    cityCatalog?: typeof catalog
    cityShards?: typeof generated.shards
    mainJavaScript?: string
    css?: string
    html?: string
    manifest?: Record<string, unknown>
    shareQr?: string
    robots?: string
    sitemap?: string
  } = {},
): Promise<void> {
  const cityCatalog = options.cityCatalog ?? catalog
  const cityShards = options.cityShards ?? generated.shards
  const cityShardDirectory = join(root, 'data/cities', cityCatalog.version)
  await Promise.all([
    mkdir(join(root, 'assets'), { recursive: true }),
    mkdir(cityShardDirectory, { recursive: true }),
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
  const primaryShard = cityCatalog.shards[0]
  if (!primaryShard) throw new Error('Fixture справочника не содержит пакетов')

  await Promise.all([
    writeFile(join(root, 'assets/index-build.js'), options.mainJavaScript ?? 'application code'),
    writeFile(join(root, 'assets/index-build.css'), options.css ?? '.app { display: block; }'),
    writeFile(join(root, 'index.html'), options.html ?? '<html lang="ru"><head><meta name="description" content="Время намаза для выбранного места: независимый расчёт на устройстве. Сохранённые данные доступны офлайн." /><meta name="apple-mobile-web-app-title" content="VaqtPro" /><link rel="canonical" href="https://vaqt.pro/" /><title>VaqtPro — времена намаза</title></head></html>'),
    writeFile(join(root, 'manifest.webmanifest'), JSON.stringify(appManifest)),
    writeFile(join(root, 'share-qr.svg'), shareQr),
    writeFile(join(root, 'robots.txt'), options.robots ?? 'User-agent: *\nAllow: /\nSitemap: https://vaqt.pro/sitemap.xml\n'),
    writeFile(join(root, 'sitemap.xml'), options.sitemap ?? '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://vaqt.pro/</loc></url></urlset>\n'),
    writeFile(join(root, 'assets/city-search.worker.js'), 'worker code'),
    writeFile(join(root, 'sw.js'), 'offline worker'),
    writeFile(join(root, 'data/cities/index.json'), JSON.stringify(cityCatalog)),
    ...Object.entries(cityShards).map(([id, shard]) => writeFile(
      join(cityShardDirectory, `${id}.json`),
      JSON.stringify(shard),
    )),
  ])

}

async function temporaryDirectory(prefix = 'vaqtpro-build-artifacts-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

describe('production artifact validation', () => {
  it('requires the app bundles and city catalog', () => {
    expect(validateBuildArtifacts([], catalog)).toEqual(expect.arrayContaining([
      'mainJavaScript: artifact не найден',
      'mainCss: artifact не найден',
      'indexHtml: artifact не найден',
      'webManifest: artifact не найден',
      'shareQr: artifact не найден',
      'cityIndex: artifact не найден',
      'robots: artifact не найден',
      'sitemap: artifact не найден',
      `cities: отсутствует ${shardPath}`,
    ]))
  })

  it.each([
    ['prayer-times/ru/moskva-524901/index.html', 'SEO city page'],
    ['prayer-times-theme.css', 'SEO city theme'],
    ['404.html', 'SEO-specific 404'],
  ])('rejects the cancelled %s artifact', (path, label) => {
    expect(validateBuildArtifacts([...requiredArtifacts(), { path, size: 1 }], catalog))
      .toContain(`seo: cancelled ${label} artifact ${path}`)
  })

  it('blocks duplicate required main bundles and duplicate city paths', () => {
    const artifacts = requiredArtifacts()
    artifacts.push(
      { path: 'assets/index-second.js', size: 1 },
      { path: 'assets/index-second.css', size: 1 },
      { path: shardPath, size: 1 },
    )

    expect(validateBuildArtifacts(artifacts, catalog)).toEqual(expect.arrayContaining([
      'mainJavaScript: найдено 2 artifacts',
      'mainCss: найдено 2 artifacts',
      `cities: повторный artifact ${shardPath}`,
    ]))
  })

  it('accepts arbitrarily large JavaScript, CSS, city index, and shard artifacts', () => {
    const artifacts = requiredArtifacts().map((artifact) => ({
      ...artifact,
      size: 64 * 1024 * 1024,
    }))

    expect(validateBuildArtifacts(artifacts, catalog)).toEqual([])
  })

  it('blocks missing, extra, and obsolete city catalog artifacts', () => {
    expect(validateBuildArtifacts(requiredArtifacts().filter((artifact) => artifact.path !== shardPath), catalog))
      .toContain(`cities: отсутствует ${shardPath}`)
    expect(validateBuildArtifacts([
      ...requiredArtifacts(),
      { path: 'data/cities/stale/XX-0.json', size: 1 },
    ], catalog)).toContain('cities: лишний artifact data/cities/stale/XX-0.json')
    expect(validateBuildArtifacts([
      ...requiredArtifacts(),
      { path: 'data/cities-current.json', size: 1 },
    ], catalog)).toContain('cities: старый монолит недопустим')
  })

  it('fails an incomplete production directory before reporting sizes', async () => {
    const root = await temporaryDirectory()
    const messages: string[] = []

    try {
      await expect(checkBuildArtifacts(root, {
        log: (message) => messages.push(message),
      })).rejects.toThrow('mainJavaScript: artifact не найден')
      expect(messages).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
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
      expect(errorMessage).toContain('appTitle: index.html не содержит название VaqtPro')
      expect(errorMessage).toContain('appleTitle: index.html не содержит название VaqtPro')
      expect(errorMessage).toContain('webManifest: имя приложения должно быть VaqtPro')
      expect(errorMessage).toContain('webManifest: id должен указывать на корень сайта')
      expect(errorMessage).toContain('webManifest: start_url должен указывать на корень сайта')
      expect(errorMessage).toContain('webManifest: scope должен указывать на корень сайта')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each([
    '<html lang="ru"><head><meta name="description" content="Описание." /><meta name="apple-mobile-web-app-title" content="VaqtPro" /><title>VaqtPro — времена намаза</title></head></html>',
    '<html lang="ru"><head><meta name="description" content="Описание." /><meta name="apple-mobile-web-app-title" content="VaqtPro" /><link rel="canonical" href="https://vaqt.pro/?city=moscow" /><title>VaqtPro — времена намаза</title></head></html>',
    '<html lang="ru"><head><meta name="description" content="Описание." /><meta name="apple-mobile-web-app-title" content="VaqtPro" /><link rel="canonical" href="https://vaqt.pro/" /><link rel="canonical" href="https://vaqt.pro/" /><title>VaqtPro — времена намаза</title></head></html>',
  ])('rejects a missing, unstable, or duplicate canonical in initial HTML', async (html) => {
    const root = await temporaryDirectory()

    try {
      await writeBuildArtifacts(root, { html })
      await expect(checkBuildArtifacts(root, { log: () => undefined }))
        .rejects.toThrow('seo: initial HTML must contain exactly one static homepage canonical')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each([
    ['User-agent: *\nDisallow: /\nSitemap: https://vaqt.pro/sitemap.xml\n', 'seo: robots.txt must allow public crawling and reference the sitemap'],
    ['User-agent: *\nAllow: /\n', 'seo: robots.txt must allow public crawling and reference the sitemap'],
  ])('rejects nonpermissive or incomplete robots.txt', async (robots, message) => {
    const root = await temporaryDirectory()

    try {
      await writeBuildArtifacts(root, { robots })
      await expect(checkBuildArtifacts(root, { log: () => undefined })).rejects.toThrow(message)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each([
    ['<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://vaqt.pro/</loc><loc>https://vaqt.pro/prayer-times/ru/moskva-524901/</loc></url></urlset>', 'seo: sitemap.xml must contain exactly the homepage URL and no lastmod'],
    ['<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://vaqt.pro/</loc><lastmod>2026-10-28</lastmod></url></urlset>', 'seo: sitemap.xml must contain exactly the homepage URL and no lastmod'],
  ])('rejects extra or synthetic sitemap data', async (sitemap, message) => {
    const root = await temporaryDirectory()

    try {
      await writeBuildArtifacts(root, { sitemap })
      await expect(checkBuildArtifacts(root, { log: () => undefined })).rejects.toThrow(message)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a QR image that differs from the verified VaqtPro destination', async () => {
    const root = await temporaryDirectory()

    try {
      await writeBuildArtifacts(root, { shareQr: '<svg xmlns="http://www.w3.org/2000/svg" />' })

      let errorMessage = ''
      try {
        await checkBuildArtifacts(root, { log: () => undefined })
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error)
      }
      expect(errorMessage).toContain('shareQr: QR-код не соответствует проверенной ссылке https://vaqt.pro/')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('validates an intact production directory and reports bundles larger than the former limits', async () => {
    const root = await temporaryDirectory()
    const summaryPath = join(root, 'step-summary.md')
    const messages: string[] = []
    const mainJavaScript = 'x'.repeat(600 * 1024)
    const css = 'y'.repeat(50 * 1024)

    try {
      await writeBuildArtifacts(root, { mainJavaScript, css })
      await expect(checkBuildArtifacts(root, {
        summaryPath,
        log: (message) => messages.push(message),
      })).resolves.toBeUndefined()

      const output = messages.join('\n')
      expect(output).toContain('Main JavaScript: 614,400 bytes raw')
      expect(output).toContain('Total JavaScript: 614,425 bytes raw')
      expect(output).toContain('Total CSS: 51,200 bytes raw')
      expect(output).toContain('gzip')

      const summary = await readFile(summaryPath, 'utf8')
      expect(summary).toContain('| Main JavaScript | 614,400 bytes |')
      expect(summary).toContain('| Total JavaScript | 614,425 bytes |')
      expect(summary).toContain('| Total CSS | 51,200 bytes |')
      expect(summary).toContain('absolute sizes are shown')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reports absolute sizes when a PR base build is not available', async () => {
    const root = await temporaryDirectory()
    const messages: string[] = []

    try {
      await writeBuildArtifacts(root)
      await checkBuildArtifacts(root, {
        baselineDirectory: join(root, 'missing-baseline'),
        log: (message) => messages.push(message),
      })

      expect(messages.join('\n')).toContain('Comparison baseline unavailable; absolute sizes only.')
      expect(messages.join('\n')).toContain('::notice::PR base size comparison unavailable')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('compares gzip size with a reliable baseline and highlights increases without failing', async () => {
    const root = await temporaryDirectory()
    const current = join(root, 'current')
    const baseline = join(root, 'baseline')
    const summaryPath = join(root, 'summary.md')
    const messages: string[] = []

    try {
      await writeBuildArtifacts(current, {
        mainJavaScript: 'x'.repeat(80 * 1024),
        css: 'y'.repeat(20 * 1024),
      })
      await mkdir(join(baseline, 'assets'), { recursive: true })
      await Promise.all([
        writeFile(join(baseline, 'assets/index-main.js'), 'x'.repeat(20 * 1024)),
        writeFile(join(baseline, 'assets/index-main.css'), 'y'.repeat(2 * 1024)),
      ])

      await expect(checkBuildArtifacts(current, {
        baselineDirectory: baseline,
        summaryPath,
        log: (message) => messages.push(message),
      })).resolves.toBeUndefined()

      expect(messages.join('\n')).toContain('Δ vs PR base')
      expect(messages.join('\n')).toContain('::warning title=Production asset size increased::')
      expect((await readFile(summaryPath, 'utf8'))).toContain('| Δ gzip vs PR base |')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('blocks corrupted city catalog input and duplicate city artifacts', async () => {
    const root = await temporaryDirectory()
    try {
      await mkdir(join(root, 'data/cities'), { recursive: true })
      await writeFile(join(root, 'data/cities/index.json'), '{broken')
      await expect(checkBuildArtifacts(root)).rejects.toThrow('cities:')
      expect(validateBuildArtifacts([
        ...requiredArtifacts(),
        { path: shardPath, size: 1 },
      ], catalog)).toContain(`cities: повторный artifact ${shardPath}`)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each(['filter', 'timezone', 'missing-city'] as const)(
    'rejects a self-consistent catalog checksum with inconsistent %s data',
    async (kind) => {
      const index = structuredClone(catalog)
      const descriptor = index.shards[0]
      const city = index.overview[0]
      if (!descriptor || !city) throw new Error('Отсутствует город fixture')
      if (kind === 'filter') descriptor.filter = 'A'.repeat(descriptor.filter.length)
      if (kind === 'timezone') city[8] = 'Europe/Samara'
      if (kind === 'missing-city') city[0] = 9999
      const { sha256 } = await import('./buildCityPackages')
      index.checksum = sha256(JSON.stringify({ ...index, checksum: '' }))
      const root = await temporaryDirectory()

      try {
        await writeBuildArtifacts(root)
        await writeFile(join(root, 'data/cities/index.json'), JSON.stringify(index))
        await writeFile(join(root, `data/cities/${index.version}/${descriptor.id}.json`), JSON.stringify(generated.shards[descriptor.id]))
        const expected = kind === 'filter' ? 'Повреждён поисковый индекс'
          : kind === 'timezone' ? 'Обзор расходится с пакетом' : 'Обзор содержит отсутствующий город'
        await expect(checkBuildArtifacts(root)).rejects.toThrow(expected)
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
  )

  it('blocks duplicate GeoNames IDs spread across different shards', async () => {
    const records: CompactCityRecord[] = Array.from({ length: 300 }, (_, index) => {
      const id = index + 1
      return [
        id,
        `Город ${id}`,
        [`город ${id}`],
        'RU',
        '00',
        55 + id % 5,
        49 + id % 10,
        id <= 3 ? 100_000 + id : 5000,
        'Europe/Moscow',
        'регион',
        'россия',
      ]
    })
    const lastCity = records.at(-1)
    if (!lastCity) throw new Error('Отсутствует последний город fixture')
    const duplicateCity = [...lastCity] as CompactCityRecord
    duplicateCity[5] = 89
    duplicateCity[6] = 179
    const duplicateCatalog = buildCityPackages([...records, duplicateCity], citySource)
    expect(duplicateCatalog.index.shards).toHaveLength(2)
    expect(duplicateCatalog.index.overview.map((city) => city[0])).toEqual([3, 2, 1])
    expect(duplicateCatalog.index.shards.map((shard) => shard.count)).toEqual([300, 1])
    const root = await temporaryDirectory()

    try {
      await writeBuildArtifacts(root, {
        cityCatalog: duplicateCatalog.index,
        cityShards: duplicateCatalog.shards,
      })
      await expect(checkBuildArtifacts(root)).rejects.toThrow('Повторный GeoNames ID 300')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('accepts a city shard larger than the former cap when its checksums and index agree', async () => {
    const longName = 'А'.repeat(70_000)
    const largeCatalog = buildCityPackages([[
      2,
      longName,
      [longName.toLocaleLowerCase('ru-RU')],
      'RU',
      '00',
      55.7,
      49.1,
      5000,
      'Europe/Moscow',
      'регион',
      'россия',
    ]], citySource)
    expect(largeCatalog.index.shards[0]?.bytes).toBeGreaterThan(128 * 1024)
    const root = await temporaryDirectory()

    try {
      await writeBuildArtifacts(root, {
        cityCatalog: largeCatalog.index,
        cityShards: largeCatalog.shards,
      })
      await expect(checkBuildArtifacts(root)).resolves.toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects obsolete daily timetable assets', () => {
    expect(validateBuildArtifacts([
      ...requiredArtifacts(),
      { path: 'data/prayer-times-current.json', size: 1 },
      { path: 'data/prayer-times-manifest.json', size: 1 },
    ], catalog)).toContain('prayerData: obsolete timetable artifacts must not be bundled')
  })

  it('reports correctness failures through the CLI with a non-zero exit code', () => {
    const previousExitCode = process.exitCode
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      reportBuildArtifactFailure(new Error('invalid artifact'))
      expect(error).toHaveBeenCalledWith('invalid artifact')
      expect(process.exitCode).toBe(1)
    } finally {
      process.exitCode = previousExitCode
    }
  })
})
