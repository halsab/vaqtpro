import { choosePlace, expect, test } from './fixtures'
import { themePalettes } from '../src/ui/themePalette'

function colorAlpha(color: string): number {
  const rgbaAlpha = color.match(/^rgba\([^,]+,\s*[^,]+,\s*[^,]+,\s*([\d.]+)\)$/)?.[1]
  const slashAlpha = color.match(/\/\s*([\d.]+)\s*\)$/)?.[1]
  return Number(rgbaAlpha ?? slashAlpha ?? 1)
}

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
      stickyDateBackground: getComputedStyle(dateCell).backgroundColor,
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
  expect(colorAlpha(before.headerBackground)).toBe(0)
  expect(colorAlpha(before.stickyDateBackground)).toBe(0)
  expect(colorAlpha(before.rowBackgrounds[0])).toBe(0)
  expect(colorAlpha(before.rowBackgrounds[1])).toBeCloseTo(0.4)

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

  const stickySurfaceHits = await page.evaluate(() => {
    const cell = document.querySelector<HTMLElement>('.prayer-month-date-heading')
    const dateColumn = document.querySelector<HTMLElement>('.prayer-month-table tbody .prayer-month-date')
    const normalHeader = document.querySelector<HTMLElement>('.prayer-month-table thead th:nth-child(2)')
    const tableViewport = document.querySelector<HTMLElement>('.prayer-month-table-scroll')
    const movingHeaders = Array.from(document.querySelectorAll<HTMLElement>('.prayer-month-table thead th:not(.prayer-month-date-heading)'))
    const movingCells = Array.from(document.querySelectorAll<HTMLElement>('.prayer-month-table tbody td'))
    if (!cell || !dateColumn || !normalHeader || !tableViewport || movingHeaders.length === 0 || movingCells.length === 0) {
      throw new Error('Missing sticky surfaces')
    }
    const head = cell.getBoundingClientRect()
    const date = dateColumn.getBoundingClientRect()
    const view = tableViewport.getBoundingClientRect()
    const at = (x: number, y: number) => document.elementFromPoint(x, y)
    const intersection = at(head.left + Math.min(4, head.width / 2), head.top + 4)
    const rowHeader = at(date.left + date.width / 2, view.top + head.height + 16)
    const rowHeaderSurface = rowHeader?.closest<HTMLElement>('.prayer-month-date') ?? null
    const verticalLineHits = Array.from({ length: 4 }, (_, index) => {
      const y = view.top + head.height + 12 + index * Math.max(12, (view.height - head.height - 24) / 4)
      return Boolean(at(head.right - 0.5, y)?.closest('.prayer-month-date'))
    })
    const horizontalLineHits = Array.from({ length: 4 }, (_, index) => {
      const x = head.right + 12 + index * Math.max(12, (view.right - head.right - 24) / 4)
      return Boolean(at(Math.min(x, view.right - 4), head.bottom - 0.5)?.closest('thead th'))
    })
    const opaque = (color: string) => color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)'
    const hasLeftClip = (elements: HTMLElement[]) => elements.some(element => {
      const clip = getComputedStyle(element).clipPath.match(/inset\([\d.]+px\s+0px\s+0px\s+([\d.]+)px\)/)
      return Number(clip?.[1] ?? 0) > 0
    })
    const bodyClippedBothAxes = movingCells.some(element => {
      const clip = getComputedStyle(element).clipPath.match(/inset\(([\d.]+)px\s+0px\s+0px\s+([\d.]+)px\)/)
      return Number(clip?.[1] ?? 0) > 0 && Number(clip?.[2] ?? 0) > 0
    })
    return {
      intersectionIsTopmost: intersection === cell,
      intersectionZ: Number(getComputedStyle(cell).zIndex),
      normalHeaderZ: Number(getComputedStyle(normalHeader).zIndex),
      dateColumnZ: Number(getComputedStyle(dateColumn).zIndex),
      intersectionBackgroundTransparent: !opaque(getComputedStyle(cell).backgroundColor),
      dateBackgroundTransparent: !opaque(getComputedStyle(dateColumn).backgroundColor),
      headerClipsUnderDate: hasLeftClip(movingHeaders),
      bodyClipsUnderDate: hasLeftClip(movingCells),
      bodyClipsUnderBothFrozenAreas: bodyClippedBothAxes,
      rowHeaderHit: Boolean(rowHeaderSurface),
      verticalLineHits,
      horizontalLineHits,
    }
  })
  expect(stickySurfaceHits).toMatchObject({ intersectionIsTopmost: true, intersectionZ: 3,
    normalHeaderZ: 2, dateColumnZ: 2, intersectionBackgroundTransparent: true, dateBackgroundTransparent: true,
    rowHeaderHit: true, verticalLineHits: [true, true, true, true], horizontalLineHits: [true, true, true, true] })
  expect(stickySurfaceHits.headerClipsUnderDate).toBe(true)
  expect(stickySurfaceHits.bodyClipsUnderDate).toBe(true)
  expect(stickySurfaceHits.bodyClipsUnderBothFrozenAreas).toBe(true)

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

