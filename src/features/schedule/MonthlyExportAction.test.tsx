import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { MonthlyExportAction } from './MonthlyExportAction'

const { prepareMonthlyExportFiles } = vi.hoisted(() => ({ prepareMonthlyExportFiles: vi.fn() }))
vi.mock('./monthlyExportRenderer', () => ({ prepareMonthlyExportFiles }))

const snapshot = { month: '2026-10', location: 'Москва', rows: [
  { date: '2026-10-01', schedule: { entries: Object.fromEntries(['fajr', 'sunrise', 'zenith', 'dhuhr', 'asr', 'maghrib', 'isha'].map(key => [key, { time: '00:00' }])), estimatedPrayers: [] } as never },
] }
const labels = {
  fajr: 'Фаджр', sunrise: 'Восход', zenith: 'Зенит', dhuhr: 'Зухр', asr: 'Аср', maghrib: 'Магриб', isha: 'Иша',
  exportDay: 'День', exportBrandSubtitle: 'Времена намаза', exportSourcePrefix: 'Источник: ', exportSourceUrl: 'https://vaqt.pro',
  weekdaySundayShort: 'вс', weekdayMondayShort: 'пн', weekdayTuesdayShort: 'вт', weekdayWednesdayShort: 'ср',
  weekdayThursdayShort: 'чт', weekdayFridayShort: 'пт', weekdaySaturdayShort: 'сб',
}
const pdf = new File(['pdf'], 'month.pdf', { type: 'application/pdf' })
const png = new File(['png'], 'month.png', { type: 'image/png' })
const createObjectURL = vi.fn(() => 'blob:export')

afterEach(() => {
  vi.restoreAllMocks()
  prepareMonthlyExportFiles.mockReset()
  Reflect.deleteProperty(navigator, 'share')
  Reflect.deleteProperty(navigator, 'canShare')
  createObjectURL.mockClear()
})

it('uses the Home-sized circular share action and a native select with exactly PDF and PNG', async () => {
  prepareMonthlyExportFiles.mockResolvedValue({ pdf, png, failures: [] })
  render(<MonthlyExportAction snapshot={snapshot} labels={labels} />)

  const select = screen.getByRole('combobox', { name: 'Экспортировать расписание на месяц' })
  expect(select).toBeDisabled()
  expect(Array.from(select.querySelectorAll('option:not([hidden])'), option => option.textContent)).toEqual(['PDF', 'PNG'])
  const control = select.parentElement
  expect(control).toHaveClass('monthly-export-control')
  expect(control?.querySelector('button')).toHaveClass('icon-button')
  await waitFor(() => expect(select).toBeEnabled())
  expect(control?.querySelector('svg path')).toHaveAttribute('d', expect.stringContaining('M12 15V3'))
  await userEvent.setup().tab()
  expect(select).toHaveFocus()
})

it('prepares export files only once when StrictMode replays effects', async () => {
  prepareMonthlyExportFiles.mockResolvedValue({ pdf, png, failures: [] })
  render(<StrictMode><MonthlyExportAction snapshot={snapshot} labels={labels} /></StrictMode>)

  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Экспортировать расписание на месяц' })).toBeEnabled())
  expect(prepareMonthlyExportFiles).toHaveBeenCalledOnce()
})

it('permits repeated selection of the same format and falls back when file sharing is unavailable', async () => {
  prepareMonthlyExportFiles.mockResolvedValue({ pdf, png, failures: [] })
  const user = userEvent.setup()
  render(<MonthlyExportAction snapshot={snapshot} labels={labels} />)
  const select = screen.getByRole('combobox', { name: 'Экспортировать расписание на месяц' })
  const fallback = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  await waitFor(() => expect(select).toBeEnabled())

  await user.selectOptions(select, 'pdf')
  await user.selectOptions(select, 'pdf')
  await waitFor(() => expect(fallback).toHaveBeenCalledTimes(2))
  expect(createObjectURL).toHaveBeenCalledTimes(2)
})

it('calls the native share API for the selected file while leaving cancellation silent', async () => {
  prepareMonthlyExportFiles.mockResolvedValue({ pdf, png, failures: [] })
  const share = vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError'))
  Object.defineProperty(navigator, 'share', { configurable: true, value: share })
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
  const user = userEvent.setup()
  render(<MonthlyExportAction snapshot={snapshot} labels={labels} />)
  const select = screen.getByRole('combobox', { name: 'Экспортировать расписание на месяц' })
  await waitFor(() => expect(select).toBeEnabled())
  await user.selectOptions(select, 'png')
  await waitFor(() => expect(share).toHaveBeenCalledWith({ files: [png] }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('ignores preparation results for a month that is no longer displayed', async () => {
  const finish: Array<(files: { pdf: File; png: File; failures: [] }) => void> = []
  prepareMonthlyExportFiles.mockImplementation(() => new Promise(resolve => { finish.push(resolve) }))
  const { rerender } = render(<MonthlyExportAction snapshot={snapshot} labels={labels} />)
  await waitFor(() => expect(prepareMonthlyExportFiles).toHaveBeenCalledTimes(1))
  rerender(<MonthlyExportAction snapshot={{ ...snapshot, month: '2026-11' }} labels={labels} />)
  await waitFor(() => expect(prepareMonthlyExportFiles).toHaveBeenCalledTimes(2))
  finish[0]?.({ pdf, png, failures: [] })
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Экспортировать расписание на месяц' })).toBeDisabled())
})

it('exposes a retry after generation failure and enables export when preparation recovers', async () => {
  prepareMonthlyExportFiles.mockRejectedValueOnce(new Error('render failed')).mockResolvedValueOnce({ pdf, png, failures: [] })
  const user = userEvent.setup()
  render(<MonthlyExportAction snapshot={snapshot} labels={labels} />)
  await user.click(await screen.findByRole('button', { name: 'Повторить' }))
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Экспортировать расписание на месяц' })).toBeEnabled())
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('keeps the successful format available when the other format preparation fails', async () => {
  prepareMonthlyExportFiles.mockResolvedValue({ pdf: null, png, failures: ['pdf'] })
  render(<MonthlyExportAction snapshot={snapshot} labels={labels} />)

  const select = screen.getByRole('combobox', { name: 'Экспортировать расписание на месяц' })
  await waitFor(() => expect(select).toBeEnabled())
  expect(select.querySelector('option[value="pdf"]')).toBeDisabled()
  expect(select.querySelector('option[value="png"]')).toBeEnabled()
  expect(screen.getByRole('alert')).toHaveTextContent('Не удалось выполнить экспорт')
})
