import { expect, it, vi } from 'vitest'

import type { MonthlyExportView } from './monthlyExportModel'
import { optimizePngResolution, prepareMonthlyExportFiles } from './monthlyExportRenderer'

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

it('chooses a high-resolution PNG candidate using measured encoded sizes', async () => {
  const widths: number[] = []
  const { width, blob } = await optimizePngResolution(candidateWidth => {
    widths.push(candidateWidth)
    return Promise.resolve(new Blob([new Uint8Array(Math.ceil(candidateWidth ** 2 / 3))]))
  }, { minWidth: 1136, maxWidth: 2000, maxBytes: 1_200_000 })

  expect(blob.size).toBeLessThanOrEqual(1_200_000)
  expect(width).toBeGreaterThan(1800)
  expect(widths.length).toBeLessThanOrEqual(7)
  expect(widths.some(candidateWidth => candidateWidth > width)).toBe(true)
})

it('fails safely when no readable PNG candidate fits the byte limit', async () => {
  const render = vi.fn(() => Promise.resolve(new Blob([new Uint8Array(1_200_001)])))

  await expect(optimizePngResolution(render, {
    minWidth: 1136, maxWidth: 2000, maxBytes: 1_200_000, maxAttempts: 3,
  })).rejects.toThrow('cannot fit the 1,200,000-byte size limit')
  expect(render).toHaveBeenCalledTimes(4)
})

it('publishes a ready format before preparing the other format', async () => {
  const pdf = new File(['pdf'], 'month.pdf', { type: 'application/pdf' })
  const png = new File(['png'], 'month.png', { type: 'image/png' })
  let finishPng: ((file: File) => void) | undefined
  const renderers = {
    pdf: vi.fn().mockResolvedValue(pdf),
    png: vi.fn(() => new Promise<File>(resolve => { finishPng = resolve })),
  }
  const onFormatReady = vi.fn()
  const preparation = prepareMonthlyExportFiles(view, renderers, onFormatReady)

  await vi.waitFor(() => expect(onFormatReady).toHaveBeenCalledWith('pdf', pdf))
  expect(renderers.png).toHaveBeenCalledOnce()
  finishPng?.(png)
  await expect(preparation).resolves.toEqual({ pdf, png, failures: [] })
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