test('short viewports keep navigation stationary and expose the full table through its own scrollport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 360 })
  await openMonth(page)
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  const scroller = page.locator('.prayer-month-table-scroll')
  const dimensions = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>('.prayer-month-content')
    const controls = document.querySelector<HTMLElement>('.prayer-month-controls')
    const title = document.querySelector<HTMLElement>('.prayer-month-heading')
    const table = document.querySelector<HTMLElement>('.prayer-month-table-scroll')
    if (!content || !controls || !title || !table) throw new Error('Missing monthly layout')
    const rect = (element: Element) => {
      const { x, y, right, bottom } = element.getBoundingClientRect()
      return { x, y, right, bottom }
    }
    return {
      content: { clientWidth: content.clientWidth, scrollWidth: content.scrollWidth,
        clientHeight: content.clientHeight, scrollHeight: content.scrollHeight },
      controls: rect(controls), title: rect(title), table: rect(table),
      tableScroll: { width: table.clientWidth, height: table.clientHeight,
        scrollWidth: table.scrollWidth, scrollHeight: table.scrollHeight },
      tableOverflow: getComputedStyle(table).overflow,
      summaryAbsent: !document.querySelector('details, summary, .prayer-month-method'),
    }
  })
  expect(dimensions.summaryAbsent).toBe(true)
  expect(dimensions.content.scrollWidth).toBe(dimensions.content.clientWidth)
  expect(dimensions.content.scrollHeight).toBe(dimensions.content.clientHeight)
  expect(dimensions.tableScroll.width).toBeGreaterThan(0)
  expect(dimensions.tableScroll.height).toBeGreaterThan(0)
  expect(dimensions.tableScroll.scrollWidth).toBeGreaterThan(dimensions.tableScroll.width)
  expect(dimensions.tableScroll.scrollHeight).toBeGreaterThan(dimensions.tableScroll.height)
  expect(dimensions.tableOverflow).toBe('auto')
  expect(dimensions.controls.x).toBeGreaterThanOrEqual(0)
  expect(dimensions.controls.right).toBeLessThanOrEqual(320)
  expect(dimensions.title.x).toBeGreaterThanOrEqual(0)
  expect(dimensions.title.right).toBeLessThanOrEqual(320)
  expect(dimensions.controls.bottom).toBeLessThanOrEqual(dimensions.table.y + 1)
  expect(await page.locator('.prayer-month-table th, .prayer-month-table td').evaluateAll(cells =>
    cells.every(cell => cell.scrollWidth <= cell.clientWidth))).toBe(true)
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = element.scrollWidth })
  await expect(page.locator('.prayer-month-table tbody tr').last()).toBeInViewport()
  await expect(page.locator('.prayer-month-table thead th').first()).toBeInViewport()
  await expect(page.locator('.prayer-month-table thead th').last()).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('monthly scrollport reaches panel edges, keeps horizontal insets, and clips beneath transparent frozen cells', async ({ page }) => {
  await page.setViewportSize({ width: 422, height: 646 })
  await openMonth(page)
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
    const screen = document.querySelector<HTMLElement>('.app-screen')
    screen?.style.setProperty('--screen-inset-left', '32px')
    screen?.style.setProperty('--screen-inset-right', '32px')
  })

  const scroller = page.locator('.prayer-month-table-scroll')
  const initial = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.screen-panel')
    const controls = document.querySelector<HTMLElement>('.prayer-month-controls')
    const content = document.querySelector<HTMLElement>('.prayer-month-content')
    const region = document.querySelector<HTMLElement>('.prayer-month-table-scroll')
    const bottomSurface = document.querySelector<HTMLElement>('.app-layout + .app-bottom-surface')
    const table = document.querySelector<HTMLTableElement>('.prayer-month-table')
    const date = table?.querySelector<HTMLElement>('.prayer-month-date-heading')
    if (!panel || !controls || !content || !region || !date || !bottomSurface) throw new Error('Missing full-bleed monthly layout')
    const panelRect = panel.getBoundingClientRect()
    const scrollRect = region.getBoundingClientRect()
    const controlsRect = controls.getBoundingClientRect()
    return {
      panel: { left: panelRect.left, right: panelRect.right, bottom: panelRect.bottom },
      scroll: { left: scrollRect.left, right: scrollRect.right, bottom: scrollRect.bottom,
        width: region.clientWidth, height: region.clientHeight,
        paddingBottom: Number.parseFloat(getComputedStyle(region).paddingBottom) },
      controls: { left: controlsRect.left, right: controlsRect.right, bottom: controlsRect.bottom },
      content: { width: content.clientWidth, scrollWidth: content.scrollWidth },
      bottomSurfaceBackground: getComputedStyle(bottomSurface).backgroundColor,
      dateLeft: date.getBoundingClientRect().left,
      documentWidth: document.documentElement.scrollWidth,
    }
  })
  expect(initial.scroll.left).toBeCloseTo(initial.panel.left, 0)
  expect(initial.scroll.right).toBeCloseTo(initial.panel.right, 0)
  expect(initial.panel.bottom - initial.scroll.bottom).toBeCloseTo(0, 0)
  expect(initial.scroll.paddingBottom).toBe(0)
  expect(colorAlpha(initial.bottomSurfaceBackground)).toBe(0)
  expect(initial.dateLeft).toBeCloseTo(32, 0)
  expect(initial.controls.left).toBeGreaterThanOrEqual(32)
  expect(initial.controls.right).toBeLessThanOrEqual(390)
  expect(initial.controls.bottom).toBeLessThan(initial.scroll.bottom)
  expect(initial.content.scrollWidth).toBe(initial.content.width)
  expect(initial.documentWidth).toBe(422)

  await scroller.evaluate(element => {
    element.scrollLeft = element.scrollWidth
    element.scrollTop = 220
  })
  await page.waitForTimeout(50)
  const clipping = await page.evaluate(() => {
    const region = document.querySelector<HTMLElement>('.prayer-month-table-scroll')
    const table = document.querySelector<HTMLTableElement>('.prayer-month-table')
    const heading = table?.querySelector<HTMLElement>('.prayer-month-date-heading')
    const date = table?.querySelector<HTMLElement>('.prayer-month-date')
    if (!region || !table || !heading || !date) throw new Error('Missing frozen table areas')
    const movingCells = [...table.querySelectorAll<HTMLElement>('thead th:not(.prayer-month-date-heading), tbody td, tbody .prayer-month-date')]
    const clippedLeft = movingCells.filter(cell => {
      const match = getComputedStyle(cell).clipPath.match(/inset\(([\d.]+)px\s+0px\s+0px\s+([\d.]+)px\)/)
      return Number(match?.[2] ?? 0) > 0
    }).length
    const clippedTop = movingCells.filter(cell => {
      const match = getComputedStyle(cell).clipPath.match(/inset\(([\d.]+)px\s+0px\s+0px\s+([\d.]+)px\)/)
      return Number(match?.[1] ?? 0) > 0
    }).length
    return {
      headerX: heading.getBoundingClientRect().left,
      dateX: date.getBoundingClientRect().left,
      viewportX: region.getBoundingClientRect().left,
      clippedLeft,
      clippedTop,
      transparentHeader: getComputedStyle(heading).backgroundColor,
      transparentDate: getComputedStyle(date).backgroundColor,
      maxScrollLeft: region.scrollLeft,
      maxScrollTop: region.scrollTop,
      documentWidth: document.documentElement.scrollWidth,
    }
  })
  expect(clipping.headerX).toBeCloseTo(32, 0)
  expect(clipping.dateX).toBeCloseTo(32, 0)
  expect(clipping.viewportX).toBe(0)
  expect(clipping.clippedLeft).toBeGreaterThan(0)
  expect(clipping.clippedTop).toBeGreaterThan(0)
  expect(colorAlpha(clipping.transparentHeader)).toBe(0)
  expect(colorAlpha(clipping.transparentDate)).toBe(0)
  expect(clipping.maxScrollLeft).toBeGreaterThan(0)
  expect(clipping.maxScrollTop).toBeGreaterThan(0)
  expect(clipping.documentWidth).toBe(422)
})

