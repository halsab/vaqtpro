import { readFile } from 'node:fs/promises'
import { inflateSync } from 'node:zlib'

import { choosePlace, expect, readSavedSetting, test } from './fixtures'

const referencePng = (await readFile(new URL('./fixtures/monthly-export/v4.8-reference.png', import.meta.url))).toString('base64')
const referencePdf = await readFile(new URL('./fixtures/monthly-export/v4.8-reference.pdf', import.meta.url))

async function mockFileSharing(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const target = window as Window & {
      __sharedFiles: Array<{ name: string; type: string; size: number; data: string }>
      __sharedBlobs: File[]
    }
    target.__sharedFiles = []
    target.__sharedBlobs = []
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: (data: ShareData) => data.files?.length === 1 })
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data: ShareData) => {
      const file = data.files?.[0]
      if (!file) throw new Error('File was not provided to native sharing')
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read shared file'))
        reader.onerror = () => reject(reader.error ?? new Error('Could not read shared file'))
        reader.readAsDataURL(file)
      })
      target.__sharedFiles.push({ name: file.name, type: file.type, size: file.size, data: dataUrl.split(',')[1] ?? '' })
      target.__sharedBlobs.push(file)
    } })
  })
}

test('exports the current monthly schedule as native-shareable one-page PDF and full-resolution PNG', async ({ page }) => {
  const browserErrors: string[] = []
  const assetRequests: string[] = []
  page.on('request', request => assetRequests.push(request.url()))
  page.on('pageerror', error => browserErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()) })
  await mockFileSharing(page)
  await page.clock.setFixedTime(new Date('2026-10-01T09:30:00.000Z'))
  await page.goto('./')
  await choosePlace(page)
  await page.locator('#home-date').click()
  const requestStart = assetRequests.length
  const preparationStarted = Date.now()
  await page.getByRole('button', { name: 'Расписание на месяц' }).click()
  const select = page.getByRole('combobox', { name: 'Экспортировать расписание на месяц' })
  await expect(select.locator('option:not([hidden])')).toHaveText(['PDF', 'PNG'])
  try {
    await expect(select).toBeEnabled({ timeout: 20_000 })
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      exportResources: performance.getEntriesByType('resource').filter(entry => /OldTimeyMono|favicon\.svg|seasonal-patterns/u.test(entry.name)).map(entry => entry.name),
      fontFaces: Array.from(document.fonts).filter(font => font.family === 'MonthlyExportMono').length,
      selectorDisabled: document.querySelector<HTMLSelectElement>('[aria-label="Экспортировать расписание на месяц"]')?.disabled ?? null,
    }))
    await test.info().attach('monthly-export-preparation-diagnostics', {
      body: JSON.stringify({ preparationMs: Date.now() - preparationStarted, diagnostics, requests: assetRequests.slice(requestStart), browserErrors }, null, 2),
      contentType: 'application/json',
    })
    throw error
  }
  const preparationMs = Date.now() - preparationStarted
  const control = await select.boundingBox()
  expect(control?.width).toBe(44)
  expect(control?.height).toBe(44)
  await select.click()
  await expect(select).toBeFocused()
  await expect(select).toHaveValue('')
  await select.selectOption('pdf')
  await expect.poll(() => page.evaluate(() => (window as Window & { __sharedFiles: unknown[] }).__sharedFiles.length)).toBe(1)
  await expect(select).toHaveValue('')
  await select.selectOption('pdf')
  await expect.poll(() => page.evaluate(() => (window as Window & { __sharedFiles: unknown[] }).__sharedFiles.length)).toBe(2)
  await expect(select).toHaveValue('')
  await select.selectOption('png')
  const files = await page.evaluate(() => (window as Window & { __sharedFiles: Array<{ name: string; type: string; size: number; data: string }> }).__sharedFiles)
  expect(files.map(file => file.type)).toEqual(['application/pdf', 'application/pdf', 'image/png'])
  expect(files[0]?.name).toMatch(/^VaqtPro_.*_2026-10\.pdf$/)
  expect(files[2]?.name).toBe(files[0]?.name.replace(/\.pdf$/, '.png'))
  const pdfBytes = Buffer.from(files[0]?.data ?? '', 'base64')
  const pdfText = pdfBytes.toString('latin1')
  const referencePdfText = referencePdf.toString('latin1')
  const contentStart = pdfBytes.indexOf(Buffer.from('stream\n')) + Buffer.byteLength('stream\n')
  const contentEnd = pdfBytes.indexOf(Buffer.from('\nendstream'), contentStart)
  const pdfContent = inflateSync(pdfBytes.subarray(contentStart, contentEnd)).toString('latin1')
  expect(pdfText.startsWith('%PDF-')).toBe(true)
  expect((pdfText.match(/\/Type \/Page\b/gu) ?? []).length).toBe(1)
  const mediaBox = pdfText.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/u)
  const referenceMediaBox = referencePdfText.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/u)
  expect(mediaBox).not.toBeNull()
  expect(referencePdfText.startsWith('%PDF-')).toBe(true)
  expect(referenceMediaBox).not.toBeNull()
  expect(Number(mediaBox?.[1])).toBeCloseTo(210 * 72 / 25.4, 1)
  expect(Number(mediaBox?.[2])).toBeCloseTo(297 * 72 / 25.4, 1)
  expect(Math.abs(Number(mediaBox?.[1]) - Number(referenceMediaBox?.[1]))).toBeLessThan(1)
  expect(Math.abs(Number(mediaBox?.[2]) - Number(referenceMediaBox?.[2]))).toBeLessThan(1)
  expect(pdfText).toContain('/FontFile2')
  expect(pdfText).toContain('/Subtype /Link')
  expect(pdfText).toContain('https://vaqt.pro')
  expect((pdfContent.match(/\/I0 Do/gu) ?? []).length).toBe(4)
  expect((pdfContent.match(/\/GS1 gs/gu) ?? []).length).toBe(15)
  expect(pdfContent).toMatch(/106\.299[\d.]* 717\.[\d.]* m\s*106\.299[\d.]* 75\.[\d.]* l\s*S/u)
  expect(pdfContent).toMatch(/42\.519[\d.]* 51\.023[\d.]* Td/u)
  expect(files[0]?.size).toBeLessThanOrEqual(600 * 1024)

  const pngBytes = Buffer.from(files[2]?.data ?? '', 'base64')
  expect(pngBytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  expect(pngBytes.readUInt32BE(16)).toBe(1600)
  expect(pngBytes.readUInt32BE(20)).toBe(2263)
  expect(files[2]?.size).toBeGreaterThan(20_000)
  const visualComparison = await page.evaluate(async (reference) => {
    const files = (window as Window & { __sharedBlobs: File[] }).__sharedBlobs
    const approvedBytes = Uint8Array.from(atob(reference), character => character.charCodeAt(0))
    const [actual, approved] = await Promise.all([
      createImageBitmap(files[2] as File),
      createImageBitmap(new Blob([approvedBytes], { type: 'image/png' })),
    ])
    const canvas = document.createElement('canvas')
    canvas.width = approved.width
    canvas.height = approved.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Canvas unavailable for reference comparison')
    context.drawImage(actual, 0, 0, canvas.width, canvas.height)
    const actualPixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(approved, 0, 0)
    const approvedPixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    let absoluteError = 0
    let changedPixels = 0
    for (let offset = 0; offset < actualPixels.length; offset += 4) {
      const delta = Math.max(Math.abs((actualPixels[offset] ?? 0) - (approvedPixels[offset] ?? 0)),
        Math.abs((actualPixels[offset + 1] ?? 0) - (approvedPixels[offset + 1] ?? 0)),
        Math.abs((actualPixels[offset + 2] ?? 0) - (approvedPixels[offset + 2] ?? 0)))
      absoluteError += delta
      if (delta > 24) changedPixels += 1
    }
    const pixelCount = canvas.width * canvas.height
    return { meanAbsoluteChannelError: absoluteError / (pixelCount * 3), changedPixelRatio: changedPixels / pixelCount }
  }, referencePng)
  expect(visualComparison.meanAbsoluteChannelError).toBeLessThan(10)
  expect(visualComparison.changedPixelRatio).toBeLessThan(0.15)

  const lifecycle = await page.evaluate(() => ({
    fontFaces: Array.from(document.fonts).filter(font => font.family === 'MonthlyExportMono').length,
  }))
  const newAssetRequests = assetRequests.slice(requestStart)
  const resourceCounts = {
    font: newAssetRequests.filter(url => /OldTimeyMono/u.test(url)).length,
    logo: newAssetRequests.filter(url => /favicon\.svg/u.test(url)).length,
    seasonTile: newAssetRequests.filter(url => /vaqtpro-autumn-transparent-seamless/u.test(url)).length,
  }
  expect(preparationMs).toBeLessThan(20_000)
  expect(lifecycle.fontFaces).toBe(1)
  expect(resourceCounts).toEqual({ font: 1, logo: 1, seasonTile: 1 })
  expect(browserErrors).toEqual([])
  await test.info().attach('monthly-export-visual-and-resource-metrics', {
    body: JSON.stringify({ visualComparison, lifecycle, preparationMs, resourceCounts, sizes: files.map(file => ({ name: file.name, bytes: file.size })) }, null, 2),
    contentType: 'application/json',
  })
})

