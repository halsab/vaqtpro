import { choosePlace, expect, expectSchedule, readSavedSetting, test } from './fixtures'


test('Mobile Safari выбирает место и открывает календарь без потери расписания', async ({ page }) => {
  await page.goto('./')
  await choosePlace(page)
  await expectSchedule(page)

  await page.locator('#home-date').click()
  await expect(page.getByRole('region', { name: 'Установка даты' })).toBeVisible()
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expectSchedule(page)
})

test('Mobile Safari opens a complete monthly timetable responsively', async ({ page }) => {
  // WebKit startup/search hydration can exceed the standard CI budget; the measured
  // timetable-open performance assertion below remains a strict 1-second limit.
  test.setTimeout(60_000)
  await page.goto('./')
  await choosePlace(page)
  await page.locator('#home-date').click()
  await expect(page.getByRole('region', { name: 'Установка даты' })).toBeVisible()
  await page.evaluate(() => performance.mark('monthly-timetable-open-start'))
  await page.getByRole('button', { name: 'Расписание на месяц' }).click()
  await expect(page.getByRole('region', { name: 'Расписание намаза за месяц' })).toBeVisible()
  await expect(page.getByRole('row')).toHaveCount(31)
  const elapsed = await page.evaluate(() => {
    performance.mark('monthly-timetable-open-end')
    return performance.measure('monthly-timetable-open', 'monthly-timetable-open-start', 'monthly-timetable-open-end').duration
  })
  expect(elapsed).toBeLessThan(1_000)
})


