import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { CityCatalogService } from '../../data/cityCatalog'
import { failure, success } from '../../domain/result'
import { useCityCatalog } from './useCityCatalog'

it('allows retry after seed fallback and ignores a superseded load callback', async () => {
  let resolveFirst!: (result: Awaited<ReturnType<CityCatalogService['load']>>) => void
  const firstLoad = new Promise<Awaited<ReturnType<CityCatalogService['load']>>>(resolve => { resolveFirst = resolve })
  const load = vi.fn<CityCatalogService['load']>()
    .mockReturnValueOnce(firstLoad)
    .mockResolvedValueOnce(success(undefined))
  const cities: CityCatalogService = {
    load,
    search: vi.fn<CityCatalogService['search']>(),
    findNearest: vi.fn<CityCatalogService['findNearest']>(),
    cancelPending: vi.fn(),
  }
  const { result } = renderHook(() => useCityCatalog({ cities }))

  act(() => result.current.loadCities())
  expect(result.current.cityCatalogStatus).toBe('loading')
  await act(() => {
    result.current.loadCities(true)
    return Promise.resolve()
  })

  expect(cities.cancelPending).toHaveBeenCalledOnce()
  expect(load).toHaveBeenCalledTimes(2)
  expect(result.current.cityCatalogStatus).toBe('ready')

  await act(async () => {
    resolveFirst(failure({ kind: 'data', reason: 'offline' }))
    await firstLoad
  })
  expect(result.current.cityCatalogStatus).toBe('ready')
})
