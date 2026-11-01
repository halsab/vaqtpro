import { expect, it, vi } from 'vitest'

import type { MonthlyExportView } from './monthlyExportModel'
import { encodePngOnceWithinLimit, prepareMonthlyExportFiles } from './monthlyExportRenderer'

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

it('encodes a PNG once and accepts a file at the byte limit', async () => {
  const render = vi.fn(() => Promise.resolve(new Blob([new Uint8Array(1_200_000)])))

  const blob = await encodePngOnceWithinLimit(render, 1_200_000)

  expect(blob.size).toBe(1_200_000)
  expect(render).toHaveBeenCalledOnce()
})

it('fails safely without a second render when the PNG exceeds the byte limit', async () => {
  const render = vi.fn(() => Promise.resolve(new Blob([new Uint8Array(1_200_001)])))

  await expect(encodePngOnceWithinLimit(render, 1_200_000)).rejects.toThrow('exceeds the 1,200,000-byte size limit')
  expect(render).toHaveBeenCalledOnce()
})

it('reuses the last three prepared month/location documents and evicts the least recently used', async () => {
  const renderers = {
    pdf: vi.fn((_view: MonthlyExportView, _month: string, filename: string) => Promise.resolve(new File(['pdf'], filename, { type: 'application/pdf' }))),
    png: vi.fn((_view: MonthlyExportView, _month: string, filename: string) => Promise.resolve(new File(['png'], filename, { type: 'image/png' }))),
  }
  const forMonth = (month: string): MonthlyExportView => ({ ...view, month, monthTitle: month })

  await prepareMonthlyExportFiles(forMonth('2026-10'), renderers)
  await prepareMonthlyExportFiles(forMonth('2026-11'), renderers)
  await prepareMonthlyExportFiles(forMonth('2026-12'), renderers)
  await prepareMonthlyExportFiles(forMonth('2026-10'), renderers)
  await prepareMonthlyExportFiles(forMonth('2027-01'), renderers)
  await prepareMonthlyExportFiles(forMonth('2026-10'), renderers)
  expect(renderers.pdf).toHaveBeenCalledTimes(4)
  expect(renderers.png).toHaveBeenCalledTimes(4)

  await prepareMonthlyExportFiles(forMonth('2026-11'), renderers)
  expect(renderers.pdf).toHaveBeenCalledTimes(5)
  expect(renderers.png).toHaveBeenCalledTimes(5)
})
