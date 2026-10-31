import { expect, it, vi } from 'vitest'

import type { MonthlyExportView } from './monthlyExportModel'
import { prepareMonthlyExportFiles } from './monthlyExportRenderer'

const view: MonthlyExportView = {
  month: '2026-10', monthTitle: 'Октябрь 2026', location: 'Казань',
  headers: ['День', 'Фаджр', 'Восход', 'Зенит', 'Зухр', 'Аср', 'Магриб', 'Иша'],
  brandSubtitle: 'Времена намаза', sourcePrefix: 'Источник: ', sourceUrl: 'https://vaqt.pro', rows: [],
}

it('keeps PNG available when PDF rendering fails', async () => {
  const pdfFailure = vi.fn().mockRejectedValue(new Error('PDF renderer failed'))
  const pngFile = new File(['png'], 'month.png', { type: 'image/png' })
  const pngSuccess = vi.fn().mockResolvedValue(pngFile)

  await expect(prepareMonthlyExportFiles(view, { pdf: pdfFailure, png: pngSuccess })).resolves.toEqual({
    pdf: null, png: pngFile, failures: ['pdf'],
  })
  expect(pdfFailure).toHaveBeenCalledOnce()
  expect(pngSuccess).toHaveBeenCalledOnce()
})

it('keeps PDF available when PNG rendering fails', async () => {
  const pdfFile = new File(['pdf'], 'month.pdf', { type: 'application/pdf' })
  const pdfSuccess = vi.fn().mockResolvedValue(pdfFile)
  const pngFailure = vi.fn().mockRejectedValue(new Error('PNG renderer failed'))

  await expect(prepareMonthlyExportFiles(view, { pdf: pdfSuccess, png: pngFailure })).resolves.toEqual({
    pdf: pdfFile, png: null, failures: ['png'],
  })
  expect(pdfSuccess).toHaveBeenCalledOnce()
  expect(pngFailure).toHaveBeenCalledOnce()
})
it('reports failure only when both independent renderers fail', async () => {
  const renderers = {
    pdf: vi.fn().mockRejectedValue(new Error('PDF renderer failed')),
    png: vi.fn().mockRejectedValue(new Error('PNG renderer failed')),
  }

  await expect(prepareMonthlyExportFiles(view, renderers)).rejects.toThrow('Could not prepare monthly exports')
  expect(renderers.pdf).toHaveBeenCalledOnce()
  expect(renderers.png).toHaveBeenCalledOnce()
})
