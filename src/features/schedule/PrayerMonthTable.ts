import { createElement, useId, useLayoutEffect, useState, type CSSProperties, type KeyboardEvent } from 'react'

import { SCHEDULE_EVENT_KEYS, type PrayerSchedule } from '../../domain/scheduleEvents'
import { useLocalization } from '../../localization'
import { civilWeekday } from '../../domain/civilMonth'

export const PRAYER_MONTH_KEYS = SCHEDULE_EVENT_KEYS

function handleTableScrollKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight'
  const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'PageUp' || event.key === 'PageDown'
  if (!horizontal && !vertical) return
  const tableViewport = event.currentTarget
  const screenContent = tableViewport.closest('.screen-content')
  const overflow = getComputedStyle(tableViewport)
  const tableOwnsAxis = horizontal
    ? overflow.overflowX === 'auto' || overflow.overflowX === 'scroll'
    : overflow.overflowY === 'auto' || overflow.overflowY === 'scroll'
  const element = tableOwnsAxis ? tableViewport : screenContent
  if (!(element instanceof HTMLElement)) return
  if (horizontal && element.scrollWidth <= element.clientWidth) return
  if (vertical && element.scrollHeight <= element.clientHeight) return
  event.preventDefault()
  if (horizontal) element.scrollLeft += (event.key === 'ArrowRight' ? 1 : -1) * Math.max(80, element.clientWidth * 0.8)
  else element.scrollTop += (event.key === 'ArrowDown' || event.key === 'PageDown' ? 1 : -1) * Math.max(44, element.clientHeight * (event.key.startsWith('Page') ? 0.8 : 0.15))
}

function formatAccessibleDate(date: string): string {
  const [year, month, day] = date.split('-')
  if (!year || !month || !day) throw new RangeError(`Invalid civil date: ${date}`)
  return `${day}.${month}.${year}`
}

