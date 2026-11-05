import { choosePlace, expect, test } from './fixtures'

test('Qibla action fits the compact home toolbar and returns focus in mobile WebKit', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'iPhone' })
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone)' })
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 })
    Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: { platform: 'iOS' } })
  })
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
  await expect(page.locator('.qibla-accuracy')).toHaveText('Точность: Неизвестна')
  await expect(page.getByRole('heading')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /место|локация|город/i })).toHaveCount(0)
  await page.goBack()
  await expect(page.getByRole('region', { name: 'Главная' })).toBeVisible()
  await expect(compass).toBeFocused()
  await page.setViewportSize({ width: 735, height: 988 })
  await expect(compass).toBeVisible()
  await page.goForward()
  await expect(page.getByRole('region', { name: 'Направление на киблу' })).toBeVisible()
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(compass).toBeFocused()
})

test('desktop home hides the Qibla action at narrow and wide viewport widths', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop platform visibility is validated in Chromium')
  await page.setViewportSize({ width: 320, height: 700 })
  await page.goto('./')
  await choosePlace(page)
  await expect(page.locator('#home-qibla')).toHaveCount(0)
  await expect(page.locator('#home-settings')).toBeVisible()
  await page.setViewportSize({ width: 735, height: 988 })
  await expect(page.locator('#home-qibla')).toHaveCount(0)
  await expect(page.locator('#home-settings')).toBeVisible()
})

test('orientation permission starts only on user action and WebKit magnetic readings stay explicitly unverified', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'iPhone' })
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone)' })
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 })
    Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: { platform: 'iOS' } })
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
  await expect(page.getByRole('heading')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /место|локация|город/i })).toHaveCount(0)
  await expect(page.getByText('Кибла', { exact: true })).toHaveCount(0)
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
  await expect(page.getByText(/Уберите телефон от металла и проверьте компас/)).toBeVisible()
  await page.evaluate(() => {
    const reading = Object.assign(new Event('deviceorientation'), {
      alpha: 0, beta: 0, gamma: 0, absolute: false,
      webkitCompassHeading: 90, webkitCompassAccuracy: 6,
    })
    window.dispatchEvent(reading)
  })
  await expect(page.locator('.qibla-screen .sr-only[aria-live="polite"]')).toContainText(/Поверните телефон|Кибла прямо перед вами|Кибла позади/)
  await expect(page.getByText(/Живое направление доступно, но физическая точность этого устройства не проверена/)).toHaveClass('sr-only')
  await expect(page.locator('.qibla-pointer')).toHaveAttribute('data-visible', 'true')
  await expect(page.locator('.qibla-forward-marker')).toBeVisible()
  await expect(page.locator('.qibla-forward-marker')).toHaveCSS('border-radius', '50%')
  await expect(page.locator('.qibla-accuracy')).toHaveText('Точность: Хорошая')
  await expect(page.locator('.qibla-accuracy')).not.toContainText(/\d|°/)

  await page.evaluate(() => window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
    alpha: 0, beta: 0, gamma: 0, absolute: false,
    webkitCompassHeading: 90, webkitCompassAccuracy: 60.001,
  })))
  await expect(page.locator('.qibla-accuracy')).toHaveText('Точность: Недоступна')
  await expect(page.locator('.qibla-pointer')).not.toHaveAttribute('data-visible', 'true')
  await page.evaluate(() => window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
    alpha: 0, beta: 0, gamma: 0, absolute: false,
    webkitCompassHeading: 90, webkitCompassAccuracy: 60,
  })))
  await expect(page.locator('.qibla-accuracy')).toHaveText('Точность: Очень низкая')
  await expect(page.locator('.qibla-pointer')).toHaveAttribute('data-visible', 'true')
  await page.evaluate(() => window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
    alpha: 0, beta: 0, gamma: 0, absolute: false,
    webkitCompassHeading: 90, webkitCompassAccuracy: 6,
  })))
  await expect(page.locator('.qibla-accuracy')).toHaveText('Точность: Хорошая')

  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 390, height: 844 }, { width: 390, height: 320 }]) {
    await page.setViewportSize(viewport)
    await expect(page.getByRole('region', { name: 'Направление на киблу' })).toBeVisible()
    await expect(page.locator('.qibla-accuracy')).toBeVisible()
    const layout = await page.evaluate(async () => {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      const dial = document.querySelector('.qibla-dial')?.getBoundingClientRect()
      const content = document.querySelector('.qibla-screen-content')
      if (!dial || !content) return null
      const bounds = content.getBoundingClientRect()
      return {
        dial: { x: dial.x, y: dial.y, width: dial.width, height: dial.height },
        content: { x: bounds.x, y: bounds.y, width: content.clientWidth, height: content.clientHeight },
      }
    })
    expect(layout).not.toBeNull()
    if (!layout) throw new Error('Compass layout bounds are missing')
    expect(layout.dial.width).toBeLessThanOrEqual(layout.content.width)
    expect(layout.dial.height).toBeLessThanOrEqual(layout.content.height)
    expect(layout.dial.x).toBeGreaterThanOrEqual(layout.content.x - 1)
    expect(layout.dial.y).toBeGreaterThanOrEqual(layout.content.y - 1)
    expect(layout.dial.x + layout.dial.width).toBeLessThanOrEqual(layout.content.x + layout.content.width + 1)
    expect(layout.dial.y + layout.dial.height).toBeLessThanOrEqual(layout.content.y + layout.content.height + 1)
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  await expect(page.locator('.qibla-accuracy')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.evaluate(() => { document.documentElement.style.fontSize = '' })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await page.locator('.qibla-pointer').evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s')

  const performanceSample = await page.evaluate(async () => {
    const started = performance.now()
    for (let index = 0; index < 500; index += 1) {
      window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
        alpha: 0, beta: 0, gamma: 0, absolute: false,
        webkitCompassHeading: 359, webkitCompassAccuracy: 6,
      }))
    }
    const dispatchDurationMs = performance.now() - started
    const frameStarted = performance.now()
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    return { dispatchDurationMs, nextFrameLatencyMs: performance.now() - frameStarted }
  })
  console.info(`Qibla sensor mock: 500 events dispatched in ${performanceSample.dispatchDurationMs.toFixed(2)} ms; next frame in ${performanceSample.nextFrameLatencyMs.toFixed(2)} ms`)
  expect(performanceSample.dispatchDurationMs).toBeLessThan(50)
  expect(performanceSample.nextFrameLatencyMs).toBeLessThan(34)
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
  await page.goto('./')
  await choosePlace(page)
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

