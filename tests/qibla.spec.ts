import { expect, seedSelectedPlace, test } from './fixtures'

test('iOS compass permission starts only on user action and low-accuracy headings remain hidden', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'iPhone' })
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone)' })
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 })
    Object.defineProperty(window, 'AbsoluteOrientationSensor', { configurable: true, value: undefined })
    const requests: boolean[] = []
    Object.assign(window, { __qiblaPermissionRequests: requests })
    Object.defineProperty(window, 'DeviceOrientationEvent', {
      configurable: true,
      value: Object.assign(class extends Event {}, {
        requestPermission: (absolute = false) => {
          requests.push(absolute)
          return Promise.resolve('granted' as const)
        },
      }),
    })
  })

  await seedSelectedPlace(page)
  await expect(page.getByRole('region', { name: 'Главная', exact: true })).toBeVisible()
  await page.locator('#home-qibla').click()
  await expect(page.getByRole('region', { name: 'Направление на киблу' })).toBeVisible()
  const permissionRequests = () => page.evaluate(
    () => (window as Window & { __qiblaPermissionRequests: boolean[] }).__qiblaPermissionRequests,
  )
  expect(await permissionRequests()).toEqual([])
  await page.getByRole('button', { name: 'Включить компас' }).click()
  await expect.poll(permissionRequests).toEqual([true])

  const emitReading = (accuracy: number) => page.evaluate((reportedAccuracy) => {
    window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
      alpha: 0, beta: 0, gamma: 0, absolute: false,
      webkitCompassHeading: 90, webkitCompassAccuracy: reportedAccuracy,
    }))
  }, accuracy)
  await emitReading(-1)
  await expect(page.locator('.qibla-pointer')).not.toHaveAttribute('data-visible', 'true')
  await emitReading(6)
  await expect(page.locator('.qibla-pointer')).toHaveAttribute('data-visible', 'true')
  await expect(page.getByText(/физическая точность этого устройства не проверена/)).toBeAttached()
})

test('permission grant restores the visible compass after dialog blur without waiting for focus', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'iPhone' })
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone)' })
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 })
    Object.defineProperty(window, 'AbsoluteOrientationSensor', { configurable: true, value: undefined })
    type PermissionWindow = Window & {
      __qiblaPermissionRequests: number
      __qiblaHasFocus: boolean
      __qiblaResolvePermission?: (value: 'granted' | 'denied') => void
    }
    const testWindow = window as PermissionWindow
    testWindow.__qiblaPermissionRequests = 0
    testWindow.__qiblaHasFocus = true
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => testWindow.__qiblaHasFocus })
    const requestPermission = () => {
      testWindow.__qiblaPermissionRequests += 1
      return new Promise<'granted' | 'denied'>(resolve => { testWindow.__qiblaResolvePermission = resolve })
    }
    Object.defineProperty(window, 'DeviceOrientationEvent', {
      configurable: true,
      value: Object.assign(class extends Event {}, { requestPermission }),
    })
  })
  await seedSelectedPlace(page)
  await page.locator('#home-qibla').click()
  await expect(page.getByRole('region', { name: 'Направление на киблу' })).toBeVisible()
  await page.getByRole('button', { name: 'Включить компас' }).click()
  await expect.poll(() => page.evaluate(() => (window as Window & { __qiblaPermissionRequests: number }).__qiblaPermissionRequests)).toBe(1)

  await page.evaluate(() => {
    (window as Window & { __qiblaHasFocus: boolean }).__qiblaHasFocus = false
    window.dispatchEvent(new Event('blur'))
  })
  await page.evaluate(() => window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
    alpha: 0, beta: 0, gamma: 0, absolute: false, webkitCompassHeading: 20, webkitCompassAccuracy: 5,
  })))
  await expect(page.locator('.qibla-pointer')).not.toHaveAttribute('data-visible', 'true')

  await page.evaluate(() => (window as Window & { __qiblaResolvePermission?: (value: 'granted' | 'denied') => void })
    .__qiblaResolvePermission?.('granted'))
  await expect.poll(() => page.evaluate(() => {
    const testWindow = window as Window & { __qiblaPermissionRequests: number }
    return testWindow.__qiblaPermissionRequests
  })).toBe(1)
  await page.evaluate(() => window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
    alpha: 0, beta: 0, gamma: 0, absolute: false, webkitCompassHeading: 21, webkitCompassAccuracy: 5,
  })))
  await expect(page.locator('.qibla-pointer')).not.toHaveAttribute('data-visible', 'true')
  await page.evaluate(() => {
    (window as Window & { __qiblaHasFocus: boolean }).__qiblaHasFocus = true
    window.dispatchEvent(new Event('pageshow'))
  })
  await page.evaluate(() => window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
    alpha: 0, beta: 0, gamma: 0, absolute: false, webkitCompassHeading: 22, webkitCompassAccuracy: 5,
  })))
  await expect(page.locator('.qibla-pointer')).toHaveAttribute('data-visible', 'true')
})
