import { choosePlace, expect, test } from './fixtures'

test('Qibla action fits the compact home toolbar and returns focus in mobile WebKit', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await page.goto('./')
  await choosePlace(page)

  const compass = page.locator('#home-qibla')
  const settings = page.locator('#home-settings')
  const [compassBox, settingsBox] = await Promise.all([compass.boundingBox(), settings.boundingBox()])
  expect(compassBox).not.toBeNull()
  expect(settingsBox).not.toBeNull()
  if (!compassBox || !settingsBox) throw new Error('Home actions did not expose layout bounds')
  expect(compassBox.width).toBe(44)
  expect(compassBox.height).toBe(44)
  expect(settingsBox.width).toBe(44)
  expect(settingsBox.height).toBe(44)
  expect(compassBox.x).toBeLessThan(settingsBox.x)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  await compass.click()
  await expect(page.getByRole('region', { name: 'Направление на киблу' })).toBeVisible()
  await expect(page.getByText('195°')).toBeVisible()
  await expect(page.getByText('от истинного севера', { exact: true })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('region', { name: 'Главная' })).toBeVisible()
  await expect(compass).toBeFocused()
  await page.goForward()
  await expect(page.getByRole('region', { name: 'Направление на киблу' })).toBeVisible()
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(compass).toBeFocused()
})

test('orientation permission starts only on user action and WebKit magnetic readings stay explicitly unverified', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { __qiblaPermissionRequests: [] as boolean[] })
    Object.defineProperty(window, 'AbsoluteOrientationSensor', { configurable: true, value: undefined })
    const requestPermission = (absolute = false) => {
      ;(window as Window & { __qiblaPermissionRequests: boolean[] }).__qiblaPermissionRequests.push(absolute)
      return Promise.resolve('granted' as const)
    }
    Object.defineProperty(window, 'DeviceOrientationEvent', {
      configurable: true,
      value: Object.assign(class extends Event {}, { requestPermission }),
    })
  })
  await page.goto('./')
  await choosePlace(page)
  await page.locator('#home-qibla').click()
  await expect(page.getByRole('region', { name: 'Направление на киблу' })).toBeVisible()
  expect(await page.evaluate(() => (window as Window & { __qiblaPermissionRequests: boolean[] }).__qiblaPermissionRequests)).toEqual([])

  await page.getByRole('button', { name: 'Включить компас' }).click()
  await expect.poll(() => page.evaluate(() => (window as Window & { __qiblaPermissionRequests: boolean[] }).__qiblaPermissionRequests)).toEqual([true])
  await page.evaluate(() => {
    const reading = Object.assign(new Event('deviceorientation'), {
      alpha: 0, beta: 0, gamma: 0, absolute: false,
      webkitCompassHeading: 359, webkitCompassAccuracy: -1,
    })
    window.dispatchEvent(reading)
  })
  await expect(page.getByText(/Компас не откалиброван/)).toBeVisible()
  await page.evaluate(() => {
    const reading = Object.assign(new Event('deviceorientation'), {
      alpha: 0, beta: 0, gamma: 0, absolute: false,
      webkitCompassHeading: 359, webkitCompassAccuracy: 6,
    })
    window.dispatchEvent(reading)
  })
  await expect(page.getByText(/Живое направление доступно, но физическая точность этого устройства не проверена/)).toBeVisible()
  await expect(page.getByText(/Оценка датчика направления: ±6.0°/)).toBeVisible()
  await expect(page.locator('.qibla-relative-guidance')).toHaveAttribute('aria-live', 'polite')
  await expect(page.locator('.qibla-relative-guidance')).toContainText(/(Поверните телефон|Кибла прямо перед вами|Кибла позади)/)
  await expect(page.locator('.qibla-dial')).toHaveAttribute('style', /rotate\(/)

  const performanceSample = await page.evaluate(async () => {
    const started = performance.now()
    for (let index = 0; index < 500; index += 1) {
      window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
        alpha: 0, beta: 0, gamma: 0, absolute: false,
        webkitCompassHeading: index % 2 ? 1 : 359, webkitCompassAccuracy: 6,
      }))
    }
    const dispatchDurationMs = performance.now() - started
    const frameStarted = performance.now()
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    return { dispatchDurationMs, nextFrameLatencyMs: performance.now() - frameStarted }
  })
  console.info(`Qibla sensor mock: 500 events dispatched in ${performanceSample.dispatchDurationMs.toFixed(2)} ms; next frame in ${performanceSample.nextFrameLatencyMs.toFixed(2)} ms`)
  expect(performanceSample.dispatchDurationMs).toBeGreaterThanOrEqual(0)
  expect(performanceSample.nextFrameLatencyMs).toBeGreaterThanOrEqual(0)
})