export function PrayerMonthTable({ rows, labels, weekdayLabels, dateLabel, tableLabel }: {
  rows: readonly { date: string; schedule: PrayerSchedule | null }[]
  labels: Record<(typeof PRAYER_MONTH_KEYS)[number], string>
  weekdayLabels: readonly string[]
  dateLabel: string
  tableLabel: string
}) {
  const { t } = useLocalization()
  const regionId = useId()
  const [minimumTableWidth, setMinimumTableWidth] = useState(0)
  useLayoutEffect(() => {
    const table = document.getElementById(regionId)?.querySelector<HTMLTableElement>('.prayer-month-table')
    if (!table) return

    // Равные колонки должны вмещать самую широкую ячейку при текущем масштабе и шрифте.
    let active = true
    let clipFrame = 0
    let clippedCells = new Set<HTMLElement>()
    let nextClippedCells = new Set<HTMLElement>()
    const cellsToWrite: HTMLElement[] = []
    const clipValues: string[] = []
    const updateFrozenClips = () => {
      clipFrame = 0
      if (!active) return
      const viewport = table.parentElement
      const dateHeading = table.querySelector<HTMLElement>('.prayer-month-date-heading')
      if (!viewport || !dateHeading) return
      const viewportRect = viewport.getBoundingClientRect()
      const headingRect = dateHeading.getBoundingClientRect()
      const frozenDateRight = headingRect.right
      const frozenHeaderBottom = headingRect.bottom
      const viewportTop = viewportRect.top
      const viewportBottom = viewportRect.bottom
      const viewportLeft = viewportRect.left
      const viewportRight = viewportRect.right
      nextClippedCells.clear()
      cellsToWrite.length = 0
      clipValues.length = 0

      // Сначала только читаем геометрию видимых строк, затем отдельным проходом пишем стили.
      for (const row of table.rows) {
        const isHeader = row.parentElement === table.tHead
        if (!isHeader) {
          const rowRect = row.getBoundingClientRect()
          if (rowRect.bottom <= viewportTop || rowRect.top >= viewportBottom) continue
        }
        for (const cell of row.cells) {
          if (cell === dateHeading) continue
          const rect = cell.getBoundingClientRect()
          if (rect.right <= viewportLeft || rect.left >= viewportRight
            || rect.bottom <= viewportTop || rect.top >= viewportBottom) continue
          const isFrozenDate = cell.classList.contains('prayer-month-date')
          const left = isFrozenDate ? 0 : Math.max(0, Math.min(rect.width, frozenDateRight - rect.left))
          const top = isHeader ? 0 : Math.max(0, Math.min(rect.height, frozenHeaderBottom - rect.top))
          if (left === 0 && top === 0) continue
          const clip = `inset(${top}px 0px 0px ${left}px)`
          nextClippedCells.add(cell)
          if (cell.style.clipPath !== clip) {
            cellsToWrite.push(cell)
            clipValues.push(clip)
          }
        }
      }
      for (const cell of clippedCells) {
        if (!nextClippedCells.has(cell)) {
          cellsToWrite.push(cell)
          clipValues.push('')
        }
      }
      for (let index = 0; index < cellsToWrite.length; index += 1) {
        const cell = cellsToWrite[index]
        const value = clipValues[index]
        if (!cell) continue
        if (value) cell.style.clipPath = value
        else cell.style.removeProperty('clip-path')
      }
      const previousClippedCells = clippedCells
      clippedCells = nextClippedCells
      nextClippedCells = previousClippedCells
    }
    const scheduleFrozenClipUpdate = () => {
      if (!active || clipFrame) return
      clipFrame = window.requestAnimationFrame(updateFrozenClips)
    }
    const measure = () => {
      if (!active) return
      const cells = table.querySelectorAll<HTMLElement>('th, td')
      let widestCell = 0
      for (const cell of cells) {
        const range = document.createRange()
        range.selectNodeContents(cell)
        const textWidth = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect().width : 0
        const style = getComputedStyle(cell)
        widestCell = Math.max(widestCell, textWidth + Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight))
      }
      const nextWidth = Math.ceil(widestCell * (PRAYER_MONTH_KEYS.length + 1))
      setMinimumTableWidth(current => current === nextWidth ? current : nextWidth)
      scheduleFrozenClipUpdate()
    }

    measure()
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    if (table.parentElement) resizeObserver?.observe(table.parentElement)
    const rootObserver = new MutationObserver(measure)
    rootObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
    const contentObserver = new MutationObserver(records => {
      if (records.every(record => record.type === 'attributes' && record.attributeName === 'style')) return
      measure()
    })
    contentObserver.observe(table, { attributes: true, childList: true, characterData: true, subtree: true })
    window.addEventListener('resize', measure)
    table.parentElement?.addEventListener('scroll', scheduleFrozenClipUpdate, { passive: true })
    const fonts = Reflect.get(document, 'fonts') as FontFaceSet | undefined
    if (fonts) void fonts.ready.then(measure)

    return () => {
      active = false
      resizeObserver?.disconnect()
      rootObserver.disconnect()
      contentObserver.disconnect()
      window.removeEventListener('resize', measure)
      table.parentElement?.removeEventListener('scroll', scheduleFrozenClipUpdate)
      if (clipFrame) window.cancelAnimationFrame(clipFrame)
      for (const cell of clippedCells) cell.style.removeProperty('clip-path')
    }
  }, [dateLabel, labels, regionId, rows, tableLabel, weekdayLabels])
  const tableStyle = { '--prayer-month-table-min-width': `${minimumTableWidth}px` } as CSSProperties
  return createElement('div', { id: regionId, className: 'prayer-month-table-scroll', role: 'region', 'aria-label': tableLabel, tabIndex: 0, onKeyDown: handleTableScrollKeyDown },
    createElement('table', { className: 'prayer-month-table', style: tableStyle },
      createElement('caption', null, tableLabel),
      createElement('colgroup', null, ...Array.from({ length: PRAYER_MONTH_KEYS.length + 1 }, (_, index) =>
        createElement('col', { key: index }))),
      createElement('thead', null, createElement('tr', null,
        createElement('th', { scope: 'col', className: 'prayer-month-date-heading' }, dateLabel),
        ...PRAYER_MONTH_KEYS.map(key => createElement('th', { key, scope: 'col' }, labels[key])))),
      createElement('tbody', null, ...rows.map(({ date, schedule }) => createElement('tr', { key: date },
        createElement('th', { scope: 'row', className: 'prayer-month-date' }, createElement('time', {
          dateTime: date,
          'aria-label': formatAccessibleDate(date),
        }, `${date.slice(-2)} ${weekdayLabels[civilWeekday(date)] ?? ''}`)),
        ...PRAYER_MONTH_KEYS.map(key => {
          const entry = schedule?.entries[key]
          if (!entry) return createElement('td', { key, 'aria-label': t('monthlyTimeUnavailable') }, '—')
          return createElement('td', { key }, createElement('span', { className: 'prayer-month-time' },
            schedule.estimatedPrayers.includes(key) ? createElement('span', { className: 'prayer-month-estimated', 'aria-label': t('estimatedTime') }, `${t('estimatedApproximation')} `) : null,
            createElement('time', { dateTime: new Date(entry.instant).toISOString() }, entry.time)))
        }))))))
}
