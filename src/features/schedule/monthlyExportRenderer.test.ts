import { expect, it, vi } from 'vitest'

import type { MonthlyExportView } from './monthlyExportModel'
import { prepareMonthlyPdf } from './monthlyExportRenderer'

const view: MonthlyExportView = {
  month: '2026-10', monthTitle: 'Октябрь 2026', location: 'Казань',
  headers: ['День', 'Фаджр', 'Восход', 'Зенит', 'Зухр', 'Аср', 'Магриб', 'Иша'],
  brandSubtitle: 'Времена намаза', sourcePrefix: 'Источник: ', sourceUrl: 'https://vaqt.pro', rows: [],
}

it('generates only a PDF with the current month/location and caches the result', async () => {
  const renderer = vi.fn((_view: MonthlyExportView, _month: string, filename: string) =>
    Promise.resolve(new File(['pdf'], filename, { type: 'application/pdf' })))
  const file = await prepareMonthlyPdf(view, renderer)
  expect(file.name).toBe('VaqtPro_казань_2026-10.pdf')
  expect(file.type).toBe('application/pdf')
  expect(await prepareMonthlyPdf(view, renderer)).toBe(file)
  expect(renderer).toHaveBeenCalledOnce()
})

it('does not cache generation failures and allows retry', async () => {
  const renderer = vi.fn()
    .mockRejectedValueOnce(new Error('PDF renderer failed'))
    .mockResolvedValueOnce(new File(['pdf'], 'month.pdf', { type: 'application/pdf' }))
  await expect(prepareMonthlyPdf(view, renderer)).rejects.toThrow('PDF renderer failed')
  await expect(prepareMonthlyPdf(view, renderer)).resolves.toHaveProperty('type', 'application/pdf')
  expect(renderer).toHaveBeenCalledTimes(2)
})

it('deduplicates concurrent preparation of an identical snapshot', async () => {
  let finish: ((file: File) => void) | undefined
  const renderer = vi.fn(() => new Promise<File>(resolve => { finish = resolve }))
  const first = prepareMonthlyPdf(view, renderer)
  const second = prepareMonthlyPdf(view, renderer)
  expect(first).toBe(second)
  await vi.waitFor(() => expect(renderer).toHaveBeenCalledOnce())
  finish?.(new File(['pdf'], 'month.pdf', { type: 'application/pdf' }))
  await expect(first).resolves.toHaveProperty('type', 'application/pdf')
})


