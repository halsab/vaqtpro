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

test('recovers or offers a clean reload after an offline deferred import failure', async ({ page, context }) => {
  await page.goto('./')
  await choosePlace(page)
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Настройки' }).click()
  await expect(page.getByRole('alert')).toContainText('Не удалось открыть экран')

  await context.setOffline(false)
  const reload = page.getByRole('button', { name: 'Перезапустить' })
  const settings = page.getByRole('region', { name: 'Настройки' })
  await expect(reload.or(settings)).toBeVisible()
  if (await reload.isVisible()) {
    await reload.click()
    await expect(page.getByRole('region', { name: 'Главная', exact: true })).toBeVisible()
    expect(new URL(page.url()).searchParams.has('__deferred_module_reload')).toBe(false)
  } else {
    await expect(settings).toBeVisible()
  }
})

test('restores article focus and scroll after real browser Back navigation', async ({ page }) => {
  await page.goto('./')
  await choosePlace(page)
  await page.locator('#home-date').click()
  await page.getByRole('button', { name: 'Праздники и события' }).click()
  const rows = page.locator('.religious-event-list-row')
  await expect(rows.first()).toBeVisible()
  const lastRow = rows.last()
  await lastRow.focus()
  const content = page.locator('.screen-content')
  await content.evaluate(element => { element.scrollTop = element.scrollHeight })
  const before = await content.evaluate(element => element.scrollTop)
  await lastRow.click()
  await expect(page.locator('.markdown-article h1')).toBeVisible()

  await page.goBack()

  await expect(page.getByRole('region', { name: 'Праздники и события' })).toBeVisible()
  await expect(lastRow).toBeFocused()
  await expect.poll(() => content.evaluate(element => element.scrollTop)).toBe(before)
  await page.goBack()
  await expect(page.getByRole('region', { name: 'Установка даты' })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('region', { name: 'Главная', exact: true })).toBeVisible()
})

test('does not reopen a failed article when the user leaves before online recovery', async ({ page }) => {
  await page.goto('./')
  await choosePlace(page)
  await page.locator('#home-date').click()
  await page.getByRole('button', { name: 'Праздники и события' }).click()
  await expect(page.locator('.religious-event-list-row').first()).toBeVisible()
  let moduleRequests = 0
  await page.route(/\/assets\/ReligiousEventScreen-[^/]+\.js(?:\?.*)?$/, route => {
    moduleRequests += 1
    return route.abort()
  })
  await page.locator('.religious-event-list-row').first().click()
  await expect(page.getByText('Не удалось загрузить статью. Попробуйте ещё раз.')).toBeVisible()

  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page.getByRole('region', { name: 'Установка даты' })).toBeVisible()
  const failedRequestCount = moduleRequests
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await page.waitForTimeout(500)

  expect(moduleRequests).toBe(failedRequestCount)
  await expect(page.getByRole('region', { name: 'Установка даты' })).toBeVisible()
  await expect(page.locator('.markdown-article')).toHaveCount(0)
})
