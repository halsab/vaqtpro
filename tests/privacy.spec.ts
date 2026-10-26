import { choosePlace, expectSchedule, readSavedSetting, expect, test } from './fixtures'

test('геопозиция остаётся локальной и не отправляет координаты', async ({ context, page }) => {
  const latitude = 55.812345
  const longitude = 49.123456
  const requests: { url: string; body: string }[] = []
  context.on('request', request => requests.push({ url: request.url(), body: request.postData() ?? '' }))
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude, longitude, accuracy: 15 })

  await page.goto('./')
  await page.getByRole('button', { name: 'По геопозиции' }).click()
  await expectSchedule(page)
  await expect.poll(() => readSavedSetting(page, 'locationChoice'))
    .toMatchObject({ place: { selection: 'gps', latitude, longitude, accuracy: 15 } })

  await choosePlace(page, 'Казань', /Казань/)
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
  expect(requests.filter(({ url }) => new URL(url).origin !== appOrigin)).toEqual([])
  expect(requests.some(({ url }) => /cloudflareinsights\.com/.test(url))).toBe(false)
  const payloads = requests.map(({ url, body }) => `${url} ${body}`).join('\n')
  for (const coordinate of [latitude, longitude]) {
    for (const value of [String(coordinate), coordinate.toFixed(3), coordinate.toFixed(4)]) {
      expect(payloads).not.toContain(value)
    }
  }
  expect(payloads).not.toMatch(/nominatim/i)
})

test('список из десяти мест остаётся доступным на узком экране', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await page.goto('./')
  await expect(page.getByRole('button', { name: 'Найти город' })).toBeVisible()
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
  await expect(page.getByRole('button', { name: 'Найти город' })).toBeVisible()
  const recent = page.getByRole('region', { name: 'Недавние места' })
  await expect(recent.getByRole('button', { name: /^Место / })).toHaveCount(10)
  const lastPlace = recent.getByRole('button', { name: 'Место 9' })
  await lastPlace.scrollIntoViewIfNeeded()
  await expect(lastPlace).toBeVisible()
  await lastPlace.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: 'Главная', exact: true })).toBeVisible()
})
