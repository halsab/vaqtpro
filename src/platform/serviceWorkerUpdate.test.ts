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

  it('не перезагружает повторно при пересоздании callback внутри окна', () => {
    const reload = vi.fn()
    const storage = createMemoryStorage()
    createServiceWorkerReloadGuard({
      reload,
      now: () => 20_000,
      storage,
      memory: {},
    })()

    createServiceWorkerReloadGuard({
      reload,
      now: () => 20_001,
      storage,
      memory: {},
    })()

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

  it('при недоступном sessionStorage всё равно делает один reload на страницу', () => {
    const reload = vi.fn()
    const unavailableStorage = {
      getItem: () => {
        throw new Error('sessionStorage disabled')
      },
      setItem: () => {
        throw new Error('sessionStorage disabled')
      },
    }
    const memory: ServiceWorkerReloadMemory = {}

    createServiceWorkerReloadGuard({
      reload,
      now: () => 40_000,
      storage: unavailableStorage,
      memory,
    })()
    createServiceWorkerReloadGuard({
      reload,
      now: () => 40_001,
      storage: unavailableStorage,
      memory,
    })()

    expect(reload).toHaveBeenCalledTimes(1)
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
