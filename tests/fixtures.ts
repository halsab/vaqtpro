import { expect, test as base, type BrowserContext } from '@playwright/test'

export async function installGeoNamesFixture(context: BrowserContext, isOffline: () => boolean = () => false): Promise<void> {
  await context.route('https://secure.geonames.org/searchJSON**', async route => {
    if (isOffline()) {
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
}

export const FIXED_BROWSER_TIME = new Date('2026-09-04T09:30:00.000Z')

export const test = base.extend<{ deterministicClock: true }>({
  deterministicClock: [async ({ page, context }, use) => {
    await page.clock.setFixedTime(FIXED_BROWSER_TIME)
    // Never evaluate page JavaScript from an intercepted request. WebKit can stall
    // request handling during navigation, leaving place selection permanently pending.
    let offline = false
    const setOffline = context.setOffline.bind(context)
    context.setOffline = async value => {
      await setOffline(value)
      offline = value
    }
    await installGeoNamesFixture(context, () => offline)
    try {
      await use(true)
    } finally {
      context.setOffline = setOffline
    }
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

/**
 * Seed a valid saved locality without exercising city-search/network startup.
 * Use only when the test's risk is unrelated to place discovery.
 */
export async function seedSelectedPlace(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('./manifest.webmanifest')
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('salah', 15)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' })
        if (!db.objectStoreNames.contains('control')) db.createObjectStore('control')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Could not initialize selected place'))
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const place = {
          id: 'locality:kazan', selection: 'city', name: 'Казань',
          latitude: 55.79, longitude: 49.12, accuracy: null, timestamp: 0,
          timeZone: 'Europe/Moscow', automaticTimeZone: { id: 'Europe/Moscow', source: 'city' },
          region: { code: 'RU-TA', name: 'Татарстан' }, coverage: 'inside',
        }
        const transaction = database.transaction(['settings', 'control'], 'readwrite')
        transaction.objectStore('settings').put({
          key: 'locationChoice',
          value: { mode: 'calculated', source: 'manual', coordinates: place, place },
        })
        transaction.objectStore('control').put(0, 'generation')
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error ?? new Error('Could not save selected place'))
        transaction.onabort = () => reject(transaction.error ?? new Error('Selected-place write was aborted'))
      })
    } finally {
      database.close()
    }
  })
  await page.goto('./')
}

export async function expectSchedule(page: import('@playwright/test').Page, count = 7) {
  await expect(page.getByRole('region', { name: 'Главная', exact: true })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Расписание дня' }).getByRole('listitem')).toHaveCount(count)
}
