import { choosePlace, expectSchedule, readSavedSetting, expect, test } from './fixtures'

test('GPS coordinates are disclosed only to the approved GeoNames reverse lookup after user action', async ({ context, page }) => {
  const latitude = 55.812345
  const longitude = 49.123456
  const requests: { url: string; body: string }[] = []
  context.on('request', request => requests.push({ url: request.url(), body: request.postData() ?? '' }))
  // No named settlement is available in this scenario: retain the original GPS fix.
  // Keep the reverse response deterministic; never send test coordinates to the live service.
  await context.route('https://secure.geonames.org/findNearbyPlaceNameJSON**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ geonames: [] }),
    })
  })
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude, longitude, accuracy: 15 })

  await page.goto('./')
  await page.getByRole('button', { name: 'По геопозиции' }).click()
  await expectSchedule(page)
  await expect.poll(() => readSavedSetting(page, 'locationChoice'))
    .toMatchObject({ place: { selection: 'gps', latitude, longitude, accuracy: 15 } })
  expect(requests.some(({ url }) => url.startsWith('https://secure.geonames.org/searchJSON'))).toBe(false)

  await choosePlace(page, 'Облово', /Облово, Тверская Область, Россия/)
  const recentBeforeRecall = await readSavedSetting(page, 'recentPlaces')
  expect(recentBeforeRecall).toEqual(expect.arrayContaining([expect.objectContaining({ selection: 'gps', latitude, longitude, accuracy: 15 })]))
  await page.evaluate(async () => navigator.serviceWorker.ready)
  await context.setOffline(true)
  try {
    await page.locator('#home-location').click()
    const savedPoint = page.getByRole('button', { name: new RegExp(`(?:Точка|· GPS), ${latitude.toFixed(4)}, ${longitude.toFixed(4)}$`) })
    await expect(savedPoint).toBeVisible()
    await savedPoint.click()
    await page.locator('#home-location').click()
    await expect(page.locator('.location-coordinates')).toHaveText(`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`)
    await expect.poll(() => readSavedSetting(page, 'locationChoice'))
      .toMatchObject({ place: { selection: 'gps', latitude, longitude, accuracy: 15 } })
  } finally {
    await context.setOffline(false)
  }

  const appOrigin = new URL(page.url()).origin
  const externalRequests = requests.filter(({ url }) => new URL(url).origin !== appOrigin)
  expect(externalRequests).toHaveLength(2)
  const reverseRequests = externalRequests.filter(({ url }) => new URL(url).pathname === '/findNearbyPlaceNameJSON')
  const searchRequests = externalRequests.filter(({ url }) => new URL(url).pathname === '/searchJSON')
  expect(reverseRequests).toHaveLength(1)
  expect(searchRequests).toHaveLength(1)
  expect(externalRequests.every(({ url }) => new URL(url).origin === 'https://secure.geonames.org')).toBe(true)

  const reverseRequest = new URL(reverseRequests[0]?.url ?? 'https://invalid.local')
  expect([...reverseRequest.searchParams.entries()].slice(0, -1)).toEqual([
    ['lat', String(latitude)],
    ['lng', String(longitude)],
    ['radius', '25'],
    ['maxRows', '100'],
    ['style', 'FULL'],
  ])
  expect(reverseRequest.searchParams.get('username')).toBeTruthy()
  expect(reverseRequests[0]?.body).toBe('')

  const searchRequest = new URL(searchRequests[0]?.url ?? 'https://invalid.local')
  expect([...searchRequest.searchParams.entries()].slice(0, -1)).toEqual([
    ['name_startsWith', 'Облово'],
    ['maxRows', '100'],
    ['featureClass', 'P'],
    ['orderby', 'relevance'],
    ['lang', 'ru'],
    ['style', 'FULL'],
    ['type', 'json'],
  ])
  expect(searchRequest.searchParams.get('username')).toBeTruthy()
  expect(requests.some(({ url }) => /cloudflareinsights\.com/.test(url))).toBe(false)
  const searchPayloads = searchRequests.map(({ url, body }) => `${url} ${body}`).join('\n')
  for (const coordinate of [latitude, longitude]) {
    for (const value of [String(coordinate), coordinate.toFixed(3), coordinate.toFixed(4)]) {
      expect(searchPayloads).not.toContain(value)
    }
  }
  const payloads = requests.map(({ url, body }) => `${url} ${body}`).join('\n')
  expect(payloads).not.toMatch(/nominatim|accuracy=|timestamp=|recentPlaces=|locationChoice=/i)
})

test('список из десяти мест остаётся доступным на узком экране', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await page.goto('./')
  await expect(page.getByRole('button', { name: 'Найти место' })).toBeVisible()
  const places = Array.from({ length: 10 }, (_, index) => ({
    id: `locality:history-${index}`,
    selection: 'official',
    name: `Место ${index}`,
    latitude: 40 + index / 100,
    longitude: 30 + index / 100,
    accuracy: null,
    timestamp: index + 1,
    timeZone: 'Europe/Moscow',
    automaticTimeZone: { id: 'Europe/Moscow', source: 'city' },
    region: null,
    coverage: 'outside',
  }))
  await page.evaluate(async recentPlaces => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('salah')
      request.onerror = () => reject(request.error ?? new Error('Не удалось открыть IndexedDB'))
      request.onsuccess = () => resolve(request.result)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('settings', 'readwrite')
      transaction.objectStore('settings').put({ key: 'recentPlaces', value: recentPlaces })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Не удалось сохранить историю'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Сохранение истории прервано'))
    })
    database.close()
  }, places)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Найти место' })).toBeVisible()
  const recent = page.getByRole('region', { name: 'Недавние места' })
  await expect(recent.getByRole('button', { name: /^Место / })).toHaveCount(10)
  const lastPlace = recent.getByRole('button', { name: 'Место 9' })
  await lastPlace.scrollIntoViewIfNeeded()
  await expect(lastPlace).toBeVisible()
  await lastPlace.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: 'Главная', exact: true })).toBeVisible()
})
