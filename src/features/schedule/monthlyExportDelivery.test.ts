import { afterEach, expect, it, vi } from 'vitest'

import { deliverFile } from './monthlyExportDelivery'

const file = new File(['month'], 'VaqtPro_moscow_2026-10.pdf', { type: 'application/pdf' })
afterEach(() => vi.restoreAllMocks())

it('shares only a file the current platform confirms it can share', async () => {
  const share = vi.fn().mockResolvedValue(undefined)
  const canShare = vi.fn().mockReturnValue(true)
  const fallback = vi.fn()
  await expect(deliverFile(file, { share, canShare }, fallback)).resolves.toBe('shared')
  expect(canShare).toHaveBeenCalledWith({ files: [file] })
  expect(share).toHaveBeenCalledWith({ files: [file] })
  expect(fallback).not.toHaveBeenCalled()
})

it('downloads when file sharing is unsupported or capability checks fail', async () => {
  const fallback = vi.fn()
  await expect(deliverFile(file, {}, fallback)).resolves.toBe('download-started')
  await expect(deliverFile(file, { share: vi.fn(), canShare: () => false }, fallback)).resolves.toBe('download-started')
  await expect(deliverFile(file, { share: vi.fn(), canShare: () => { throw new Error('unsupported') } }, fallback)).resolves.toBe('download-started')
  expect(fallback).toHaveBeenCalledTimes(3)
  expect(fallback).toHaveBeenCalledWith(file)
})

it('treats share cancellation silently and does not unexpectedly download', async () => {
  const fallback = vi.fn()
  const share = vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError'))
  await expect(deliverFile(file, { share, canShare: () => true }, fallback)).resolves.toBe('cancelled')
  expect(fallback).not.toHaveBeenCalled()
})

it('reports share errors without a misleading download fallback', async () => {
  const fallback = vi.fn()
  await expect(deliverFile(file, { share: vi.fn().mockRejectedValue(new Error('failed')), canShare: () => true }, fallback)).resolves.toBe('failed')
  expect(fallback).not.toHaveBeenCalled()
})
