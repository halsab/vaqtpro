import { choosePlace, expect, readSavedSetting, test } from './fixtures'

test('first launch uses the VaqtPro welcome screen without Settings or automatic geolocation', async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as Window & { __geoRequests: number }
    target.__geoRequests = 0
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition: () => { target.__geoRequests += 1 },
    } })
  })
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Выберите место' })).toBeVisible()
  await expect(page.getByText('VaqtPro')).toBeVisible()
  await expect(page.getByText('Выберите город или разрешите доступ к геопозиции, чтобы увидеть время намаза.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Настройки' })).toHaveCount(0)
  await expect(page.locator('.initial-location-landscape')).toHaveCount(0)
  await expect(page.locator('.initial-location-brand img')).toHaveAttribute('src', '/icons/light/icon.svg')
  await expect.poll(() => page.evaluate(() => (window as Window & { __geoRequests: number }).__geoRequests)).toBe(0)
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('seasonal')
  await expect.poll(() => page.locator('.screen-panel').evaluate(element => getComputedStyle(element).borderTopLeftRadius)).toBe('0px')
  await page.getByRole('button', { name: 'Найти город' }).click()
  await expect(page.getByRole('region', { name: 'Поиск города' })).toBeVisible()
  await expect.poll(() => page.locator('.screen-panel').evaluate(element => getComputedStyle(element).borderTopLeftRadius)).toBe('38px')
  await expect.poll(() => page.locator('.screen-panel').evaluate(element => getComputedStyle(element).borderBottomLeftRadius)).toBe('0px')
})

test('prepaints the Seasonal default and an explicitly cached Classic theme before app startup', async ({ page }) => {
  await page.route('**/assets/index-*.js', route => route.abort())
  await page.emulateMedia({ colorScheme: 'light' })
  await page.addInitScript(() => localStorage.removeItem('salah-theme-preference-v1'))
  await page.goto('./')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'seasonal')
  const seasonal = await page.locator('html').evaluate(element => ({
    background: getComputedStyle(element).getPropertyValue('--background-primary').trim(),
    themeColor: document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content,
  }))
  expect(seasonal.background).not.toBe('#000000')
  expect(seasonal.themeColor).toBe(seasonal.background)

  const seasonalDarkPage = await page.context().newPage()
  await seasonalDarkPage.route('**/assets/index-*.js', route => route.abort())
  await seasonalDarkPage.emulateMedia({ colorScheme: 'dark' })
  await seasonalDarkPage.addInitScript(() => localStorage.removeItem('salah-theme-preference-v1'))
  await seasonalDarkPage.goto('./')
  const seasonalDark = await seasonalDarkPage.locator('html').evaluate(element => ({
    tone: getComputedStyle(element).colorScheme,
    background: getComputedStyle(element).getPropertyValue('--background-primary').trim(),
    secondary: getComputedStyle(element).getPropertyValue('--background-secondary').trim(),
    themeColor: document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content,
  }))
  expect(seasonalDark.tone).toBe('dark')
  expect(seasonalDark.background).not.toBe('#000000')
  expect(seasonalDark.secondary).not.toBe('#282828')
  expect(seasonalDark.themeColor).toBe(seasonalDark.background)

  const classicPage = await page.context().newPage()
  await classicPage.route('**/assets/index-*.js', route => route.abort())
  await classicPage.emulateMedia({ colorScheme: 'dark' })
  await classicPage.addInitScript(() => localStorage.setItem('salah-theme-preference-v1', JSON.stringify({ version: 1, themeFamily: 'classic' })))
  await classicPage.goto('./')
  await expect(classicPage.locator('html')).toHaveAttribute('data-theme', 'classic')
  const classic = await classicPage.locator('html').evaluate(element => ({
    background: getComputedStyle(element).getPropertyValue('--background-primary').trim(),
    secondary: getComputedStyle(element).getPropertyValue('--background-secondary').trim(),
    themeColor: document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content,
  }))
  expect(classic).toEqual({ background: '#000000', secondary: '#282828', themeColor: '#000000' })
})

