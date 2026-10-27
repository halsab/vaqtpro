import { choosePlace, expect, test } from './fixtures'

test.use({ serviceWorkers: 'block' })

test('keeps deferred progress visible and retries a failed cached module with a fresh URL', async ({ page }) => {
  await page.goto('./')
  await choosePlace(page)
  let releaseRequest!: () => void
  let requestStarted!: () => void
  const held = new Promise<void>(resolve => { releaseRequest = resolve })
  const started = new Promise<void>(resolve => { requestStarted = resolve })
  let failChunk = true
  let chunkRequests = 0
  await page.route(/\/assets\/SecondaryScreens-[^/]+\.js(?:\?.*)?$/, async route => {
    chunkRequests += 1
    if (!failChunk) { await route.continue(); return }
    requestStarted()
    await held
    await route.abort()
  })

  await page.getByRole('button', { name: 'Настройки' }).click()
  await started
  const progress = page.locator('.screen-load-progress')
  await expect(progress).toBeVisible()
  const bounds = await progress.boundingBox()
  const viewport = page.viewportSize()
  if (!bounds || !viewport) throw new Error('Expected visible progress bounds and viewport size')
  expect(bounds.y).toBeGreaterThanOrEqual(0)
  expect(bounds.y + bounds.height).toBeLessThan(viewport.height)

  releaseRequest()
  await expect(page.getByRole('alert')).toContainText('Не удалось открыть экран')
  await expect(page.getByRole('button', { name: 'Перезапустить' })).toBeVisible()
  failChunk = false
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect.poll(() => chunkRequests).toBeGreaterThan(1)
  await expect(page.getByRole('region', { name: 'Настройки' })).toBeVisible()
})

test('recovers from a failed deferred request when the browser returns online', async ({ page }) => {
  await page.goto('./')
  await choosePlace(page)
  let failChunk = true
  await page.route(/\/assets\/SecondaryScreens-[^/]+\.js(?:\?.*)?$/, route => failChunk ? route.abort() : route.continue())
  await page.getByRole('button', { name: 'Настройки' }).click()
  await expect(page.getByRole('alert')).toContainText('Не удалось открыть экран')

  failChunk = false
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.getByRole('region', { name: 'Настройки' })).toBeVisible()
})
