import { wrap360, wrapSigned } from './qibla'

export type NorthReference = 'magnetic' | 'true' | 'unknown'

export type HeadingResult =
  | { kind: 'true-heading'; degrees: number }
  | { kind: 'unavailable'; reason: 'invalid-heading' | 'unknown-reference' | 'declination-unavailable' }

export function toTrueHeading(headingDegrees: number, northReference: NorthReference, eastDeclinationDegrees?: number): HeadingResult {
  if (!Number.isFinite(headingDegrees)) return { kind: 'unavailable', reason: 'invalid-heading' }
  if (northReference === 'unknown') return { kind: 'unavailable', reason: 'unknown-reference' }
  if (northReference === 'true') return { kind: 'true-heading', degrees: wrap360(headingDegrees) }
  if (eastDeclinationDegrees === undefined || !Number.isFinite(eastDeclinationDegrees)) {
    return { kind: 'unavailable', reason: 'declination-unavailable' }
  }
  return { kind: 'true-heading', degrees: wrap360(headingDegrees + eastDeclinationDegrees) }
}

export function qiblaRelativeAngle(qiblaTrueAzimuth: number, deviceTrueHeading: number): number | null {
  if (!Number.isFinite(qiblaTrueAzimuth) || !Number.isFinite(deviceTrueHeading)) return null
  return wrapSigned(qiblaTrueAzimuth - deviceTrueHeading)
}
