import { choosePlace, expect, test } from './fixtures'

test('Arabic Markdown uses the bundled Mushaf font on narrow screens in both themes', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-06-25T12:00:00.000Z'))
  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto('./')
  await choosePlace(page)
  await page.locator('#home-date').click()
  await page.getByRole('button', { name: 'Праздники и события' }).click()
  await page.locator('#religious-event-2026-06-25-ashura').click()

  const article = page.getByRole('region', { name: 'День Ашура' })
  const arabic = article.locator('.markdown-arabic')
  await expect(arabic).toHaveCount(6)
  await expect(arabic.first()).toHaveAttribute('lang', 'ar')
  await expect(arabic.first()).toHaveAttribute('dir', 'rtl')
  await expect.poll(() => arabic.first().evaluate(element => getComputedStyle(element).fontFamily)).toContain('Kazan Basma Mushaf')
  await expect.poll(() => arabic.first().evaluate(element => getComputedStyle(element).fontSize)).toBe('34px')
  await expect.poll(() => arabic.first().evaluate(element => parseFloat(getComputedStyle(element).lineHeight))).toBeGreaterThan(60)
  await expect.poll(() => article.locator('.screen-content').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  for (const scheme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await expect.poll(() => arabic.first().evaluate(element => getComputedStyle(element).fontFamily)).toContain('Kazan Basma Mushaf')
    await expect.poll(() => arabic.first().evaluate(element => getComputedStyle(element).fontSize)).toBe('34px')
    await expect.poll(() => page.evaluate(() => document.fonts.check('34px "Kazan Basma Mushaf"'))).toBe(true)
  }
})