test('falls back to a named local download when file sharing is not available', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-safari-portrait', 'Playwright iOS WebKit emulation does not surface Files downloads')
  await page.goto('./')
  await choosePlace(page)
  await page.locator('#home-date').click()
  await page.getByRole('button', { name: 'Расписание на месяц' }).click()
  const select = page.getByRole('combobox', { name: 'Экспортировать расписание на месяц' })
  await expect(select).toBeEnabled({ timeout: 20_000 })
  const downloadEvent = page.waitForEvent('download')
  await select.selectOption('png')
  const download = await downloadEvent
  expect(download.suggestedFilename()).toMatch(/^VaqtPro_.*_2026-09\.png$/)
})

test('generates and shares the selected timetable offline from precached assets', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-safari-portrait', 'Offline export is exercised in Chromium; iOS offline acceptance remains physical-device validation')
  await mockFileSharing(page)
  await page.goto('./')
  await choosePlace(page)
  await expect.poll(() => readSavedSetting(page, 'locationChoice')).toMatchObject({ place: { id: 'locality:kazan' } })
  await page.evaluate(async () => navigator.serviceWorker.ready)
  await page.reload()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  await context.setOffline(true)
  await page.locator('#home-date').click()
  await page.getByRole('button', { name: 'Расписание на месяц' }).click()
  const select = page.getByRole('combobox', { name: 'Экспортировать расписание на месяц' })
  await expect(select).toBeEnabled({ timeout: 20_000 })
  await select.selectOption('png')
  await expect.poll(() => page.evaluate(() => (window as Window & { __sharedFiles: Array<{ name: string; type: string; size: number }> }).__sharedFiles.length)).toBe(1)
  const file = await page.evaluate(() => (window as Window & { __sharedFiles: Array<{ name: string; type: string; size: number }> }).__sharedFiles[0])
  expect(file).toMatchObject({ type: 'image/png' })
  expect(file?.size).toBeGreaterThan(20_000)
  await context.setOffline(false)
})
