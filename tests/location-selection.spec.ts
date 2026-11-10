import { choosePlace, expect, expectSchedule, readSavedSetting, test } from './fixtures'


test('online search returns a rural settlement and a separate selectable district', async ({ page }) => {
  const searchRequests: string[] = []
  page.on('request', request => {
    if (request.url().startsWith('https://secure.geonames.org/searchJSON')) searchRequests.push(request.url())
  })
  await page.goto('./')
  await page.getByRole('button', { name: 'Найти место' }).click()
  await page.getByRole('searchbox').fill('Облово')

  const village = page.getByRole('button', { name: /Облово, Алтайский Край, Россия, Населённое место/ })
  const district = page.getByRole('button', { name: /Облово, Тверская Область, Россия, Часть населённого места/ })
  await expect(village).toBeVisible()
  await expect(district).toBeVisible()
  expect(searchRequests).toHaveLength(1)
  expect(new URL(searchRequests[0] ?? 'https://invalid.local').searchParams.get('name_startsWith')).toBe('Облово')

  await district.click()
  await expect.poll(() => readSavedSetting(page, 'locationChoice')).toMatchObject({
    place: { id: 'geonames:451919', cityId: 451919, latitude: 57.04877, longitude: 34.12661, timeZone: 'Europe/Moscow' },
  })
  await expectSchedule(page)
})