test('mobile two-axis scrolling measures only visible cells while preserving frozen clipping', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openMonth(page)
  const performance = await page.evaluate(async () => {
    const scrollport = document.querySelector<HTMLElement>('.prayer-month-table-scroll')
    if (!scrollport) throw new Error('Missing monthly scrollport')
    const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window)
    const originalRect = Reflect.get(Element.prototype, 'getBoundingClientRect')
    let geometryReads = 0
    const frameCosts: number[] = []
    Element.prototype.getBoundingClientRect = function getMeasuredRect() {
      if (this.matches('th, td') && this.closest('.prayer-month-table')) geometryReads += 1
      return Reflect.apply(originalRect, this, [])
    }
    window.requestAnimationFrame = callback => nativeRequestAnimationFrame(time => {
      const startedAt = window.performance.now()
      callback(time)
      frameCosts.push(window.performance.now() - startedAt)
    })
    try {
      await new Promise<void>(resolve => nativeRequestAnimationFrame(() => resolve()))
      geometryReads = 0
      frameCosts.length = 0
      const verticalRange = scrollport.scrollHeight - scrollport.clientHeight
      const horizontalRange = scrollport.scrollWidth - scrollport.clientWidth
      for (let frame = 0; frame < 75; frame += 1) {
        scrollport.scrollTop = (frame * 23) % verticalRange
        scrollport.scrollLeft = (frame * 41) % horizontalRange
        await new Promise<void>(resolve => nativeRequestAnimationFrame(() => resolve()))
      }
      const sortedCosts = [...frameCosts].sort((left, right) => left - right)
      const percentile = (position: number) => Number((sortedCosts[position] ?? 0).toFixed(3))
      return {
        viewport: `${innerWidth}x${innerHeight}`,
        frames: frameCosts.length,
        geometryReads,
        geometryReadsPerFrame: geometryReads / Math.max(1, frameCosts.length),
        p50FrameCallbackMs: percentile(Math.floor(sortedCosts.length * 0.5)),
        p95FrameCallbackMs: percentile(Math.floor(sortedCosts.length * 0.95)),
        maxFrameCallbackMs: percentile(sortedCosts.length - 1),
        scrollTop: scrollport.scrollTop,
        scrollLeft: scrollport.scrollLeft,
      }
    } finally {
      Element.prototype.getBoundingClientRect = originalRect
    }
  })
  console.info(`MONTHLY_SCROLL_PERF ${testInfo.project.name} ${JSON.stringify(performance)}`)
  expect(performance.frames).toBeGreaterThan(0)
  expect(performance.geometryReads).toBeGreaterThan(0)
  expect(performance.geometryReadsPerFrame).toBeLessThan(170)
  expect(performance.scrollTop).toBeGreaterThan(0)
  expect(performance.scrollLeft).toBeGreaterThan(0)
})