test('a delayed verified heading follows early generic Euler samples without an unverified reading', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'iPhone' })
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone)' })
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 })
    Object.defineProperty(window, 'AbsoluteOrientationSensor', { configurable: true, value: undefined })
    const requestPermission = () => Promise.resolve('granted' as const)
    Object.defineProperty(window, 'DeviceOrientationEvent', {
      configurable: true,
      value: Object.assign(class extends Event {}, { requestPermission }),
    })
  })
  await page.goto('./')
  await choosePlace(page)
  await page.locator('#home-qibla').click()
  await page.getByRole('button', { name: 'Включить компас' }).click()
  await page.evaluate(() => window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
    alpha: 270, beta: 0, gamma: 0, absolute: false,
  })))
  await expect(page.getByRole('status')).toHaveText(/Подключаем компас/)
  await expect(page.locator('.qibla-pointer')).not.toHaveAttribute('data-visible', 'true')
  await page.waitForTimeout(3500)
  await page.evaluate(() => window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
    alpha: 0, beta: 0, gamma: 0, absolute: false, webkitCompassHeading: 75, webkitCompassAccuracy: 5,
  })))
  await expect(page.locator('.qibla-pointer')).toHaveAttribute('data-visible', 'true')
})

test('generic Euler-only acquisition offers explicit recovery after timeout', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'iPhone' })
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone)' })
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 })
    Object.defineProperty(window, 'AbsoluteOrientationSensor', { configurable: true, value: undefined })
    type PermissionWindow = Window & { __qiblaPermissionRequests: number }
    const testWindow = window as PermissionWindow
    testWindow.__qiblaPermissionRequests = 0
    const requestPermission = () => {
      testWindow.__qiblaPermissionRequests += 1
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
  await page.getByRole('button', { name: 'Включить компас' }).click()
  await page.evaluate(() => window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
    alpha: 270, beta: 0, gamma: 0, absolute: true,
  })))
  await page.waitForTimeout(4200)
  await expect(page.getByRole('status')).toHaveText(/Компас не ответил/)
  const retry = page.getByRole('button', { name: 'Попробовать снова' })
  await expect(retry).toBeVisible()
  await retry.click()
  await expect.poll(() => page.evaluate(() => (window as Window & { __qiblaPermissionRequests: number }).__qiblaPermissionRequests)).toBe(2)
  await page.evaluate(() => window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
    alpha: 0, beta: 0, gamma: 0, absolute: false, webkitCompassHeading: 76, webkitCompassAccuracy: 5,
  })))
  await expect(page.locator('.qibla-pointer')).toHaveAttribute('data-visible', 'true')
})

test('a silent Generic Sensor without a WebKit fallback offers a useful retry', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'iPhone' })
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone)' })
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 })
    Object.defineProperty(window, 'DeviceOrientationEvent', { configurable: true, value: undefined })
    type TestWindow = Window & { __qiblaSensorStarts: number }
    const testWindow = window as TestWindow
    testWindow.__qiblaSensorStarts = 0
    class SilentAbsoluteOrientationSensor {
      quaternion = null
      onreading: (() => void) | null = null
      onerror: ((event: Event & { error?: { name?: string } }) => void) | null = null
      start() { testWindow.__qiblaSensorStarts += 1 }
      stop() {}
    }
    Object.defineProperty(window, 'AbsoluteOrientationSensor', { configurable: true, value: SilentAbsoluteOrientationSensor })
  })
  await page.goto('./')
  await choosePlace(page)
  await page.locator('#home-qibla').click()
  await page.getByRole('button', { name: 'Включить компас' }).click()
  await page.waitForTimeout(4200)
  await expect(page.getByRole('status')).toHaveText(/Компас не ответил/)
  const retry = page.getByRole('button', { name: 'Попробовать снова' })
  await expect(retry).toBeVisible()
  await expect(page.locator('.qibla-pointer')).not.toHaveAttribute('data-visible', 'true')
  await retry.click()
  await expect.poll(() => page.evaluate(() => (window as Window & { __qiblaSensorStarts: number }).__qiblaSensorStarts)).toBe(2)
})

test('a platform without an orientation source stays unsupported without retry', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'iPhone' })
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone)' })
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 })
    Object.defineProperty(window, 'AbsoluteOrientationSensor', { configurable: true, value: undefined })
    Object.defineProperty(window, 'DeviceOrientationEvent', { configurable: true, value: undefined })
  })
  await page.goto('./')
  await choosePlace(page)
  await page.locator('#home-qibla').click()
  await page.getByRole('button', { name: 'Включить компас' }).click()
  await expect(page.getByRole('status')).toHaveText(/Живой компас недоступен/)
  await expect(page.getByRole('button', { name: 'Попробовать снова' })).toHaveCount(0)
  await expect(page.locator('.qibla-pointer')).not.toHaveAttribute('data-visible', 'true')
})
