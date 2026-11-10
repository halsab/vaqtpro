import { describe, expect, it } from 'vitest'

import { calculateQiblaBearing, estimateBearingOriginUncertainty, formatAngularUncertainty, roundAzimuthForDisplay, shortestAngleDelta, wrap360, wrapSigned } from './qibla'

describe('qibla bearing', () => {

  it('normalizes the dateline while preserving adhan spherical geometry', () => {
    const result = calculateQiblaBearing({ latitude: 21.4225241, longitude: 39.9261818, accuracy: null })
    expect(result.kind).toBe('bearing')
    if (result.kind === 'bearing') expect(result.azimuth).toBeCloseTo(270.018262, 4)

    const dateline = calculateQiblaBearing({ latitude: 0, longitude: 180, accuracy: null })
    const oppositeDateline = calculateQiblaBearing({ latitude: 0, longitude: -180, accuracy: null })
    expect(dateline).toEqual(oppositeDateline)
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

  it('uses the shortest signed turn through zero', () => {
    expect(shortestAngleDelta(359, 1)).toBe(2)
    expect(shortestAngleDelta(1, 359)).toBe(-2)
    expect(wrapSigned(180)).toBe(-180)
    expect(wrapSigned(-541)).toBe(179)
    expect(wrapSigned(541)).toBe(-179)
  })

})
