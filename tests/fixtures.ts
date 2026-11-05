import { expect, test as base } from '@playwright/test'

export const FIXED_BROWSER_TIME = new Date('2026-09-04T09:30:00.000Z')

export const test = base.extend<{ deterministicClock: true }>({
  deterministicClock: [async ({ page, context }, use) => {
    await page.clock.setFixedTime(FIXED_BROWSER_TIME)
    await context.route('https://secure.geonames.org/searchJSON**', async route => {
      const online = await route.request().frame().page().evaluate(() => navigator.onLine).catch(() => false)
      if (!online) {
        await route.abort('internetdisconnected')
        return
      }
      const query = new URL(route.request().url()).searchParams.get('name_startsWith')?.trim().toLocaleLowerCase('ru-RU') ?? ''
      const geonames = ONLINE_PLACE_FIXTURES.filter(place => place.name.toLocaleLowerCase('ru-RU').startsWith(query))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ geonames }),
      })
    })
    await use(true)
  }, { auto: true }],
})

const ONLINE_PLACE_FIXTURES = [
  { geonameId: 551487, name: 'Казань', lat: 55.7887, lng: 49.1221, countryCode: 'RU', adminCode1: '73', adminName1: 'Татарстан', population: 1_308_660, timezone: { timeZoneId: 'Europe/Moscow' }, fcode: 'PPLA' },
  { geonameId: 583983, name: 'Агрыз', lat: 56.5255, lng: 52.9972, countryCode: 'RU', adminCode1: '73', adminName1: 'Татарстан', population: 19_700, timezone: { timeZoneId: 'Europe/Moscow' }, fcode: 'PPL' },
  { geonameId: 521118, name: 'Нижнекамск', lat: 55.6413, lng: 51.816, countryCode: 'RU', adminCode1: '73', adminName1: 'Татарстан', population: 240_000, timezone: { timeZoneId: 'Europe/Moscow' }, fcode: 'PPLA' },
  { geonameId: 524901, name: 'Москва', lat: 55.7522, lng: 37.6156, countryCode: 'RU', adminCode1: '48', adminName1: 'Москва', population: 12_600_000, timezone: { timeZoneId: 'Europe/Moscow' }, fcode: 'PPLC' },
  { geonameId: 745044, name: 'Стамбул', lat: 41.0138, lng: 28.9497, countryCode: 'TR', adminCode1: '34', adminName1: 'Стамбул', population: 15_700_000, timezone: { timeZoneId: 'Europe/Istanbul' }, fcode: 'PPLA' },
  { geonameId: 1496411, name: 'Облово', lat: 52.61667, lng: 83.61667, countryCode: 'RU', adminCode1: '22', adminName1: 'Алтайский Край', timezone: { timeZoneId: 'Asia/Barnaul' }, fcode: 'PPL' },
  { geonameId: 451919, name: 'Облово', lat: 57.04877, lng: 34.12661, countryCode: 'RU', adminCode1: '69', adminName1: 'Тверская Область', timezone: { timeZoneId: 'Europe/Moscow' }, fcode: 'PPLX' },
]

export { expect }

export async function readSavedSetting(page: import('@playwright/test').Page, key: string): Promise<unknown> {
  return page.evaluate(settingKey => new Promise<unknown>((resolve, reject) => {
    const request = indexedDB.open('salah')
    request.onerror = () => reject(request.error ?? new Error('Не удалось открыть IndexedDB'))
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('settings', 'readonly')
      const value = transaction.objectStore('settings').get(settingKey)
      transaction.oncomplete = () => { database.close(); resolve((value.result as { value?: unknown } | undefined)?.value) }
      transaction.onabort = () => { database.close(); reject(transaction.error ?? new Error('Чтение отменено')) }
    }
  }), key)
}

export async function choosePlace(page: import('@playwright/test').Page, query = 'Казань', name: string | RegExp = 'Казань Татарстан') {
  const search = page.getByRole('button', { name: 'Найти место', exact: true })
  await expect(search.or(page.locator('#home-location'))).toBeVisible()
  if (!await search.isVisible()) await page.locator('#home-location').click()
  await search.click()
  await page.getByRole('searchbox').fill(query)
  await page.getByRole('button', { name }).click()
  await expect(page.getByRole('region', { name: 'Главная', exact: true })).toBeVisible()
  await expect(page.locator('.event-countdown')).toBeVisible()
}

export async function expectSchedule(page: import('@playwright/test').Page, count = 7) {
  await expect(page.getByRole('region', { name: 'Главная', exact: true })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Расписание дня' }).getByRole('listitem')).toHaveCount(count)
}
