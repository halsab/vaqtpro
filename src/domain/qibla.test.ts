import { describe, expect, it } from 'vitest'

import { calculateQiblaBearing, estimateBearingOriginUncertainty, formatAngularUncertainty, roundAzimuthForDisplay, shortestAngleDelta, wrap360, wrapSigned } from './qibla'

describe('qibla bearing', () => {
  it.each([
    ['Warsaw', 52.2297, 21.0122, 147.587332],
    ['Kazan', 55.7963, 49.1088, 195.152264],
    ['New York', 40.7128, -74.006, 58.481697],
    ['Jakarta', -6.2088, 106.8456, 295.151756],
    ['Sydney', -33.8688, 151.2093, 277.499604],
    ['Tokyo', 35.6762, 139.6503, 292.99871],
    ['London', 51.5074, -0.1278, 118.987219],
    ['Lima', -12.0464, -77.0428, 72.026546],
  ])('matches the adhan reference vector for %s', (_name, latitude, longitude, expected) => {
    const result = calculateQiblaBearing({ latitude, longitude, accuracy: null })
    expect(result.kind).toBe('bearing')
    if (result.kind === 'bearing') expect(result.azimuth).toBeCloseTo(expected, 5)
  })

  it('normalizes the dateline while preserving adhan spherical geometry', () => {
    const result = calculateQiblaBearing({ latitude: 21.4225241, longitude: 39.9261818, accuracy: null })
    expect(result.kind).toBe('bearing')
    if (result.kind === 'bearing') expect(result.azimuth).toBeCloseTo(270.018262, 4)

    const dateline = calculateQiblaBearing({ latitude: 0, longitude: 180, accuracy: null })
    const oppositeDateline = calculateQiblaBearing({ latitude: 0, longitude: -180, accuracy: null })
    expect(dateline).toEqual(oppositeDateline)
  })

  it.each([
    { latitude: Number.NaN, longitude: 0, accuracy: null },
    { latitude: 0, longitude: Number.POSITIVE_INFINITY, accuracy: null },
    { latitude: 91, longitude: 0, accuracy: null },
    { latitude: 0, longitude: 181, accuracy: null },
    { latitude: 0, longitude: 0, accuracy: -1 },
  ])('rejects malformed coordinates: $latitude, $longitude', position => {
    expect(calculateQiblaBearing(position)).toEqual({ kind: 'undefined', reason: 'invalid-position' })
  })

  it('withholds non-unique bearings at the Kaaba, its antipode and the geographic poles', () => {
    expect(calculateQiblaBearing({ latitude: 21.4225241, longitude: 39.8261818, accuracy: null }))
      .toEqual({ kind: 'undefined', reason: 'singular-position' })
    expect(calculateQiblaBearing({ latitude: -21.4225241, longitude: -140.1738182, accuracy: null }))
      .toEqual({ kind: 'undefined', reason: 'singular-position' })
    expect(calculateQiblaBearing({ latitude: 90, longitude: 0, accuracy: null }))
      .toEqual({ kind: 'undefined', reason: 'singular-position' })
  })

  it('keeps location-origin uncertainty separate from compass accuracy', () => {
    expect(estimateBearingOriginUncertainty({ latitude: 55.7963, longitude: 49.1088, accuracy: null }))
      .toEqual({ kind: 'unknown' })
    expect(estimateBearingOriginUncertainty({ latitude: 55.7963, longitude: 49.1088, accuracy: 100 }))
      .toMatchObject({ kind: 'bounded' })
    expect(estimateBearingOriginUncertainty({ latitude: 21.4225241, longitude: 39.8261818, accuracy: 100 }))
      .toEqual({ kind: 'unbounded' })
    expect(estimateBearingOriginUncertainty({ latitude: -21.4225241, longitude: -140.1728182, accuracy: 200 }))
      .toEqual({ kind: 'unbounded' })
  })

  it('withholds the pointer when a GPS uncertainty disk reaches a Qibla singularity', () => {
    const nearKaaba = { latitude: 21.4225241, longitude: 39.8261818, accuracy: 10 }
    const nearAntipode = { latitude: -21.4225241, longitude: -140.1738182, accuracy: 10 }
    expect(estimateBearingOriginUncertainty(nearKaaba)).toEqual({ kind: 'unbounded' })
    expect(estimateBearingOriginUncertainty(nearAntipode)).toEqual({ kind: 'unbounded' })
    expect(estimateBearingOriginUncertainty({ ...nearKaaba, accuracy: 0 })).toEqual({ kind: 'unbounded' })
  })
})

describe('circular angles', () => {
  it.each([[ -1, 359 ], [360, 0], [721, 1]])('wraps %i to %i', (angle, expected) => {
    expect(wrap360(angle)).toBe(expected)
  })

  it('uses the shortest signed turn through zero', () => {
    expect(shortestAngleDelta(359, 1)).toBe(2)
    expect(shortestAngleDelta(1, 359)).toBe(-2)
    expect(wrapSigned(180)).toBe(-180)
  })

  it('rounds azimuth through 360 to zero and never renders small uncertainty as exact zero', () => {
    expect(roundAzimuthForDisplay(359.8)).toBe(0)
    expect(roundAzimuthForDisplay(359.4)).toBe(359)
    expect(formatAngularUncertainty(0.001)).toBe('<0.1')
    expect(formatAngularUncertainty(0)).toBe('0.0')
  })
})
