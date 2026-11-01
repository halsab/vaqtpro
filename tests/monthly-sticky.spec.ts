import { choosePlace, expect, test } from './fixtures'

async function openMonth(page: import('@playwright/test').Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('./')
  await choosePlace(page)
  await page.locator('#home-date').click()
  await page.getByRole('button', { name: 'Расписание на месяц' }).click()
  await expect(page.getByRole('table', { name: 'Расписание намаза за месяц' })).toBeVisible()
}

test('monthly table keeps its header, date column, and separators frozen on both axes', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 540 })
  await openMonth(page)

  const geometry = async () => page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('.prayer-month-table-scroll')
    const screenContent = document.querySelector<HTMLElement>('.prayer-month-content')
    const table = document.querySelector<HTMLTableElement>('.prayer-month-table')
    const header = table?.querySelector<HTMLElement>('.prayer-month-date-heading')
    const secondHeader = table?.querySelectorAll<HTMLElement>('thead th')[1]
    const dateCell = table?.querySelector<HTMLElement>('tbody th')
    const firstTime = table?.querySelector<HTMLElement>('tbody td')
    if (!scroller || !screenContent || !header || !secondHeader || !dateCell || !firstTime) throw new Error('Missing monthly table geometry')
    const rect = (element: Element) => {
      const value = element.getBoundingClientRect()
      return { x: value.x, y: value.y, width: value.width, height: value.height }
    }
    return {
      scroller: { x: scroller.getBoundingClientRect().x, y: scroller.getBoundingClientRect().y,
        width: scroller.clientWidth, height: scroller.clientHeight, scrollWidth: scroller.scrollWidth,
        scrollHeight: scroller.scrollHeight, left: scroller.scrollLeft, top: scroller.scrollTop },
      screenContent: { width: screenContent.clientWidth, height: screenContent.clientHeight,
        scrollWidth: screenContent.scrollWidth, scrollHeight: screenContent.scrollHeight,
        left: screenContent.scrollLeft, top: screenContent.scrollTop },
      header: rect(header), secondHeader: rect(secondHeader), dateCell: rect(dateCell), firstTime: rect(firstTime),
      separatorX: getComputedStyle(header, '::after').backgroundColor,
      separatorY: getComputedStyle(header, '::before').backgroundColor,
      headerBackground: getComputedStyle(header).backgroundColor,
      rowBackgrounds: Array.from(table.querySelectorAll('tbody tr')).slice(0, 2).map(row => {
        const firstCell = row.firstElementChild
        if (!firstCell) throw new Error('Missing first row cell')
        return getComputedStyle(firstCell).backgroundColor
      }),
      columnWidths: Array.from(table.querySelectorAll('thead th')).map(cell => cell.getBoundingClientRect().width),
      alignments: Array.from(table.querySelectorAll('thead th, tbody th, tbody td'))
        .map(cell => getComputedStyle(cell).textAlign),
      contentFits: Array.from(table.querySelectorAll('thead th, tbody th, tbody td'))
        .every(cell => cell.scrollWidth <= cell.clientWidth),
    }
  })

  const before = await geometry()
  expect(before.scroller.scrollWidth).toBeGreaterThan(before.scroller.width)
  expect(before.scroller.scrollHeight).toBeGreaterThan(before.scroller.height)
  expect(before.screenContent.scrollWidth).toBe(before.screenContent.width)
  expect(before.screenContent.scrollHeight).toBe(before.screenContent.height)
  expect(before.alignments.every(alignment => alignment === 'center')).toBe(true)
  expect(before.contentFits).toBe(true)
  expect(before.rowBackgrounds[0]).not.toBe(before.rowBackgrounds[1])
  expect(before.separatorX).not.toBe('rgba(0, 0, 0, 0)')
  expect(before.separatorY).not.toBe('rgba(0, 0, 0, 0)')

  const scroller = page.locator('.prayer-month-table-scroll')
  await scroller.evaluate(element => {
    element.scrollLeft = element.scrollWidth
    element.scrollTop = 220
  })
  await page.waitForTimeout(50)
  const after = await geometry()
  await page.screenshot({ path: testInfo.outputPath('monthly-sticky-diagonal.png') })
  expect(after.header.x).toBeCloseTo(before.header.x, 0)
  expect(after.header.y).toBeCloseTo(before.scroller.y, 0)
  expect(after.dateCell.x).toBeCloseTo(before.dateCell.x, 0)
  expect(after.secondHeader.x).toBeLessThan(before.secondHeader.x)
  expect(after.firstTime.x).toBeLessThan(before.firstTime.x)
  expect(after.separatorX).toBe(before.separatorX)
  expect(after.separatorY).toBe(before.separatorY)

  const topLeftIntersection = await page.evaluate(() => {
    const cell = document.querySelector<HTMLElement>('.prayer-month-date-heading')
    if (!cell) throw new Error('Missing top-left header cell')
    const rect = cell.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + 4, rect.top + 4)
    return { matches: hit === cell, hit: hit?.outerHTML.slice(0, 120), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      background: getComputedStyle(cell).backgroundColor, zIndex: getComputedStyle(cell).zIndex }
  })
  expect(topLeftIntersection).toMatchObject({ matches: true })

  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth })
  const lastCells = await page.locator('.prayer-month-table tbody tr').last().evaluate(row => {
    const scroller = row.closest('.prayer-month-table-scroll')
    const date = row.querySelector('th')
    const lastCell = row.querySelector('td:last-child')
    if (!scroller || !date || !lastCell) throw new Error('Missing last row geometry')
    const lastDate = date.getBoundingClientRect()
    const lastTime = lastCell.getBoundingClientRect()
    const view = scroller.getBoundingClientRect()
    return { lastDateY: lastDate.bottom <= view.bottom + 1, lastTimeX: lastTime.right <= view.right + 1 }
  })
  expect(lastCells).toEqual({ lastDateY: true, lastTimeX: true })
})

