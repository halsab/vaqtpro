import { expect, test } from './fixtures'

test('a real BFCache restore rereads another tab’s opt-out without contacting Cloudflare', async ({ context, page }) => {
  const cloudflareRequests: string[] = []
  page.on('request', request => {
    if (new URL(request.url()).hostname.endsWith('cloudflareinsights.com')) cloudflareRequests.push(request.url())
  })
  await page.addInitScript(() => {
    window.addEventListener('pageshow', event => {
      const history = JSON.parse(sessionStorage.getItem('vaqtpro-bfcache-pageshow') ?? '[]') as boolean[]
      history.push(event.persisted)
      sessionStorage.setItem('vaqtpro-bfcache-pageshow', JSON.stringify(history))
    })
  })

  await page.goto('./')
  await expect(page.getByRole('button', { name: 'Настройки' })).toBeVisible()
  await page.goto('./old-timey-mono-license.txt')

  const otherTab = await context.newPage()
  await otherTab.goto('./old-timey-mono-license.txt')
  await otherTab.evaluate(() => localStorage.setItem('vaqtpro.analytics.enabled', 'false'))

  await page.goBack({ waitUntil: 'commit' })
  await expect(page.getByRole('button', { name: 'Настройки' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('vaqtpro.analytics.enabled'))).toBe('false')
  await expect(page.locator('script[data-vaqtpro-cloudflare-analytics]')).toHaveCount(0)
  expect(cloudflareRequests).toEqual([])
  const restoredFromBfcache = await page.evaluate(() =>
    (JSON.parse(sessionStorage.getItem('vaqtpro-bfcache-pageshow') ?? '[]') as boolean[]).includes(true))
  test.skip(!restoredFromBfcache,
    'The route-free history return had pageshow.persisted=false in this browser environment; OFF was honored on the resulting full load, but BFCache restoration is unverified.')
})
