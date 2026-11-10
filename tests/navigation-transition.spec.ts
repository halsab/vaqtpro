import { choosePlace, expect, test } from './fixtures'

test('Back restores the previous scroll position and trigger focus', async ({ page }) => {
  await page.goto('./')
  await choosePlace(page)
  const content = page.locator('.screen-content')
  await content.evaluate(element => { element.scrollTop = element.scrollHeight })
  const scrollBefore = await content.evaluate(element => element.scrollTop)
  await page.locator('#home-settings').focus()
  await page.locator('#home-settings').click()
  await expect(page.getByRole('region', { name: 'Настройки' })).toBeVisible()
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(page.locator('#home-settings')).toBeFocused()
  await expect.poll(() => content.evaluate(element => element.scrollTop)).toBe(scrollBefore)
})


