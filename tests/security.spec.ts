import { expect, test } from './fixtures'
import { createHash } from 'node:crypto'

const CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "script-src 'self' https://static.cloudflareinsights.com",
  "style-src 'self'",
  "style-src-elem 'self'",
  "style-src-attr 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self'",
  "connect-src 'self' https://cloudflareinsights.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-src 'none'",
  "media-src 'none'",
  "form-action 'none'",
].join('; ')

interface CspViolation {
  blockedUri: string
  directive: string
}

test('production CSP allows the app and blocks a third-party connection', async ({ page, request }) => {
  const response = await request.get('./')
  expect(response.ok()).toBe(true)
  const html = await response.text()
  const tags = html.match(/<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi) ?? []
  expect(tags).toHaveLength(1)
  const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
  expect(bootstrap).toBeTruthy()
  const bootstrapHash = createHash('sha256').update(bootstrap ?? '').digest('base64')
  const expectedCsp = CSP.replace(
    "script-src 'self' https://static.cloudflareinsights.com",
    `script-src 'self' https://static.cloudflareinsights.com 'sha256-${bootstrapHash}'`,
  )
  const firstResourceTag = html.search(/<(?:script|link)\b/i)
  expect(html.indexOf(tags[0])).toBeLessThan(firstResourceTag)

  await page.addInitScript(() => {
    const runtimeWindow = window as Window & { __cspViolations?: CspViolation[] }
    runtimeWindow.__cspViolations = []
    document.addEventListener('securitypolicyviolation', event => {
      runtimeWindow.__cspViolations?.push({
        blockedUri: event.blockedURI,
        directive: event.effectiveDirective,
      })
    })
  })

  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto('./')
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]'))
    .toHaveAttribute('content', expectedCsp)
  expect(CSP).toContain('script-src \'self\' https://static.cloudflareinsights.com')
  expect(CSP).toContain('connect-src \'self\' https://cloudflareinsights.com')
  await expect(page.getByRole('button', { name: 'По геопозиции' })).toBeVisible()

  const blockedUrl = 'https://example.invalid/csp-probe'
  await expect.poll(() => page.evaluate(async url => {
    try {
      await fetch(url)
      return false
    } catch {
      return true
    }
  }, blockedUrl)).toBe(true)
  await expect.poll(() => page.evaluate(() => (
    (window as Window & { __cspViolations?: CspViolation[] }).__cspViolations ?? []
  ))).toContainEqual({ blockedUri: blockedUrl, directive: 'connect-src' })
  expect(pageErrors).toEqual([])
})