test('expanded calculation details and 200% text remain reachable on a short viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 360 })
  await openMonth(page)
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  const details = page.locator('.prayer-month-method')
  await details.locator('summary').click()

  const scroller = page.locator('.screen-content.prayer-month-content')
  const dimensions = await scroller.evaluate(element => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }))
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight)
  expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth)
  expect(await page.locator('.prayer-month-table th, .prayer-month-table td').evaluateAll(cells =>
    cells.every(cell => cell.scrollWidth <= cell.clientWidth))).toBe(true)
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect(page.locator('.prayer-month-table tbody tr').last()).toBeInViewport()
  await expect(page.locator('.prayer-month-table thead th').first()).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('month navigation preserves one scroll owner and keeps changed rows reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 })
  await openMonth(page)
  const scroller = page.locator('.prayer-month-table-scroll')
  const tableRegion = page.getByRole('region', { name: 'Расписание намаза за месяц' })
  await tableRegion.focus()
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => scroller.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Следующий месяц' }).click()
  await expect(page.getByRole('heading', { name: 'октябрь 2026' })).toBeVisible()
  await expect(page.locator('.prayer-month-table tbody tr')).toHaveCount(31)
  await expect(page.locator('.prayer-month-table tbody th time').first()).toHaveText('01 чт')
  expect(await page.evaluate(() => document.querySelectorAll('.prayer-month-content').length)).toBe(1)
})

test('monthly table uses available width before enabling horizontal scrolling', async ({ page }) => {
  await openMonth(page)
  const region = page.locator('.prayer-month-table-scroll')
  for (const [width, shouldOverflow] of [[740, false], [320, true]] as const) {
    await page.setViewportSize({ width, height: 740 })
    await expect.poll(() => region.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(shouldOverflow)
    if (!shouldOverflow) {
      const widths = await region.locator('thead th').evaluateAll(cells => cells.map(cell => cell.getBoundingClientRect().width))
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1)
    }
  }
})

test('civil weekdays stay the same in distant browser timezones', async ({ browser }) => {
  for (const timezone of ['Pacific/Honolulu', 'Pacific/Kiritimati']) {
    const context = await browser.newContext({ timezoneId: timezone, baseURL: 'http://127.0.0.1:4175' })
    const page = await context.newPage()
    await page.clock.setFixedTime(new Date('2026-09-04T09:30:00.000Z'))
    await openMonth(page)
    await expect(page.locator('.prayer-month-table tbody th time').first()).toHaveText('01 вт')
    await context.close()
  }
})
