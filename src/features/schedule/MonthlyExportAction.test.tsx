import { act, render, screen, waitFor } from '@testing-library/react'
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
const shareLabel = 'Экспортировать расписание на месяц'

afterEach(() => {
  prepareMonthlyExportFiles.mockReset()
  Reflect.deleteProperty(HTMLSelectElement.prototype, 'showPicker')
})

it('shows preparation progress, attempts the native picker, and keeps the ready files for a fallback tap', async () => {
  let finish: ((files: { pdf: File; png: File; failures: [] }) => void) | undefined
  prepareMonthlyExportFiles.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const showPicker = vi.fn(() => { throw new DOMException('User activation expired', 'NotAllowedError') })
  Object.defineProperty(HTMLSelectElement.prototype, 'showPicker', { configurable: true, value: showPicker })
  const user = userEvent.setup()
  render(<MonthlyExportAction snapshot={snapshot} labels={labels} />)

  expect(prepareMonthlyExportFiles).not.toHaveBeenCalled()
  const button = screen.getByRole('button', { name: shareLabel })
  const control = button.parentElement
  await user.click(button)
  expect(prepareMonthlyExportFiles).toHaveBeenCalledOnce()
  expect(button).toHaveAttribute('aria-busy', 'true')
  expect(button).not.toBeDisabled()
  expect(control).not.toHaveClass('is-disabled')
  expect(control?.querySelector('.monthly-export-spinner')).not.toBeNull()

  act(() => { finish?.({ pdf, png, failures: [] }) })
  const select = await screen.findByRole('combobox', { name: shareLabel })
  await waitFor(() => expect(showPicker).toHaveBeenCalledOnce())
  expect(control?.querySelector('.monthly-export-spinner')).toBeNull()
  expect(control?.querySelector('button')).not.toBeDisabled()
  expect(control?.querySelector('button')).toHaveAttribute('aria-hidden', 'true')
  await user.click(select)
  expect(prepareMonthlyExportFiles).toHaveBeenCalledOnce()
})

it('keeps the action unavailable after a rejected preparation until Retry starts a fresh attempt', async () => {
  prepareMonthlyExportFiles.mockRejectedValueOnce(new Error('render failed')).mockResolvedValueOnce({ pdf, png, failures: [] })
  const user = userEvent.setup()
  render(<MonthlyExportAction snapshot={snapshot} labels={labels} />)

  const button = screen.getByRole('button', { name: shareLabel })
  await user.click(button)
  await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'true'))
  await user.click(button)
  expect(prepareMonthlyExportFiles).toHaveBeenCalledOnce()

  await user.click(await screen.findByRole('button', { name: 'Повторить' }))
  await waitFor(() => expect(screen.getByRole('combobox', { name: shareLabel })).toBeEnabled())
  expect(prepareMonthlyExportFiles).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
