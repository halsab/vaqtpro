import { describe, expect, it, vi } from 'vitest'

import {
  createServiceWorkerReloadGuard,
  deferServiceWorkerReload,
  type ServiceWorkerReloadMemory,
} from './serviceWorkerUpdate'

function createMemoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}

describe('service worker update reload guard', () => {
  it('схлопывает повторные callback одного обновления в один reload', () => {
    const reload = vi.fn()
    const guard = createServiceWorkerReloadGuard({
      reload,
      now: () => 10_000,
      storage: createMemoryStorage(),
      memory: {},
    })

    guard()
    guard()

    expect(reload).toHaveBeenCalledTimes(1)
  })


  it('разрешает reload для настоящего обновления после истечения окна', () => {
    const reload = vi.fn()
    const storage = createMemoryStorage()
    let now = 30_000
    const memory: ServiceWorkerReloadMemory = {}
    const guard = createServiceWorkerReloadGuard({
      reload,
      now: () => now,
      storage,
      memory,
      guardWindowMs: 5_000,
    })

    guard()
    now += 5_001
    guard()

    expect(reload).toHaveBeenCalledTimes(2)
  })

})


describe('service worker reload deferrals', () => {
  it('does not reload while monthly export is active and resumes once after leaving', () => {
    const reload = vi.fn()
    const guard = createServiceWorkerReloadGuard({
      reload,
      now: () => 50_000,
      storage: createMemoryStorage(),
      memory: {},
    })
    const finish = deferServiceWorkerReload()
    const finishNested = deferServiceWorkerReload()
    guard()
    guard()
    expect(reload).not.toHaveBeenCalled()
    finish()
    expect(reload).not.toHaveBeenCalled()
    finishNested()
    finishNested()
    expect(reload).toHaveBeenCalledOnce()
  })
})
