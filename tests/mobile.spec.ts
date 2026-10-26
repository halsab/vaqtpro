import { choosePlace, expect, expectSchedule, readSavedSetting, test } from './fixtures'

test('Mobile Safari first-launch screen remains usable at 320px, landscape and larger text', async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as Window & { __geoRequests: number }
    target.__geoRequests = 0
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition: () => { target.__geoRequests += 1 },
    } })
  })
  await page.setViewportSize({ width: 320, height: 568 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Выберите место' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Настройки' })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.themeTone)).toBe('dark')
  await expect.poll(() => page.evaluate(() => (window as Window & { __geoRequests: number }).__geoRequests)).toBe(0)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.setViewportSize({ width: 844, height: 390 })
  await expect(page.getByRole('button', { name: 'Найти город' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Найти город' }).click()
  await expect(page.getByRole('searchbox')).toBeFocused()
})

test('Mobile Safari выбирает место и открывает календарь без потери расписания', async ({ page }) => {
  await page.goto('./')
  await choosePlace(page)
  await expectSchedule(page)

  await page.locator('#home-date').click()
  await expect(page.getByRole('region', { name: 'Установка даты' })).toBeVisible()
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expectSchedule(page)
})

test('Mobile Safari сохраняет настройку поста после перезапуска', async ({ page }) => {
  await page.goto('./')
  await choosePlace(page)
  await page.locator('#home-settings').click()

  const fastingMode = page.getByRole('switch')
  await expect(fastingMode).toBeVisible()
  await fastingMode.click()
  await expect(fastingMode).toHaveAttribute('aria-checked', 'true')
  await expect.poll(() => readSavedSetting(page, 'fastingMode')).toMatchObject({ manualEnabled: true })

  await page.reload()
  await expect(page.locator('#home-settings')).toBeVisible()
  await page.locator('#home-settings').click()
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(page.getByRole('progressbar')).toBeVisible()
})
