import { choosePlace, expectSchedule, readSavedSetting, expect, test } from './fixtures'

test('сохранённое расписание и поиск города работают без сети', async ({ page, context, request }) => {
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
  const cachedScheduleData = await page.evaluate(async () => {
    const names = await caches.keys()
    const urls = await Promise.all(names.map(async name => {
      const cache = await caches.open(name)
      return (await cache.keys()).map(request => request.url)
    }))
    return urls.flat().some(url => url.includes('prayer-times-current.json'))
  })
  expect(cachedScheduleData).toBe(false)

  await context.setOffline(true)
  try {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expectSchedule(page, 7)
    expect(await page.locator('.event-row time').allTextContents()).toEqual(times)

    await page.locator('#home-location').click()
    await page.getByRole('button', { name: 'Найти город' }).click()
    await page.getByRole('searchbox').fill('Москва')
    await expect(page.getByRole('button', { name: 'Москва, Москва, Россия', exact: true })).toBeVisible()

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
    await page.locator('.religious-event-list-row').first().click()
    await expect(page.locator('.markdown-article h1')).toBeVisible()
    await expect(page.getByRole('region').filter({ has: page.locator('.markdown-article') })).toBeVisible()
  } finally {
    await context.setOffline(false)
  }
})