test('month navigation preserves one scroll owner and keeps changed rows reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 })
  await openMonth(page)
  const scroller = page.locator('.prayer-month-table-scroll')
  const tableRegion = page.getByRole('region', { name: 'Расписание намаза за месяц' })
  await tableRegion.focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(tableRegion).toBeFocused()
  await expect.poll(() => tableRegion.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none')
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  const arrowDownTop = await scroller.evaluate(element => element.scrollTop)
  await page.keyboard.press('PageDown')
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(arrowDownTop)
  const pageDownTop = await scroller.evaluate(element => element.scrollTop)
  await page.keyboard.press('PageUp')
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeLessThan(pageDownTop)
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => scroller.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
  await scroller.evaluate(element => { element.scrollTop = 80; element.scrollLeft = 40 })
  await page.getByRole('button', { name: 'Следующий месяц' }).click()
  await expect(page.getByRole('heading', { name: 'октябрь 2026' })).toBeVisible()
  await expect(page.locator('.prayer-month-table tbody tr')).toHaveCount(31)
  await expect(page.locator('.prayer-month-table tbody th time').first()).toHaveText('01 чт')
  const stickyAfterMonthChange = await page.evaluate(() => {
    const scroll = document.querySelector<HTMLElement>('.prayer-month-table-scroll')
    const header = document.querySelector<HTMLElement>('.prayer-month-table .prayer-month-date-heading')
    const date = document.querySelector<HTMLElement>('.prayer-month-table tbody .prayer-month-date')
    if (!scroll || !header || !date) throw new Error('Missing post-navigation sticky geometry')
    return { headerY: header.getBoundingClientRect().y, viewportY: scroll.getBoundingClientRect().y,
      dateX: date.getBoundingClientRect().x, viewportX: scroll.getBoundingClientRect().x,
      inlineInset: Number.parseFloat(getComputedStyle(scroll).paddingLeft) }
  })
  expect(stickyAfterMonthChange.headerY).toBeCloseTo(stickyAfterMonthChange.viewportY, 0)
  expect(stickyAfterMonthChange.dateX).toBeCloseTo(stickyAfterMonthChange.viewportX + stickyAfterMonthChange.inlineInset, 0)
  expect(await page.evaluate(() => document.querySelectorAll('.prayer-month-content').length)).toBe(1)
})

