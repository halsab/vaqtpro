import { afterEach, describe, expect, it, vi } from 'vitest'

import { getCurrentPosition } from './browser'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('getCurrentPosition', () => {
  it('получает свежие coarse-координаты без устаревшего кэша', async () => {
    const getPosition = vi.fn((success: PositionCallback, _error?: PositionErrorCallback, _options?: PositionOptions) =>
      success({
        coords: { latitude: 55.8, longitude: 49.1, accuracy: 750 },
        timestamp: 123,
      } as GeolocationPosition),
    )
    vi.stubGlobal('navigator', {
      geolocation: { getCurrentPosition: getPosition },
    })

    await expect(getCurrentPosition('coarse')).resolves.toEqual({
      ok: true,
      value: {
        latitude: 55.8,
        longitude: 49.1,
        accuracy: 750,
        timestamp: 123,
      },
    })
    expect(getPosition.mock.calls[0]?.[2]).toEqual({
      enableHighAccuracy: false,
      timeout: 10_000,
      maximumAge: 0,
    })
  })

  it('запрашивает свежие точные координаты вне зоны официального расписания', async () => {
    const getPosition = vi.fn((success: PositionCallback, _error?: PositionErrorCallback, _options?: PositionOptions) =>
      success({
        coords: { latitude: 55.75, longitude: 37.62, accuracy: 12 },
        timestamp: 456,
      } as GeolocationPosition),
    )
    vi.stubGlobal('navigator', {
      geolocation: { getCurrentPosition: getPosition },
    })

    await getCurrentPosition('precise')

    expect(getPosition.mock.calls[0]?.[2]).toEqual({
      enableHighAccuracy: true,
      timeout: 30_000,
      maximumAge: 0,
    })
  })

  it.each([
    [1, 'denied'],
    [2, 'unavailable'],
    [3, 'timeout'],
  ] as const)('типизирует ошибку PositionError с кодом %s как %s', async (code, reason) => {
    const getPosition = vi.fn((
      _success: PositionCallback,
      error?: PositionErrorCallback,
      _options?: PositionOptions,
    ) => error?.({ code, message: 'browser error' } as GeolocationPositionError))
    vi.stubGlobal('navigator', {
      geolocation: { getCurrentPosition: getPosition },
    })

    await expect(getCurrentPosition()).resolves.toEqual({
      ok: false,
      error: { kind: 'geolocation', reason },
    })
  })

  it('отличает отсутствие browser geolocation API', async () => {
    vi.stubGlobal('navigator', {})

    await expect(getCurrentPosition()).resolves.toEqual({
      ok: false,
      error: { kind: 'geolocation', reason: 'unsupported' },
    })
  })
})
