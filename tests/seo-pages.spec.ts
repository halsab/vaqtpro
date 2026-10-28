import { expect, test } from '@playwright/test'

const cityPath = '/prayer-times/ru/moskva-524901/'

test('городская страница полностью читается без JavaScript и содержит текущий календарный месяц', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false })
  const page = await context.newPage()
  const offOriginRequests: string[] = []
  page.on('request', request => {
    if (new URL(request.url()).origin !== new URL(baseURL ?? 'http://127.0.0.1:4175').origin) {
      offOriginRequests.push(request.url())
    }
  })

  try {
    const response = await page.goto(cityPath)
    expect(response?.status()).toBe(200)
    await expect(page).toHaveTitle(/Время намаза в Москве/)
    await expect(page.locator('h1')).toHaveText('Время намаза в Москве')
    await expect.poll(() => page.locator('h1').evaluate(element => {
      const style = getComputedStyle(element)
      return `${style.position}|${style.width}|${style.height}|${style.clipPath}`
    })).toBe('absolute|1px|1px|inset(50%)')
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru')
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://vaqt.pro${cityPath}`)
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer')
    await expect(page.locator('tbody')).toHaveCount(1)
    await expect(page.locator('tbody tr')).toHaveCount(31)
    await expect(page.locator('table a, table button')).toHaveCount(0)
    await expect(page.locator('tbody tr').first().locator('th[scope="row"] time')).toHaveText('01.10.2026')
    await expect(page.locator('tbody tr').first().locator('td')).toHaveCount(6)
    await expect(page.locator('tbody tr').last().locator('th[scope="row"] time')).toHaveText('31.10.2026')
    await expect(page.locator('.prayer-month-method')).not.toHaveAttribute('open')
    await expect(page.locator('.prayer-month-method summary')).toHaveText('Москва · Профиль расчёта · Россия')
    expect(await page.locator('body').innerText()).not.toMatch(/Часовой пояс|Europe\/Moscow/)
    await page.locator('.prayer-month-method summary').click()
    await expect(page.locator('.prayer-month-method')).toContainText(/а не официальное расписание мечети/)
    expect(await page.locator('body').innerText()).not.toContain('≈')
    expect(await page.locator('tbody tr th[scope="row"] time').allTextContents()).toEqual(
      Array.from({ length: 31 }, (_, index) => `${String(index + 1).padStart(2, '0')}.10.2026`),
    )
    expect(await page.locator('script').count()).toBe(0)
    expect(offOriginRequests).toEqual([])
  } finally {
    await context.close()
  }
})

test('sitemap включает только города, а неизвестный маршрут и корневой каталог дают 404', async ({ request }) => {
  const [sitemapResponse, robotsResponse, missingResponse] = await Promise.all([
    request.get('/sitemap.xml'),
    request.get('/robots.txt'),
    request.get('/prayer-times/ru/not-a-city-1/'),
  ])
  const rootCatalogResponse = await request.get('/prayer-times/')
  const sitemapXml = await sitemapResponse.text()
  const robots = await robotsResponse.text()

  expect(sitemapResponse.status()).toBe(200)
  expect(sitemapXml.match(/<loc>/g)).toHaveLength(10)
  expect(sitemapXml).toContain(`https://vaqt.pro${cityPath}`)
  expect(robots).toContain('Sitemap: https://vaqt.pro/sitemap.xml')
  expect(missingResponse.status()).toBe(404)
  expect(await missingResponse.text()).toMatch(/<h1\b[^>]*>Страница не найдена<\/h1>/)
  expect(rootCatalogResponse.status()).toBe(404)
})

test('нормализует маршрут города со слешем и сохраняет canonical без query-параметров', async ({ request, browser, baseURL }) => {
  const response = await request.get('/prayer-times/ru/moskva-524901', { maxRedirects: 0 })
  expect(response.status()).toBe(308)
  expect(response.headers().location).toBe(cityPath)

  const context = await browser.newContext({ baseURL, javaScriptEnabled: false })
  const page = await context.newPage()
  try {
    await page.goto(`${cityPath}?utm_source=search&city=private`)
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://vaqt.pro${cityPath}`)
  } finally {
    await context.close()
  }
})

test('ссылка в приложение не передаёт URL города как referrer', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false })
  const page = await context.newPage()
  let appRequestReferer: string | undefined
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/') appRequestReferer = request.headers().referer
  })
  try {
    await page.goto(cityPath)
    await page.getByRole('link', { name: 'Открыть приложение VaqtPro' }).click()
    expect(appRequestReferer).toBeUndefined()
  } finally {
    await context.close()
  }
})

test('городская таблица помещается в ширину 320 px, а ссылки доступны для клавиатуры', async ({ browser, baseURL }, testInfo) => {
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    viewport: { width: 320, height: 780 },
  })
  const page = await context.newPage()
  try {
    await page.goto(cityPath)
    const dimensions = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }))
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport)
    const brandLink = page.getByRole('link', { name: 'Открыть приложение VaqtPro' })
    if (testInfo.project.name === 'mobile-safari-portrait') {
      expect(await brandLink.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
    } else {
      await page.keyboard.press('Tab')
      await expect(brandLink).toBeFocused()
    }
    const scrollRegion = page.getByRole('region', { name: 'Расписание намаза за месяц' })
    await expect(scrollRegion).toHaveAttribute('tabindex', '0')
    await page.setViewportSize({ width: 740, height: 780 })
    const compactDimensions = await scrollRegion.evaluate(element => {
      const firstCell = element.querySelector('th')
      return { client: element.clientWidth, scroll: element.scrollWidth,
        padding: firstCell ? getComputedStyle(firstCell).paddingInlineStart : '' }
    })
    expect(compactDimensions.scroll).toBeLessThanOrEqual(compactDimensions.client)
    expect(parseFloat(compactDimensions.padding)).toBeGreaterThanOrEqual(8)
    expect(parseFloat(compactDimensions.padding)).toBeLessThanOrEqual(12)

    await page.setViewportSize({ width: 320, height: 780 })
    const tableDimensions = await scrollRegion.evaluate(element => {
      const firstCell = element.querySelector('th')
      return { client: element.clientWidth, scroll: element.scrollWidth,
        padding: firstCell ? getComputedStyle(firstCell).paddingInlineStart : '' }
    })
    expect(tableDimensions.scroll).toBeGreaterThan(tableDimensions.client)
    expect(tableDimensions.padding).toBe('8px')
  } finally {
    await context.close()
  }
})