test('monthly geometry stays contained across the approved short-screen matrix and themes', async ({ page }) => {
  await openMonth(page)
  const viewportPairs = [
    ...[320, 390].flatMap(width => [360, 479, 480, 481, 540, 720].map(height => [width, height] as const)),
    [740, 360] as const,
  ]

  for (const [width, height] of viewportPairs) {
    await page.setViewportSize({ width, height })
    for (const textScale of ['100%', '200%']) {
      await page.evaluate(scale => {
        document.documentElement.style.fontSize = scale
        const screen = document.querySelector<HTMLElement>('.app-screen')
        screen?.style.setProperty('--screen-inset-left', scale === '200%' ? '32px' : '16px')
        screen?.style.setProperty('--screen-inset-right', scale === '200%' ? '32px' : '16px')
        screen?.style.setProperty('--app-keyboard-inset', '0px')
      }, textScale)
      const geometry = await page.evaluate(() => {
        const content = document.querySelector<HTMLElement>('.prayer-month-content')
        const controls = document.querySelector<HTMLElement>('.prayer-month-controls')
        const table = document.querySelector<HTMLElement>('.prayer-month-table-scroll')
        if (!content || !controls || !table) throw new Error('Missing monthly viewport geometry')
        const nav = controls.getBoundingClientRect()
        const body = table.getBoundingClientRect()
        return {
          content: { width: content.clientWidth, scrollWidth: content.scrollWidth,
            height: content.clientHeight, scrollHeight: content.scrollHeight },
          nav: { x: nav.x, right: nav.right, top: nav.top, bottom: nav.bottom },
          table: { x: body.x, right: body.right, top: body.top, width: table.clientWidth,
            height: table.clientHeight, scrollWidth: table.scrollWidth, scrollHeight: table.scrollHeight },
          documentWidth: document.documentElement.scrollWidth,
        }
      })
      expect(geometry.content.scrollWidth).toBe(geometry.content.width)
      expect(geometry.content.scrollHeight).toBe(geometry.content.height)
      expect(geometry.nav.x).toBeGreaterThanOrEqual(0)
      expect(geometry.nav.right).toBeLessThanOrEqual(width)
      expect(geometry.nav.top).toBeGreaterThanOrEqual(0)
      expect(geometry.nav.bottom).toBeLessThanOrEqual(height)
      expect(geometry.table.width).toBeGreaterThan(0)
      expect(geometry.table.height, JSON.stringify({ width, height, textScale, geometry })).toBeGreaterThan(0)
      expect(geometry.table.scrollHeight).toBeGreaterThan(geometry.table.height)
      expect(geometry.table.right).toBeLessThanOrEqual(width)
      expect(geometry.documentWidth).toBeLessThanOrEqual(width)
    }
  }

  for (const [themeName, palette] of Object.entries(themePalettes)) {
    const surface = await page.evaluate(({ themeName, palette }) => {
      const root = document.documentElement
      root.dataset.theme = themeName.startsWith('classic') ? 'classic' : 'seasonal'
      root.dataset.themeTone = themeName.endsWith('dark') ? 'dark' : 'light'
      for (const [key, value] of Object.entries({
        '--background-primary': palette.backgroundPrimary,
        '--background-secondary': palette.backgroundSecondary,
        '--background-tertiary': palette.backgroundTertiary,
        '--text-primary': palette.textPrimary,
        '--text-secondary': palette.textSecondary,
      })) root.style.setProperty(key, value)
      const header = document.querySelector<HTMLElement>('.prayer-month-date-heading')
      const dateCell = document.querySelector<HTMLElement>('.prayer-month-date')
      const firstRow = document.querySelector<HTMLElement>('.prayer-month-table tbody tr:first-child')
      const secondRow = document.querySelector<HTMLElement>('.prayer-month-table tbody tr:nth-child(2)')
      const firstDate = firstRow?.firstElementChild
      const firstValue = firstRow?.children.item(1)
      const secondDate = secondRow?.firstElementChild
      const secondValue = secondRow?.children.item(1)
      if (!header || !dateCell || !(firstDate instanceof HTMLElement) || !(firstValue instanceof HTMLElement)
        || !(secondDate instanceof HTMLElement) || !(secondValue instanceof HTMLElement)) throw new Error('Missing sticky surfaces')
      return {
        header: getComputedStyle(header).backgroundColor,
        date: getComputedStyle(dateCell).backgroundColor,
        separator: getComputedStyle(header, '::after').backgroundColor,
        horizontal: getComputedStyle(header, '::before').backgroundColor,
        firstDate: getComputedStyle(firstDate).backgroundColor,
        firstValue: getComputedStyle(firstValue).backgroundColor,
        secondDate: getComputedStyle(secondDate).backgroundColor,
        secondValue: getComputedStyle(secondValue).backgroundColor,
      }
    }, { themeName, palette })
    expect(colorAlpha(surface.header)).toBe(0)
    expect(colorAlpha(surface.date)).toBe(0)
    expect(surface.separator).not.toBe('rgba(0, 0, 0, 0)')
    expect(surface.horizontal).not.toBe('rgba(0, 0, 0, 0)')
    expect(surface.firstDate).toBe(surface.firstValue)
    expect(surface.secondDate).toBe(surface.secondValue)
    expect(surface.firstDate).not.toBe(surface.secondDate)
    expect(colorAlpha(surface.firstDate)).toBe(0)
    expect(colorAlpha(surface.secondDate)).toBeCloseTo(0.4)
  }

  await page.setViewportSize({ width: 390, height: 720 })
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
    const screen = document.querySelector<HTMLElement>('.app-screen')
    screen?.style.setProperty('--screen-inset-left', '32px')
    screen?.style.setProperty('--screen-inset-right', '32px')
    screen?.style.setProperty('--app-keyboard-inset', '120px')
  })
  const keyboardGeometry = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>('.prayer-month-content')
    const controls = document.querySelector<HTMLElement>('.prayer-month-controls')
    const table = document.querySelector<HTMLElement>('.prayer-month-table-scroll')
    if (!content || !controls || !table) throw new Error('Missing keyboard-adjusted layout')
    const nav = controls.getBoundingClientRect()
    const panelBottom = document.querySelector<HTMLElement>('.screen-panel')?.getBoundingClientRect().bottom ?? 0
    return { contentHeight: content.clientHeight, contentScrollHeight: content.scrollHeight,
      controlsBottom: nav.bottom, tableHeight: table.clientHeight, tableScrollHeight: table.scrollHeight,
      tableScrollWidth: table.scrollWidth, tableWidth: table.clientWidth,
      tableBottom: table.getBoundingClientRect().bottom, panelBottom,
      tableBottomInset: Number.parseFloat(getComputedStyle(table).paddingBottom),
      documentWidth: document.documentElement.scrollWidth }
  })
  expect(keyboardGeometry.contentScrollHeight).toBe(keyboardGeometry.contentHeight)
  expect(keyboardGeometry.controlsBottom).toBeLessThan(720)
  expect(keyboardGeometry.tableHeight).toBeGreaterThan(0)
  expect(keyboardGeometry.tableScrollHeight).toBeGreaterThan(keyboardGeometry.tableHeight)
  expect(keyboardGeometry.panelBottom - keyboardGeometry.tableBottom).toBeCloseTo(120, 0)
  expect(keyboardGeometry.tableBottomInset).toBe(0)
  await page.locator('.prayer-month-table-scroll').evaluate(element => {
    element.scrollTop = element.scrollHeight
    element.scrollLeft = element.scrollWidth
  })
  await expect(page.locator('.prayer-month-table tbody tr').last()).toBeInViewport()
  await expect(page.locator('.prayer-month-table thead th').last()).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('monthly table uses available width before enabling horizontal scrolling', async ({ page }) => {
  await openMonth(page)
  const region = page.locator('.prayer-month-table-scroll')
  for (const [width, shouldOverflow] of [[740, false], [390, true], [320, true]] as const) {
    await page.setViewportSize({ width, height: 740 })
    await expect.poll(() => region.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(shouldOverflow)
    if (!shouldOverflow) {
      const widths = await region.locator('thead th').evaluateAll(cells => cells.map(cell => cell.getBoundingClientRect().width))
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1)
    }
  }
})