test('prepaints the light Seasonal palette when matchMedia is missing or throws', async ({ page }) => {
  for (const behavior of ['missing', 'throws'] as const) {
    const casePage = behavior === 'missing' ? page : await page.context().newPage()
    await casePage.route('**/assets/index-*.js', route => route.abort())
    await casePage.addInitScript(mode => {
      if (mode === 'missing') Object.defineProperty(window, 'matchMedia', { configurable: true, value: undefined })
      else Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => { throw new Error('unsupported') } })
      localStorage.removeItem('salah-theme-preference-v1')
    }, behavior)
    const errors: string[] = []
    casePage.on('pageerror', error => errors.push(error.message))
    await casePage.goto('./')
    const prepaint = await casePage.locator('html').evaluate(element => ({
      family: element.dataset.theme,
      tone: element.dataset.themeTone,
      palette: {
        background: getComputedStyle(element).getPropertyValue('--background-primary').trim(),
        secondary: getComputedStyle(element).getPropertyValue('--background-secondary').trim(),
        tertiary: getComputedStyle(element).getPropertyValue('--background-tertiary').trim(),
        text: getComputedStyle(element).getPropertyValue('--text-primary').trim(),
        secondaryText: getComputedStyle(element).getPropertyValue('--text-secondary').trim(),
        countdown: getComputedStyle(element).getPropertyValue('--accent-countdown').trim(),
      },
      themeColor: document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content,
    }))
    expect(prepaint).toEqual({
      family: 'seasonal',
      tone: 'light',
      palette: {
        background: '#D6B29B',
        secondary: '#F7F1EC',
        tertiary: '#DFD0C5',
        text: '#2E2622',
        secondaryText: '#655750',
        countdown: '#8A5033',
      },
      themeColor: '#D6B29B',
    })
    expect(errors).toEqual([])
  }
})

test('keeps initial location keyboard clearance when returning from city search in a constrained viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 480 })
  await page.goto('./')
  await page.getByRole('button', { name: 'Найти город' }).click()
  await page.getByRole('searchbox').focus()
  await page.locator('.app-layout').evaluate(element => element.style.setProperty('--app-keyboard-inset', '240px'))
  await page.getByRole('button', { name: 'Отмена' }).click()
  const geometry = await page.locator('.initial-location-content').evaluate(element => ({
    bottomPadding: getComputedStyle(element).paddingBottom,
    contentHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    viewportWidth: document.documentElement.clientWidth,
  }))
  expect(geometry.bottomPadding).toBe('256px')
  expect(geometry.scrollHeight).toBeGreaterThan(geometry.contentHeight)
  expect(geometry.viewportWidth).toBe(320)
})

test('initial low-accuracy GPS stays provisional until explicit acceptance', async ({ context, page }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 41.01, longitude: 28.95, accuracy: 2400 })
  await page.goto('./')
  await page.getByRole('button', { name: 'По геопозиции' }).click()

  await expect(page.getByRole('heading', { name: 'Выберите место' })).toBeVisible()
  await expect(page.getByText('41.0100, 28.9500')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Использовать эту точку' })).toBeVisible()
  await expect(page.getByRole('timer')).toHaveCount(0)
  await expect.poll(() => readSavedSetting(page, 'locationChoice')).toBeUndefined()
  await expect.poll(() => readSavedSetting(page, 'recentPlaces')).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ selection: 'gps', latitude: 41.01, longitude: 28.95 }),
  ]))

  await page.getByRole('button', { name: 'Использовать эту точку' }).click()
  await expect(page.getByRole('region', { name: 'Главная', exact: true })).toBeVisible()
  await expect(page.getByRole('timer')).toBeVisible()
  await expect.poll(() => readSavedSetting(page, 'locationChoice')).toMatchObject({
    place: { selection: 'gps', latitude: 41.01, longitude: 28.95, accuracy: 2400 },
  })
})

test('search cancels delayed unaccepted GPS callbacks', async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as Window & { __gpsCallbacks: Array<(position: GeolocationPosition) => void> }
    target.__gpsCallbacks = []
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: {
      query: () => Promise.resolve({ state: 'granted', onchange: null }),
    } })
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition: (success: (position: GeolocationPosition) => void) => target.__gpsCallbacks.push(success),
    } })
  })
  await page.goto('./')
  await choosePlace(page)
  const confirmed = await readSavedSetting(page, 'locationChoice')
  await page.locator('#home-location').click()
  await page.getByRole('button', { name: 'По геопозиции' }).click()
  await expect.poll(() => page.evaluate(() => (window as Window & { __gpsCallbacks: unknown[] }).__gpsCallbacks.length)).toBe(2)
  await page.evaluate(() => {
    const target = window as Window & { __gpsCallbacks: Array<(position: GeolocationPosition) => void> }
    target.__gpsCallbacks[0]({
      coords: { latitude: 41.01, longitude: 28.95, accuracy: 2400, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
      timestamp: Date.now(),
    })
  })
  await expect(page.getByText('41.0100, 28.9500')).toBeVisible()

  await page.getByRole('button', { name: 'Найти город' }).click()
  const search = page.getByRole('searchbox')
  await search.fill('Москва')
  await page.evaluate(() => {
    const target = window as Window & { __gpsCallbacks: Array<(position: GeolocationPosition) => void> }
    target.__gpsCallbacks[1]({
      coords: { latitude: 41.011, longitude: 28.951, accuracy: 15, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
      timestamp: Date.now(),
    })
  })

  await expect(search).toHaveValue('Москва')
  await expect(page.getByRole('region', { name: 'Поиск города' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Главная', exact: true })).toHaveCount(0)
  await expect.poll(() => readSavedSetting(page, 'locationChoice')).toEqual(confirmed)
  await expect.poll(() => readSavedSetting(page, 'recentPlaces')).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ selection: 'gps', latitude: 41.01, longitude: 28.95 }),
  ]))
})

