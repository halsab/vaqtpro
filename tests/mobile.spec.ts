import { choosePlace, expect, expectSchedule, readSavedSetting, test } from './fixtures'

test('Mobile Safari first-launch screen remains usable at 320px, landscape and larger text', async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as Window & { __geoRequests: number }
    target.__geoRequests = 0
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition: () => { target.__geoRequests += 1 },
    } })
  })
  await page.setViewportSize({ width: 320, height: 568 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Выберите место' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Настройки' })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.themeTone)).toBe('dark')
  await expect.poll(() => page.evaluate(() => (window as Window & { __geoRequests: number }).__geoRequests)).toBe(0)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.setViewportSize({ width: 844, height: 390 })
  await expect(page.getByRole('button', { name: 'Найти город' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Найти город' }).click()
  await expect(page.getByRole('searchbox')).toBeFocused()
})

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

test('Mobile Safari сохраняет настройку поста после перезапуска', async ({ page }) => {
  await page.goto('./')
  await choosePlace(page)
  await page.locator('#home-settings').click()

  const fastingMode = page.getByRole('switch')
  await expect(fastingMode).toBeVisible()
  await fastingMode.click()
  await expect(fastingMode).toHaveAttribute('aria-checked', 'true')
  await expect.poll(() => readSavedSetting(page, 'fastingMode')).toMatchObject({ manualEnabled: true })

  await page.reload()
  await expect(page.locator('#home-settings')).toBeVisible()
  await page.locator('#home-settings').click()
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(page.getByRole('progressbar')).toBeVisible()
})

test('monthly timetable remains usable at 320px, wide viewports and 200% text', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto('./')
  await choosePlace(page)
  const homeEvents = await page.locator('.event-list .event-row').evaluateAll(rows => rows.map(row => ({
    name: row.querySelector('.event-name > span')?.textContent,
    time: row.querySelector('time')?.textContent?.trim(),
    instant: row.querySelector('time')?.getAttribute('datetime'),
  })))
  expect(homeEvents.map(event => event.name)).toEqual(['Фаджр', 'Восход', 'Зенит', 'Зухр', 'Аср', 'Магриб', 'Иша'])
  await page.locator('#home-date').click()
  await page.getByRole('button', { name: 'Расписание на месяц' }).click()

  const region = page.getByRole('region', { name: 'Расписание намаза за месяц' })
  const table = region.locator('table')
  await expect(table.locator('tbody tr')).toHaveCount(30)
  const firstDay = table.locator('tbody tr').first().locator('th time')
  await expect(firstDay).toHaveText('01')
  await expect(firstDay).toHaveAttribute('datetime', '2026-09-01')
  await expect(firstDay).toHaveAttribute('aria-label', '01.09.2026')
  await expect(table.locator('thead th')).toHaveCount(8)
  await expect(table.locator('thead th').allTextContents()).resolves.toEqual(
    ['Дата', 'Фаджр', 'Восход', 'Зенит', 'Зухр', 'Аср', 'Магриб', 'Иша'],
  )
  await expect(table.locator('tbody tr').first().locator('td')).toHaveCount(7)
  const selectedDay = table.locator('tbody tr').nth(3)
  await expect(selectedDay.locator('th time')).toHaveAttribute('datetime', '2026-09-04')
  const monthEvents = await selectedDay.locator('td').evaluateAll(cells => cells.map(cell => ({
    time: cell.textContent?.trim(),
    instant: cell.querySelector('time')?.getAttribute('datetime'),
  })))
  expect(monthEvents).toEqual(homeEvents.map(event => ({ time: event.time, instant: event.instant })))

  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 640 })
    for (const scale of ['100%', '200%']) {
      await page.evaluate(value => { document.documentElement.style.fontSize = value }, scale)
      const layout = await page.evaluate(() => {
        const scroll = document.querySelector<HTMLElement>('.prayer-month-table-scroll')
        const row = document.querySelector<HTMLElement>('.prayer-month-table tbody tr')
        const heading = document.querySelector<HTMLElement>('.prayer-month-heading')
        const column = document.querySelector<HTMLElement>('.prayer-month-table thead th')
        const cell = document.querySelector<HTMLElement>('.prayer-month-table tbody td')
        if (!scroll || !row || !heading || !column || !cell) throw new Error('Missing monthly timetable')
        return {
          documentWidth: document.documentElement.scrollWidth,
          clientWidth: scroll.clientWidth,
          scrollWidth: scroll.scrollWidth,
          rowHeight: row.getBoundingClientRect().height,
          titleFont: getComputedStyle(heading).fontSize,
          headingFont: getComputedStyle(column).fontSize,
          bodyFont: getComputedStyle(cell).fontSize,
          numericStyle: getComputedStyle(cell).fontVariantNumeric,
        }
      })
      expect(layout.documentWidth).toBeLessThanOrEqual(width)
      expect(layout.clientWidth).toBeLessThanOrEqual(width)
      expect(layout.scrollWidth).toBeGreaterThanOrEqual(layout.clientWidth)
      expect(layout.numericStyle).toContain('tabular-nums')
      if (width === 320) expect(layout.scrollWidth).toBeGreaterThan(layout.clientWidth)
      if (scale === '100%') {
        expect(layout.rowHeight).toBeGreaterThanOrEqual(43)
        expect(layout.rowHeight).toBeLessThanOrEqual(46)
        expect(layout.titleFont).toBe('20px')
        expect(layout.headingFont).toBe('14px')
        expect(layout.bodyFont).toBe('16px')
      } else {
        expect(layout.rowHeight).toBeGreaterThan(44)
      }
    }
  }

  await page.setViewportSize({ width: 320, height: 640 })
  await page.evaluate(() => { document.documentElement.style.fontSize = '100%' })
  const scroll = region
  await scroll.evaluate(element => { element.scrollLeft = 0 })
  await scroll.focus()
  await expect(scroll).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => scroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
  await scroll.evaluate(element => { element.scrollLeft = element.scrollWidth })
  await expect.poll(() => scroll.evaluate(element =>
    Math.abs(element.scrollWidth - element.clientWidth - element.scrollLeft))).toBeLessThanOrEqual(1)

  await table.locator('thead th').last().evaluate(cell => {
    cell.textContent = 'Очень длинное локализованное название молитвы'
  })
  expect(await scroll.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  // Simulate left and right safe-area insets without changing the global Screen shell.
  await page.locator('.app-screen').evaluate(element => {
    element.style.setProperty('--screen-inset-left', '32px')
    element.style.setProperty('--screen-inset-right', '32px')
  })
  const insets = await page.locator('.screen-panel').evaluate(element => {
    const style = getComputedStyle(element)
    return { left: style.paddingLeft, right: style.paddingRight }
  })
  expect(insets).toEqual({ left: '32px', right: '32px' })
  expect(await scroll.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