test('long localized cells, estimated markers, and unavailable values remain centered and readable at 200%', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await openMonth(page)
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
    const headers = document.querySelectorAll<HTMLElement>('.prayer-month-table thead th')
    const firstTimeCell = document.querySelector<HTMLElement>('.prayer-month-table tbody tr:first-child td')
    const unavailableCell = document.querySelector<HTMLElement>('.prayer-month-table tbody tr:nth-child(2) td:last-child')
    if (!headers[7] || !firstTimeCell || !unavailableCell) throw new Error('Missing monthly table cells')
    headers[7].textContent = 'Название молитвы на выбранном языке'
    firstTimeCell.innerHTML = '<span class="prayer-month-time"><span class="prayer-month-estimated">примерно </span><time>23:59</time></span>'
    unavailableCell.textContent = '—'
    unavailableCell.setAttribute('aria-label', 'Время недоступно')
  })

  const layout = await page.evaluate(() => {
    const scroll = document.querySelector<HTMLElement>('.prayer-month-table-scroll')
    const table = document.querySelector<HTMLTableElement>('.prayer-month-table')
    if (!scroll || !table) throw new Error('Missing monthly table')
    const cells = [...table.querySelectorAll<HTMLElement>('thead th, tbody th, tbody td')]
    return {
      documentWidth: document.documentElement.scrollWidth,
      clientWidth: scroll.clientWidth,
      scrollWidth: scroll.scrollWidth,
      centered: cells.every(cell => getComputedStyle(cell).textAlign === 'center'),
      fits: cells.every(cell => cell.scrollWidth <= cell.clientWidth),
      widths: [...table.querySelectorAll('thead th')].map(cell => cell.getBoundingClientRect().width),
      estimatedMarker: document.querySelector('.prayer-month-estimated')?.textContent.trim() ?? null,
      unavailable: document.querySelector('.prayer-month-table tbody tr:nth-child(2) td:last-child')?.textContent.trim() ?? null,
    }
  })
  expect(layout.documentWidth).toBeLessThanOrEqual(320)
  expect(layout.scrollWidth).toBeGreaterThan(layout.clientWidth)
  expect(layout.centered).toBe(true)
  expect(layout.fits).toBe(true)
  expect(layout.widths.every(width => Math.abs(width - (layout.widths[0] ?? 0)) < 1), JSON.stringify(layout.widths)).toBe(true)
  expect(layout.estimatedMarker).toBe('примерно')
  expect(layout.unavailable).toBe('—')
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
