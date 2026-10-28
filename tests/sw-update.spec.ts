import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { choosePlace, expect, FIXED_BROWSER_TIME, test } from './fixtures'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const serviceWorkerPath = path.join(root, 'dist', 'sw.js')
const reloadTimestampKey = 'salah:service-worker-reload-at'

test.describe.configure({ mode: 'serial' })

test('обновление service worker перезагружает приложение ровно один раз', async ({
  baseURL,
  browser,
}) => {
  const originalServiceWorker = await readFile(serviceWorkerPath)
  const context = await browser.newContext({ baseURL })
  const page = await context.newPage()

  try {
    await page.clock.setFixedTime(FIXED_BROWSER_TIME)
    expect(await page.evaluate(() => Date.now())).toBe(FIXED_BROWSER_TIME.getTime())
    await page.goto('./')
    await choosePlace(page)
    await expect(page.getByRole('timer')).toBeVisible()
    await page.evaluate(async () => navigator.serviceWorker.ready)
    await page.reload()
    await expect.poll(() => page.evaluate(() =>
      Boolean(navigator.serviceWorker.controller))).toBe(true)

    expect(await page.evaluate((key) => sessionStorage.getItem(key), reloadTimestampKey)).toBeNull()

    let navigationCount = 0
    page.on('load', () => { navigationCount += 1 })

    const uniqueComment = Buffer.from(
      `\n/* sw-update-smoke-${FIXED_BROWSER_TIME.toISOString()} */\n`,
      'utf8',
    )
    await writeFile(
      serviceWorkerPath,
      Buffer.concat([originalServiceWorker, uniqueComment]),
    )
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready
      await registration.update()
    })

    await expect.poll(() => navigationCount, { timeout: 15_000 }).toBe(1)
    await expect(page.getByRole('timer')).toBeVisible()
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready
      await registration.update()
    })
    expect(navigationCount).toBe(1)
  } finally {
    try {
      await context.close()
    } finally {
      await writeFile(serviceWorkerPath, originalServiceWorker)
      expect(await readFile(serviceWorkerPath)).toEqual(originalServiceWorker)
    }
  }
})
