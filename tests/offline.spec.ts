import { choosePlace, expectSchedule, readSavedSetting, expect, test } from './fixtures'

test('сохранённое расписание и поиск города работают без сети', async ({ page, context, request }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'iPhone' })
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone)' })
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 })
    Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: { platform: 'iOS' } })
  })
  const manifest = await (await request.get('./manifest.webmanifest')).json() as Record<string, unknown>
  expect(manifest).toMatchObject({ id: '/', scope: '/', start_url: '/' })
  expect(manifest).not.toHaveProperty('orientation')

  await page.goto('./')
  await choosePlace(page, 'Стамбул', 'Стамбул, Стамбул, Турция')
  await expectSchedule(page, 7)
  const times = await page.locator('.event-row time').allTextContents()
  await expect.poll(() => readSavedSetting(page, 'locationChoice'))
    .toMatchObject({ place: { cityId: 745044 } })

  await page.evaluate(async () => navigator.serviceWorker.ready)
  await page.reload()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  const cachedUrls = await page.evaluate(async () => {
    const names = await caches.keys()
    const urls = await Promise.all(names.map(async name => {
      const cache = await caches.open(name)
      return (await cache.keys()).map(request => request.url)
    }))
    return urls.flat()
  })
  const cachedPaths = cachedUrls.map(url => new URL(url).pathname)
  expect(cachedPaths.some(path => path.includes('prayer-times-current.json'))).toBe(false)
  expect(cachedPaths).toContain('/data/cities/offline-seed.json')
  expect(cachedPaths.some(path => /\/data\/cities\/(?:index\.json|[a-f0-9]{20}\/[^/]+\.json)$/.test(path))).toBe(false)

  await context.setOffline(true)
  try {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expectSchedule(page, 7)
    expect(await page.locator('.event-row time').allTextContents()).toEqual(times)

    await page.locator('#home-location').click()
    await page.getByRole('button', { name: 'Найти место' }).click()
    await page.getByRole('searchbox').fill('Москва')
    await expect(page.getByRole('button', { name: /Москва, Москва, Россия/ })).toBeVisible()

    await page.reload({ waitUntil: 'domcontentloaded' })
    await expectSchedule(page, 7)
    await page.locator('#home-qibla').click()
    await expect(page.getByRole('region', { name: 'Направление на киблу' })).toBeVisible()
    await expect(page.getByText('152°')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Включить компас' })).toBeVisible()
    await expect(page.locator('.qibla-pointer')).not.toHaveAttribute('data-visible', 'true')
    await page.getByRole('button', { name: 'Назад' }).click()
    await expectSchedule(page, 7)
    await page.locator('#home-settings').click()
    await expect(page.getByRole('button', { name: 'Данные и конфиденциальность' })).toBeVisible()
    await page.goBack()
    await expectSchedule(page, 7)
    await page.locator('#home-date').click()
    await page.getByRole('button', { name: 'Праздники и события' }).click()
    await expect(page.locator('.religious-event-list-row').first()).toBeVisible()
    await page.getByRole('button', { name: /Начало Рамадана/ }).click()
    await expect(page.locator('.markdown-article h1')).toBeVisible()
    await expect(page.getByRole('region').filter({ has: page.locator('.markdown-article') })).toBeVisible()
    for (const title of ['Зикр первых 10 дней', 'Зикр вторых 10 дней', 'Зикр последних 10 дней']) {
      await page.getByRole('button', { name: title }).click()
      const dhikr = page.getByRole('region', { name: title })
      await expect(dhikr.locator('.ramadan-dhikr-arabic[dir="rtl"][lang="ar"]')).toBeVisible()
      await expect(dhikr.getByRole('heading', { name: 'Перевод' })).toBeVisible()
      if (title !== 'Зикр последних 10 дней') await page.getByRole('button', { name: 'Назад' }).click()
    }
  } finally {
    await context.setOffline(false)
  }
})
