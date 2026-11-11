import { seedSelectedPlace, expect, test } from './fixtures'

test('Arabic Markdown uses the bundled Mushaf font on narrow screens in both themes', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-06-25T12:00:00.000Z'))
  await page.setViewportSize({ width: 320, height: 720 })
  await seedSelectedPlace(page)
  await page.locator('#home-date').click()
  await page.getByRole('combobox', { name: 'Календарь' }).selectOption('hijri')
  const selectedMonth = page.locator('.date-field .note .arabic-run').first()
  await expect.poll(() => selectedMonth.evaluate(element => getComputedStyle(element).fontSize)).toBe('22px')
  await expect.poll(() => page.locator('.date-field select[lang="ar"]').evaluate(element => getComputedStyle(element).fontSize)).toBe('24px')
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect.poll(() => page.locator('#home-date .arabic-run').first().evaluate(element => getComputedStyle(element).fontSize)).toBe('24px')
  await page.locator('#home-date').click()
  await page.getByRole('button', { name: 'Праздники и события' }).click()
  const eventMonth = page.locator('#religious-event-2026-06-25-ashura .action-row-secondary .arabic-run').first()
  await expect(eventMonth).toContainText('محرم')
  await expect.poll(() => eventMonth.evaluate(element => getComputedStyle(element).fontSize)).toBe('22px')
  await page.locator('#religious-event-2026-06-25-ashura').click()

  const article = page.getByRole('region', { name: 'День Ашура' })
  const arabic = article.locator('.markdown-arabic')
  const hijriMonth = arabic.filter({ hasText: 'محرم' }).first()
  await expect(hijriMonth).toContainText('محرم')
  await expect(hijriMonth).toHaveAttribute('lang', 'ar')
  await expect(hijriMonth).toHaveAttribute('dir', 'rtl')
  await expect.poll(() => hijriMonth.evaluate(element => getComputedStyle(element).fontFamily)).toContain('Kazan Basma Mushaf')
  await expect(arabic.first()).toHaveAttribute('lang', 'ar')
  await expect(arabic.first()).toHaveAttribute('dir', 'rtl')
  await expect.poll(() => arabic.first().evaluate(element => getComputedStyle(element).fontFamily)).toContain('Kazan Basma Mushaf')
  await expect.poll(() => arabic.first().evaluate(element => {
    const size = parseFloat(getComputedStyle(element).fontSize)
    const parentSize = parseFloat(getComputedStyle(element.parentElement ?? element).fontSize)
    return size - parentSize
  })).toBe(8)
  await expect.poll(() => arabic.first().evaluate(element => {
    const style = getComputedStyle(element)
    return parseFloat(style.lineHeight) / parseFloat(style.fontSize)
  })).toBeCloseTo(1.4, 1)
  await expect.poll(() => article.locator('.screen-content').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  for (const scheme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await expect.poll(() => arabic.first().evaluate(element => getComputedStyle(element).fontFamily)).toContain('Kazan Basma Mushaf')
    await expect.poll(() => arabic.first().evaluate(element => {
      const size = parseFloat(getComputedStyle(element).fontSize)
      const parentSize = parseFloat(getComputedStyle(element.parentElement ?? element).fontSize)
      return size - parentSize
    })).toBe(8)
    await expect.poll(() => page.evaluate(() => document.fonts.check('24px "Kazan Basma Mushaf"'))).toBe(true)
  }
})