test('denied GPS leaves initial location selection available', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: {
      query: () => Promise.resolve({ state: 'granted', onchange: null }),
    } })
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition: (_success: unknown, error: (failure: GeolocationPositionError) => void) => error({
        code: 1, message: 'denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3,
      }),
    } })
  })
  await page.goto('./')
  await page.getByRole('button', { name: 'По геопозиции' }).click()
  await expect(page.getByRole('heading', { name: 'Выберите место' })).toBeVisible()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Найти город' })).toBeVisible()
  await expect(page.getByRole('timer')).toHaveCount(0)
  await expect.poll(() => readSavedSetting(page, 'locationChoice')).toBeUndefined()
})

test('opening city search from initial place selection cancels delayed GPS callbacks', async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as Window & { __gpsCallbacks: Array<(position: GeolocationPosition) => void> }
    target.__gpsCallbacks = []
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: {
      query: () => Promise.resolve({ state: 'granted', onchange: null }),
    } })
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition: (success: (position: GeolocationPosition) => void) => target.__gpsCallbacks.push(success),
    } })
  })
  await page.goto('./')
  await page.getByRole('button', { name: 'По геопозиции' }).click()
  await expect.poll(() => page.evaluate(() => (window as Window & { __gpsCallbacks: unknown[] }).__gpsCallbacks.length)).toBe(2)
  await page.evaluate(() => {
    const target = window as Window & { __gpsCallbacks: Array<(position: GeolocationPosition) => void> }
    target.__gpsCallbacks[0]({
      coords: { latitude: 41.01, longitude: 28.95, accuracy: 2400, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
      timestamp: Date.now(),
    })
  })
  await expect(page.getByText('41.0100, 28.9500')).toBeVisible()
  await page.getByRole('button', { name: 'Найти город' }).click()
  await expect(page.getByRole('region', { name: 'Поиск города' })).toBeVisible()
  const savedChoice = await readSavedSetting(page, 'locationChoice')
  const savedHistory = await readSavedSetting(page, 'recentPlaces')
  await page.evaluate(() => {
    const target = window as Window & { __gpsCallbacks: Array<(position: GeolocationPosition) => void> }
    target.__gpsCallbacks[1]({
      coords: { latitude: 41.011, longitude: 28.951, accuracy: 10, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
      timestamp: Date.now(),
    })
  })
  await expect(page.getByRole('region', { name: 'Поиск города' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Главная', exact: true })).toHaveCount(0)
  await expect.poll(() => readSavedSetting(page, 'locationChoice')).toEqual(savedChoice)
  await expect.poll(() => readSavedSetting(page, 'recentPlaces')).toEqual(savedHistory)
})

test('GPS refinement retains its snapshot identity across tab changes and offline recall', async ({ context, page }) => {
  await page.addInitScript(() => {
    const target = window as Window & { __gpsCallbacks: Array<(position: GeolocationPosition) => void> }
    target.__gpsCallbacks = []
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: {
      query: () => Promise.resolve({ state: 'granted', onchange: null }),
    } })
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition: (success: (position: GeolocationPosition) => void) => target.__gpsCallbacks.push(success),
    } })
  })
  await page.goto('./')
  await choosePlace(page)
  await page.locator('#home-location').click()
  await page.getByRole('button', { name: 'По геопозиции' }).click()
  await expect.poll(() => page.evaluate(() => (window as Window & { __gpsCallbacks: unknown[] }).__gpsCallbacks.length)).toBe(2)
  const capturedAt = await page.evaluate(() => Date.now() - 1000)
  await page.evaluate(timestamp => {
    const target = window as Window & { __gpsCallbacks: Array<(position: GeolocationPosition) => void> }
    target.__gpsCallbacks[0]({ coords: { latitude: 41.01, longitude: 28.95, accuracy: 500, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp })
  }, capturedAt)
  await expect.poll(() => readSavedSetting(page, 'recentPlaces')).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'gps:history:41.010000:28.950000', latitude: 41.01, accuracy: 500, timestamp: capturedAt }),
  ]))
  await page.evaluate(timestamp => {
    const target = window as Window & { __gpsCallbacks: Array<(position: GeolocationPosition) => void> }
    target.__gpsCallbacks[1]({ coords: { latitude: 41.03, longitude: 28.95, accuracy: 10, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp })
  }, capturedAt + 1)
  await expect.poll(() => readSavedSetting(page, 'recentPlaces')).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'gps:history:41.010000:28.950000', latitude: 41.03, accuracy: 10, timestamp: capturedAt + 1 }),
  ]))
  await page.locator('#home-location').click()
  await page.getByRole('button', { name: 'По геопозиции' }).click()
  await expect.poll(() => page.evaluate(() => (window as Window & { __gpsCallbacks: unknown[] }).__gpsCallbacks.length)).toBe(4)
  await page.evaluate(timestamp => {
    const target = window as Window & { __gpsCallbacks: Array<(position: GeolocationPosition) => void> }
    target.__gpsCallbacks[2]({ coords: { latitude: 41.01, longitude: 28.95, accuracy: 500, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp })
  }, capturedAt + 2)
  await expect.poll(() => readSavedSetting(page, 'recentPlaces')).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'gps:history:41.010000:28.950000:recovered:1', latitude: 41.01 }),
  ]))
  // Настоящие страницы делят IndexedDB и получают browser storage events.
  const otherTab = await context.newPage()
  await otherTab.clock.setFixedTime(new Date(capturedAt + 1000))
  await otherTab.goto('./')
  await expect(otherTab.getByRole('heading', { name: 'Приложение уже открыто' })).toBeVisible()
  await otherTab.getByRole('button', { name: 'Продолжить здесь' }).click()
  await expect(otherTab.locator('[data-execution-owner]')).toBeVisible()
  await choosePlace(otherTab, 'Москва', 'Москва, Москва, Россия')
  await expect(page.getByRole('heading', { name: 'Приложение уже открыто' })).toBeVisible()
  const latestHistory = await readSavedSetting(otherTab, 'recentPlaces')
  await page.evaluate(timestamp => {
    const target = window as Window & { __gpsCallbacks: Array<(position: GeolocationPosition) => void> }
    target.__gpsCallbacks[3]({ coords: { latitude: 42, longitude: 30, accuracy: 10, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp })
  }, capturedAt + 3)
  await expect.poll(() => readSavedSetting(otherTab, 'recentPlaces')).toEqual(latestHistory)
  await otherTab.close()
  await page.getByRole('button', { name: 'Продолжить здесь' }).click()
  await expect(page.locator('[data-execution-owner]')).toBeVisible()
  await page.evaluate(async () => navigator.serviceWorker.ready)
  await context.setOffline(true)
  try {
    await page.locator('#home-location').click()
    await page.getByRole('button', { name: /(?:Точка|· GPS), 41\.0300, 28\.9500$/ }).click()
    await expect.poll(() => readSavedSetting(page, 'locationChoice')).toMatchObject({ place: {
      id: 'gps:history:41.010000:28.950000', latitude: 41.03, longitude: 28.95, accuracy: 10, timestamp: capturedAt + 1,
    } })
    expect(await page.evaluate(() => (window as Window & { __gpsCallbacks: unknown[] }).__gpsCallbacks.length)).toBe(4)
  } finally {
    await context.setOffline(false)
  }
})


