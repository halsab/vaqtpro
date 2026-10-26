import { resolve, sep } from 'node:path'
import { choosePlace, expectSchedule, readSavedSetting, expect, test } from './fixtures'

test('the production-like beacon stays silent after another tab saves OFF and history returns', async ({ context, page }) => {
  const rumRequests: { url: string; method: string; body: string | null }[] = []
  const restoredStates: boolean[] = []
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.hostname === 'static.cloudflareinsights.com' || url.hostname === 'cloudflareinsights.com') {
      if (url.hostname === 'cloudflareinsights.com' && url.pathname === '/cdn-cgi/rum') {
        rumRequests.push({ url: url.href, method: route.request().method(), body: route.request().postData() })
      }
      await route.continue()
      return
    }
    if (url.hostname !== 'vaqt.pro') {
      await route.abort()
      return
    }
    if (url.pathname === '/away.html') {
      await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Away</title><main>Away</main>' })
      return
    }
    const relativePath = decodeURIComponent(url.pathname.slice(1) || 'index.html')
    const file = resolve('dist', relativePath)
    if (!file.startsWith(`${resolve('dist')}${sep}`) && file !== resolve('dist', 'index.html')) {
      await route.abort()
      return
    }
    try { await route.fulfill({ path: file }) }
    catch { await route.fulfill({ path: resolve('dist/index.html') }) }
  })
  await page.addInitScript(() => {
    localStorage.setItem('vaqtpro-privacy-probe', JSON.stringify({
      city: 'CF_TEST_CITY_72F94', search: 'CF_TEST_SEARCH_72F94',
      gps: [61.221, 55.159], prayerTimes: 'CF_TEST_SCHEDULE_72F94', preferences: 'CF_TEST_PREFERENCES_72F94',
    }))
  })
  await page.addInitScript(() => {
    window.addEventListener('pageshow', event => {
      const history = JSON.parse(sessionStorage.getItem('vaqtpro-bfcache-pageshow') ?? '[]') as boolean[]
      history.push(event.persisted)
      sessionStorage.setItem('vaqtpro-bfcache-pageshow', JSON.stringify(history))
    })
  })

  const latitude = 55.812345
  const longitude = 49.123456
  await context.grantPermissions(['geolocation'], { origin: 'https://vaqt.pro' })
  await context.setGeolocation({ latitude, longitude, accuracy: 15 })
  await page.goto('https://vaqt.pro/')
  await expect(page.getByRole('heading', { name: 'Выберите место' })).toBeVisible()
  await expect(page.locator('script[data-vaqtpro-cloudflare-analytics]')).toHaveCount(1)
  await expect.poll(() => rumRequests.length).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'По геопозиции' }).click()
  await expectSchedule(page)
  await expect.poll(() => readSavedSetting(page, 'locationChoice')).toMatchObject({
    place: { selection: 'gps', latitude, longitude, accuracy: 15 },
  })
  await choosePlace(page, 'Казань', /Казань/)
  const renderedPrayerSchedule = await page.getByRole('list', { name: 'Расписание дня' }).innerText()
  await page.goto('https://vaqt.pro/away.html')
  await expect.poll(() => rumRequests.filter(request => request.method === 'POST').length).toBeGreaterThan(0)
  const requestsAfterPageExit = rumRequests.length

  const otherTab = await context.newPage()
  await otherTab.goto('https://vaqt.pro/away.html')
  await otherTab.evaluate(() => localStorage.setItem('vaqtpro.analytics.enabled', 'false'))

  await page.goBack({ waitUntil: 'commit' })
  await expect(page.getByRole('button', { name: 'Настройки' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('vaqtpro.analytics.enabled'))).toBe('false')
  await expect(page.locator('script[data-vaqtpro-cloudflare-analytics]')).toHaveCount(0)
  expect(rumRequests).toHaveLength(requestsAfterPageExit)
  const restoredFromBfcache = await page.evaluate(() =>
    (JSON.parse(sessionStorage.getItem('vaqtpro-bfcache-pageshow') ?? '[]') as boolean[]).includes(true))
  restoredStates.push(restoredFromBfcache)

  await page.reload()
  await expect(page.getByRole('button', { name: 'Настройки' })).toBeVisible()
  await expect(page.locator('script[data-vaqtpro-cloudflare-analytics]')).toHaveCount(0)
  expect(rumRequests).toHaveLength(requestsAfterPageExit)
  expect(rumRequests.every(request => request.url === 'https://cloudflareinsights.com/cdn-cgi/rum')).toBe(true)
  const officialPayloads = rumRequests.filter(request => request.method === 'POST' && request.body !== null)
    .map(request => request.body as string)
  expect(officialPayloads.length).toBeGreaterThan(0)
  expect(officialPayloads.some(body => body.includes('"location":"https://vaqt.pro/"'))).toBe(true)
  for (const payload of officialPayloads) {
    expect(payload).not.toContain('/data/cities/')
    expect(payload).not.toContain('"referrer"')
    expect(payload).not.toContain('"selector"')
    expect(payload).not.toMatch(/"(?:clientId|userId|installId|fingerprint)"\s*:/i)
    for (const sentinel of ['CF_TEST_CITY_72F94', 'CF_TEST_SEARCH_72F94', '55.812345', '49.123456',
      '55.812', '49.123', 'Казань', 'CF_TEST_SCHEDULE_72F94', 'CF_TEST_PREFERENCES_72F94']) {
      expect(payload).not.toContain(sentinel)
    }
    expect(payload).not.toContain(renderedPrayerSchedule)
  }

  test.skip(!restoredStates[0],
    'WebKit did not restore the app document from BFCache in this run. Cross-tab OFF and persisted-OFF request suppression passed, but BFCache verification is unavailable.')
})
