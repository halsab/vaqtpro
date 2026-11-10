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

it('never prepares PDF on screen entry; first tap prepares and second tap shares directly', async () => {
  let complete: ((file: File) => void) | undefined
  prepareMonthlyPdf.mockImplementation(() => new Promise(resolve => { complete = resolve }))
  deliverFile.mockResolvedValue('shared')
  const user = userEvent.setup()
  render(<MonthlyExportAction snapshot={snapshot} labels={labels} />)

  const button = screen.getByRole('button', { name: shareLabel })
  expect(button).toBeEnabled()
  expect(button.parentElement?.querySelector('.monthly-export-spinner')).toBeNull()
  await new Promise(resolve => setTimeout(resolve, 130))
  expect(prepareMonthlyPdf).not.toHaveBeenCalled()

  await user.click(button)
  await waitFor(() => expect(prepareMonthlyPdf).toHaveBeenCalledOnce())
  expect(button).toBeDisabled()
  expect(button.parentElement?.querySelector('.monthly-export-spinner')).not.toBeNull()
  expect(deliverFile).not.toHaveBeenCalled()
  act(() => { complete?.(pdf) })
  await waitFor(() => expect(button).toBeEnabled())
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('PDF готов. Нажмите ещё раз')
  expect(deliverFile).not.toHaveBeenCalled()

  await user.click(button)
  expect(deliverFile).toHaveBeenCalledWith(pdf, navigator)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(prepareMonthlyPdf).toHaveBeenCalledOnce()
  await waitFor(() => expect(button).toBeEnabled())
  await user.click(button)
  expect(deliverFile).toHaveBeenCalledTimes(2)
  expect(prepareMonthlyPdf).toHaveBeenCalledOnce()
})



it('does not publish an obsolete PDF if the selected month changes during generation', async () => {
  deliverFile.mockResolvedValue('shared')
  let finishOld: ((file: File) => void) | undefined
  prepareMonthlyPdf.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
    .mockResolvedValueOnce(pdf)
  const user = userEvent.setup()
  const { rerender } = render(<MonthlyExportAction snapshot={snapshot} labels={labels} />)
  await user.click(screen.getByRole('button', { name: shareLabel }))
  await waitFor(() => expect(prepareMonthlyPdf).toHaveBeenCalledOnce())
  rerender(<MonthlyExportAction snapshot={{ ...snapshot, month: '2026-11' }} labels={labels} />)
  act(() => { finishOld?.(new File(['old'], 'old.pdf', { type: 'application/pdf' })) })
  const button = screen.getByRole('button', { name: shareLabel })
  expect(button).toBeEnabled()
  expect(deliverFile).not.toHaveBeenCalled()
  await user.click(button)
  await waitFor(() => expect(prepareMonthlyPdf).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(button).toBeEnabled())
  await user.click(button)
  expect(deliverFile).toHaveBeenCalledWith(pdf, navigator)
})
