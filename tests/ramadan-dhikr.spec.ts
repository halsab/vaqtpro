import { choosePlace, expect, test } from './fixtures'

test('Ramadan dhikr pages support narrow layout, keyboard navigation and browser history', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto('./')
  await choosePlace(page, 'Стамбул', 'Стамбул, Стамбул, Турция')
  await page.locator('#home-date').click()
  await page.getByRole('button', { name: 'Праздники и события' }).click()
  await page.getByRole('button', { name: /Начало.*رمضان/ }).click()

  const article = page.getByRole('region', { name: 'رمضان' })
  await expect(article).toBeVisible()
  const dhikrButtons = article.getByRole('button', { name: /^Зикр/ })
  await expect(dhikrButtons).toHaveCount(3)
  const buttonWidths = await dhikrButtons.evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().width))
  expect(buttonWidths.every(width => width >= 44)).toBe(true)
  const heading = article.locator('.markdown-article h1')
  await expect(heading).toHaveText('رمضان')
  await expect(heading).toHaveAttribute('dir', 'rtl')
  await expect.poll(() => heading.evaluate(element => getComputedStyle(element).direction)).toBe('rtl')
  await expect.poll(() => heading.locator('.arabic-run').evaluate(element => getComputedStyle(element).fontSize)).toBe('28px')
  await expect.poll(() => heading.evaluate(element => {
    const arabic = element.querySelector('.arabic-run')
    return arabic !== null && Math.abs(arabic.getBoundingClientRect().right - element.getBoundingClientRect().right) <= 2
  })).toBe(true)

  const mixedParagraph = article.locator('.markdown-article p').filter({ hasText: 'месяц обязательного поста' }).first()
  await expect(mixedParagraph).toContainText('رمضان')
  await expect(mixedParagraph).not.toHaveAttribute('dir', 'rtl')
  await expect.poll(() => mixedParagraph.evaluate(element => getComputedStyle(element).direction)).toBe('ltr')
  await expect.poll(() => mixedParagraph.evaluate(element => {
    const arabic = element.querySelector('.arabic-run')
    return arabic !== null && Math.abs(arabic.getBoundingClientRect().left - element.getBoundingClientRect().left) <= 2
  })).toBe(true)

  await dhikrButtons.first().focus()
  await page.keyboard.press('Enter')
  const firstPage = page.getByRole('region', { name: 'Зикр первых 10 дней' })
  await expect(firstPage).toBeVisible()
  await expect(page.locator('.app-screen')).toHaveCount(1)
  await expect(firstPage.getByRole('heading', { name: 'Зикр первых 10 дней', level: 1 })).toBeVisible()
  await expect(firstPage.locator('.ramadan-dhikr-arabic')).toHaveAttribute('dir', 'rtl')
  await expect(firstPage.locator('.ramadan-dhikr-arabic')).toHaveAttribute('lang', 'ar')
  expect(await firstPage.locator('.ramadan-dhikr-arabic').evaluate(element => getComputedStyle(element).direction)).toBe('rtl')
  await expect.poll(() => firstPage.locator('.ramadan-dhikr-arabic').evaluate(element => getComputedStyle(element).fontFamily)).toContain('Kazan Basma Mushaf')
  await expect.poll(() => firstPage.locator('.ramadan-dhikr-arabic').evaluate(element => getComputedStyle(element).fontSize)).toBe('28px')
  await expect.poll(() => firstPage.locator('.ramadan-dhikr-arabic').evaluate(element => parseFloat(getComputedStyle(element).lineHeight))).toBeCloseTo(50.4, 1)
  expect(await firstPage.locator('.screen-content').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)

  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(article.getByRole('button', { name: 'Зикр первых 10 дней' })).toBeFocused()
  await page.goForward()
  await expect(page.getByRole('region', { name: 'Зикр первых 10 дней' })).toBeVisible()
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page.getByRole('region', { name: 'رمضان' })).toBeVisible()
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page.getByRole('region', { name: 'Праздники и события' })).toBeVisible()
})
