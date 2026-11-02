import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { MonthlyExportAction } from './MonthlyExportAction'

const { prepareMonthlyPdf, deliverFile } = vi.hoisted(() => ({
  prepareMonthlyPdf: vi.fn(),
  deliverFile: vi.fn(),
}))
vi.mock('./monthlyExportRenderer', () => ({ prepareMonthlyPdf }))
vi.mock('./monthlyExportDelivery', () => ({ deliverFile }))

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
const shareLabel = 'Экспортировать расписание на месяц'

afterEach(() => {
  prepareMonthlyPdf.mockReset()
  deliverFile.mockReset()
})

it('prepares only PDF and invokes native delivery inside the later direct button gesture', async () => {
  let complete: ((file: File) => void) | undefined
  prepareMonthlyPdf.mockImplementation(() => new Promise(resolve => { complete = resolve }))
  deliverFile.mockResolvedValue('shared')
  const user = userEvent.setup()
  render(<MonthlyExportAction snapshot={snapshot} labels={labels} />)

  const button = screen.getByRole('button', { name: shareLabel })
  expect(button).toBeDisabled()
  expect(button.parentElement?.querySelector('.monthly-export-spinner')).not.toBeNull()
  await waitFor(() => expect(prepareMonthlyPdf).toHaveBeenCalledOnce())
  act(() => { complete?.(pdf) })
  await waitFor(() => expect(button).toBeEnabled())
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()

  await user.click(button)
  expect(deliverFile).toHaveBeenCalledOnce()
  expect(deliverFile).toHaveBeenCalledWith(pdf, navigator)
  expect(prepareMonthlyPdf).toHaveBeenCalledOnce()
  await waitFor(() => expect(button).toBeEnabled())
})

it('retries preparation after a renderer failure without triggering a share or PNG work', async () => {
  prepareMonthlyPdf.mockRejectedValueOnce(new Error('render failed')).mockResolvedValueOnce(pdf)
  const user = userEvent.setup()
  render(<MonthlyExportAction snapshot={snapshot} labels={labels} />)

  const button = screen.getByRole('button', { name: shareLabel })
  await waitFor(() => expect(screen.getByRole('alert')).toBeVisible())
  expect(button).toBeDisabled()
  expect(deliverFile).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: 'Повторить' }))
  await waitFor(() => expect(button).toBeEnabled())
  expect(prepareMonthlyPdf).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('retries native delivery with the already generated PDF', async () => {
  prepareMonthlyPdf.mockResolvedValue(pdf)
  deliverFile.mockResolvedValueOnce('failed').mockResolvedValueOnce('shared')
  const user = userEvent.setup()
  render(<MonthlyExportAction snapshot={snapshot} labels={labels} />)
  const button = screen.getByRole('button', { name: shareLabel })
  await waitFor(() => expect(button).toBeEnabled())

  await user.click(button)
  await waitFor(() => expect(screen.getByRole('alert')).toBeVisible())
  await user.click(screen.getByRole('button', { name: 'Повторить' }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(deliverFile).toHaveBeenCalledTimes(2)
  expect(prepareMonthlyPdf).toHaveBeenCalledOnce()
})