test('restores a GPS city name containing commas from local history while offline', async ({ context, page }) => {
  await page.goto('./')
  await choosePlace(page)
  await expect.poll(async () => (await readSavedSetting(page, 'recentPlaces') as unknown[] | undefined)?.length).toBe(1)
  const history = await readSavedSetting(page, 'recentPlaces') as Array<Record<string, unknown>>
  expect(history).toHaveLength(1)
  const point = {
    ...history[0],
    id: 'gps:history:55.750000:37.610000',
    selection: 'gps',
    name: 'Остров, Северный',
    region: null, coverage: 'unavailable',
    latitude: 55.75, longitude: 37.61, accuracy: 20, timestamp: Date.now(),
    nearbyCity: {
      id: 123, name: 'Остров, Северный, Регион, Россия',
      cityName: 'Остров, Северный', distanceKm: 0,
      countryCode: 'RU', latitude: 55.75, longitude: 37.61,
    },
    automaticTimeZone: { id: 'Europe/Moscow', source: 'device' },
    timeZone: 'Europe/Moscow',
  }
  // GPS captures must not inherit a selected city's catalog identity.
  delete point.cityId
  delete point.cityName
  // Seed exactly the persisted shape. No catalog request or live location acquisition
  // should be needed to restore the metadata.
  await page.evaluate(async entries => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('salah')
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
      request.onsuccess = () => {
        const db = request.result
        const transaction = db.transaction('settings', 'readwrite')
        transaction.objectStore('settings').put({ key: 'recentPlaces', value: entries })
        transaction.oncomplete = () => { db.close(); resolve() }
        transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('IndexedDB write failed')) }
      }
    })
  }, [history[0], point])

  await page.evaluate(async () => navigator.serviceWorker.ready)
  await page.reload()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  await context.setOffline(true)
  try {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('#home-location').click()
    const row = page.getByRole('button', { name: 'Остров, Северный · GPS, 55.7500, 37.6100' })
    await expect(row).toBeVisible()
    await row.focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => readSavedSetting(page, 'locationChoice')).toMatchObject({
      place: { id: 'gps:history:55.750000:37.610000', selection: 'gps',
        latitude: 55.75, longitude: 37.61,
        nearbyCity: { cityName: 'Остров, Северный' } },
    })
  } finally {
    await context.setOffline(false)
  }
})


