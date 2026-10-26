import { resolve, sep } from 'node:path'
import type { BrowserContext, Page } from '@playwright/test'
import { expect, test } from './fixtures'

test.use({ serviceWorkers: 'block' })

const productionRequests: string[] = []

async function useProductionOrigin(context: BrowserContext) {
  productionRequests.length = 0
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.hostname === 'vaqt.pro' && url.pathname === '/away.html') {
      await route.fulfill({ contentType: 'text/html', headers: { 'cache-control': 'public, max-age=3600' }, body: '<!doctype html><title>Away</title><main>Вне приложения</main>' })
      return
    }
    if (url.hostname === 'static.cloudflareinsights.com') {
      productionRequests.push(url.href)
      await route.fulfill({ contentType: 'text/javascript', body: `
        window.__cloudflareBeaconLoaded = true;
        const sendControlledPageLoad = () => fetch('https://cloudflareinsights.com/cdn-cgi/rum', {
          method: 'POST', body: JSON.stringify({ url: location.href, referrer: document.referrer }),
        }).catch(() => {});
        sendControlledPageLoad();
        document.addEventListener('visibilitychange', sendControlledPageLoad);
      ` })
      return
    }
    if (url.hostname === 'cloudflareinsights.com') {
      productionRequests.push(url.href)
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': 'https://vaqt.pro' } })
      return
    }
    if (url.hostname !== 'vaqt.pro') {
      await route.abort()
      return
    }
    const relativePath = decodeURIComponent(url.pathname.slice(1) || 'index.html')
    const file = resolve('dist', relativePath)
    if (!file.startsWith(`${resolve('dist')}${sep}`) && file !== resolve('dist', 'index.html')) {
      await route.abort()
      return
    }
    try {
      await route.fulfill({ path: file, headers: { 'cache-control': 'public, max-age=3600' } })
    } catch {
      await route.fulfill({ path: resolve('dist/index.html'), headers: { 'cache-control': 'public, max-age=3600' } })
    }
  })
}

async function openPrivacy(page: Page) {
  await page.getByRole('button', { name: 'Настройки' }).click()
  await page.locator('#settings-privacy').click()
  return page.getByRole('switch', { name: 'Аналитика посещений' })
}

