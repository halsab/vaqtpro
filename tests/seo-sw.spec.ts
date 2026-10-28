import { expect, test } from '@playwright/test'

const cityPath = '/prayer-times/ru/moskva-524901/'

test('старый application-shell fallback сменяется новым SW, а статический маршрут остаётся сетевым', async ({ page }) => {
  await page.goto('/__test__/bootstrap')
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/__test__/legacy-sw.js', { scope: '/' })
  })
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? '')).toContain('legacy-sw.js')

  const networkCityResponse = page.waitForResponse(response => {
    const url = new URL(response.url())
    return url.pathname === cityPath && !response.fromServiceWorker()
  }, { timeout: 20_000 })
  await page.goto(cityPath)
  await expect(page.locator('#root')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: 'Время намаза в Москве' })).toHaveCount(0)

  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? ''), { timeout: 20_000 }).toContain('/sw.js')
  const cityResponse = await networkCityResponse
  expect(cityResponse.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1, name: 'Время намаза в Москве' })).toBeVisible()

  await page.goto('/')
  await expect(page.locator('#root')).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { level: 1, name: 'Время намаза в Москве' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Время намаза в Москве' })).toBeVisible()

  await page.context().setOffline(true)
  await expect(page.goto(cityPath)).rejects.toThrow()
  await page.context().setOffline(false)
})