test('disambiguates same-name manual history only while both rows are visible, at 320px and offline', async ({ context, page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await page.goto('./')
  await choosePlace(page)
  await expect.poll(async () => (await readSavedSetting(page, 'recentPlaces') as unknown[] | undefined)?.length).toBe(1)
  const history = await readSavedSetting(page, 'recentPlaces') as Array<Record<string, unknown>>
  const original = history[0]
  const first = {
    ...original, id: 'geonames:9110001', cityId: 9110001, selection: 'city',
    name: 'Киров, Новый, Регион А, Россия', cityName: 'Киров, Новый',
    region: { code: 'RU.48', name: 'Регион А' }, coverage: 'outside',
    latitude: 55.5, longitude: 49.5, timestamp: 10,
  }
  const second = {
    ...original, id: 'geonames:9110002', cityId: 9110002, selection: 'city',
    name: 'Киров, Новый, Регион Б, Россия', cityName: 'Киров, Новый',
    region: { code: 'RU.48', name: 'Регион Б' }, coverage: 'outside',
    latitude: 56.5, longitude: 48.5, timestamp: 20,
  }
  await page.evaluate(async entries => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('salah')
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
      request.onsuccess = () => {
        const db = request.result
        const transaction = db.transaction('settings', 'readwrite')
        transaction.objectStore('settings').put({ key: 'recentPlaces', value: entries })
        transaction.oncomplete = () => { db.close(); resolve() }
        transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('IndexedDB write failed')) }
      }
    })
  }, [original, first, second])
  await page.evaluate(async () => navigator.serviceWorker.ready)
  await page.reload()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)

  await context.setOffline(true)
  try {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('#home-location').click()
    const recent = page.getByRole('region', { name: 'Недавние места' })
    const a = recent.getByRole('button', { name: 'Киров, Новый, Регион А' })
    const b = recent.getByRole('button', { name: 'Киров, Новый, Регион Б' })
    await expect(a).toBeVisible()
    await expect(b).toBeVisible()
    await expect(recent.getByRole('button', { name: 'Казань' })).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await b.focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => readSavedSetting(page, 'locationChoice')).toMatchObject({
      place: { id: 'geonames:9110002', cityId: 9110002, cityName: 'Киров, Новый',
        latitude: 56.5, longitude: 48.5 },
    })
    await expect(page.getByRole('region', { name: 'Главная', exact: true })).toBeVisible()
    await page.locator('#home-location').click()
    const historyAfter = page.getByRole('region', { name: 'Недавние места' })
    // Collision is gone because the newly selected place is excluded.
    await expect(historyAfter.getByRole('button', { name: 'Киров, Новый', exact: true })).toBeVisible()
    await expect(historyAfter.getByRole('button', { name: 'Киров, Новый, Регион А' })).toHaveCount(0)
  } finally {
    await context.setOffline(false)
  }
})