test('HTTPS production build defaults ON and a saved OFF remains silent after reload', async ({ context, page }) => {
  await useProductionOrigin(context)
  await page.goto('https://vaqt.pro/')
  await expect(page.getByRole('heading', { name: 'Выберите место' })).toBeVisible()
  await expect.poll(() => page.locator('script[data-vaqtpro-cloudflare-analytics]').count()).toBe(1)
  await expect.poll(() => productionRequests.filter(url => url.includes('static.cloudflareinsights.com/beacon.min.js')).length).toBe(1)
  await expect.poll(() => productionRequests.filter(url => url.includes('cloudflareinsights.com/cdn-cgi/rum')).length).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Найти город' }).click()
  await page.getByRole('searchbox').fill('Казань')
  await page.getByRole('button', { name: 'Казань Татарстан' }).click()
  await expect(page.getByRole('button', { name: 'Настройки' })).toBeVisible()
  const rumRequestsBeforeOptOut = productionRequests.filter(url => url.includes('cloudflareinsights.com/cdn-cgi/rum')).length

  const toggle = await openPrivacy(page)
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  const reload = page.waitForEvent('load')
  await toggle.click()
  await reload
  await expect(page.getByRole('button', { name: 'Настройки' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('vaqtpro.analytics.enabled'))).toBe('false')
  expect(productionRequests.filter(url => url.includes('static.cloudflareinsights.com/beacon.min.js'))).toHaveLength(1)
  expect(productionRequests.filter(url => url.includes('cloudflareinsights.com/cdn-cgi/rum'))).toHaveLength(rumRequestsBeforeOptOut)
})

test('failed OFF save stays ON and collecting, while CSP permits only the approved Cloudflare origins', async ({ context, page }) => {
  await context.addInitScript(() => {
    const setItem = Object.getOwnPropertyDescriptor(Storage.prototype, 'setItem')?.value as (this: Storage, key: string, value: string) => void
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'vaqtpro.analytics.enabled' && value === 'false') throw new DOMException('blocked', 'QuotaExceededError')
      Reflect.apply(setItem, this, [key, value])
    }
  })
  await useProductionOrigin(context)
  await page.goto('https://vaqt.pro/')
  await expect(page.getByRole('heading', { name: 'Выберите место' })).toBeVisible()
  await expect.poll(() => productionRequests.filter(url => url.includes('static.cloudflareinsights.com/beacon.min.js')).length).toBe(1)
  await expect.poll(() => productionRequests.filter(url => url.includes('cloudflareinsights.com/cdn-cgi/rum')).length).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Найти город' }).click()
  await page.getByRole('searchbox').fill('Казань')
  await page.getByRole('button', { name: 'Казань Татарстан' }).click()
  await expect(page.getByRole('button', { name: 'Настройки' })).toBeVisible()
  const toggle = await openPrivacy(page)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('alert')).toContainText('Аналитика остаётся включённой')
  await expect(page.locator('script[data-vaqtpro-cloudflare-analytics]')).toHaveCount(1)
  expect(productionRequests.filter(url => url.includes('static.cloudflareinsights.com/beacon.min.js'))).toHaveLength(1)
  const rumRequestsBeforeRetry = productionRequests.filter(url => url.includes('cloudflareinsights.com/cdn-cgi/rum')).length
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect.poll(() => productionRequests.filter(url => url.includes('cloudflareinsights.com/cdn-cgi/rum')).length).toBeGreaterThan(rumRequestsBeforeRetry)

  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  expect(policy).toContain("script-src 'self' https://static.cloudflareinsights.com")
  expect(policy).toContain("connect-src 'self' https://cloudflareinsights.com")
  const requestPromise = page.waitForRequest('https://cloudflareinsights.com/cdn-cgi/rum')
  await page.evaluate(() => fetch('https://cloudflareinsights.com/cdn-cgi/rum', { method: 'POST', body: 'controlled-csp-check' }))
  await requestPromise

  const violations: string[] = []
  await page.exposeFunction('__recordCspViolation', (directive: string) => violations.push(directive))
  await page.evaluate(() => document.addEventListener('securitypolicyviolation', event => {
    (window as Window & { __recordCspViolation: (directive: string) => void }).__recordCspViolation(event.violatedDirective)
  }, { once: true }))
  await page.evaluate(() => {
    const script = document.createElement('script')
    script.src = 'https://unapproved.example/beacon.js'
    document.head.append(script)
  })
  await expect.poll(() => violations).toContain('script-src-elem')
})

test('a preference change from another tab reloads with analytics OFF', async ({ context, page }) => {
  await useProductionOrigin(context)
  await page.goto('https://vaqt.pro/')
  await expect(page.getByRole('heading', { name: 'Выберите место' })).toBeVisible()
  const otherTab = await context.newPage()
  await otherTab.goto('https://vaqt.pro/away.html')
  const reload = page.waitForEvent('load')
  await otherTab.evaluate(() => {
    localStorage.setItem('vaqtpro.analytics.enabled', 'false')
    const channel = new BroadcastChannel('vaqtpro-analytics-preference-v1')
    channel.postMessage({ type: 'preference-changed', enabled: false })
    channel.close()
  })
  await reload
  await expect(page.getByRole('heading', { name: 'Выберите место' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('vaqtpro.analytics.enabled'))).toBe('false')
  await expect(page.locator('script[data-vaqtpro-cloudflare-analytics]')).toHaveCount(0)
  expect(productionRequests.filter(url => url.includes('static.cloudflareinsights.com/beacon.min.js'))).toHaveLength(1)
})
