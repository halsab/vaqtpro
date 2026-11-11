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

  await page.locator('#home-settings').click()
  await page.locator('#settings-source').click()
  await page.locator('#source-info').click()
  const sourceInfo = page.getByRole('region', { name: 'Сведения об источнике' })
  await expect(sourceInfo).toContainText(`Место: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`)
  await expect(sourceInfo).not.toContainText('Выберите место')
  for (let step = 0; step < 3; step += 1) await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expectSchedule(page)

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
    ['lang', 'ru'],
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

