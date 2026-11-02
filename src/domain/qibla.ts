import { Coordinates, Qibla } from 'adhan'

import { validPosition, type Position } from './localGeography'

export type QiblaBearing =
  | { kind: 'bearing'; azimuth: number; normalizedLongitude: number }
  | { kind: 'undefined'; reason: 'invalid-position' | 'singular-position' }
export type BearingOriginUncertainty = { kind: 'unknown' } | { kind: 'unbounded' } | { kind: 'bounded'; radiusDegrees: number }

const KAABA = { latitude: 21.4225241, longitude: 39.8261818 } as const
const DEGREES_TO_RADIANS = Math.PI / 180
const SINGULAR_VECTOR_EPSILON = 1e-12

export function wrap360(degrees: number): number {
  return ((degrees % 360) + 360) % 360
}

export function wrapSigned(degrees: number): number {
  if (!Number.isFinite(degrees)) return Number.NaN
  const normalized = ((degrees % 360) + 360) % 360
  return normalized >= 180 ? normalized - 360 : normalized
}

export function shortestAngleDelta(from: number, to: number): number {
  return wrapSigned(to - from)
}

export function roundAzimuthForDisplay(degrees: number): number {
  return wrap360(Math.round(wrap360(degrees)))
}

export function formatAngularUncertainty(degrees: number, fractionDigits = 1): string {
  if (!Number.isFinite(degrees) || degrees < 0) return '—'
  const rounded = degrees.toFixed(fractionDigits)
  return degrees > 0 && Number(rounded) === 0 ? `<${(1 / 10 ** fractionDigits).toFixed(fractionDigits)}` : rounded
}

export function calculateQiblaBearing(position: Position): QiblaBearing {
  if (!validPosition(position)) return { kind: 'undefined', reason: 'invalid-position' }

  const longitude = normalizeLongitude(position.longitude)
  const angularDistance = sphericalAngularDistance(position.latitude, longitude, KAABA.latitude, KAABA.longitude)
  const antipodeDistance = Math.abs(Math.PI - angularDistance)
  if (Math.abs(position.latitude) === 90
    || angularDistance < SINGULAR_VECTOR_EPSILON
    || antipodeDistance < SINGULAR_VECTOR_EPSILON) {
    return { kind: 'undefined', reason: 'singular-position' }
  }

  const azimuth = Qibla(new Coordinates(position.latitude, longitude))
  if (!Number.isFinite(azimuth)) return { kind: 'undefined', reason: 'singular-position' }
  return { kind: 'bearing', azimuth: wrap360(azimuth), normalizedLongitude: longitude }
}

export function estimateBearingOriginUncertainty(position: Position): BearingOriginUncertainty {
  if (!validPosition(position) || position.accuracy === null) return { kind: 'unknown' }
  const centralAngle = sphericalAngularDistance(position.latitude, normalizeLongitude(position.longitude), KAABA.latitude, KAABA.longitude)
  const distanceToSingularityMeters = Math.min(centralAngle, Math.PI - centralAngle) * 6_371_008.8
  if (distanceToSingularityMeters <= position.accuracy) return { kind: 'unbounded' }
  const angularRadius = position.accuracy / 6_371_008.8
  const targetSine = Math.abs(Math.sin(centralAngle))
  if (angularRadius >= Math.PI / 2 || targetSine < 1e-12) return { kind: 'unbounded' }
  const sensitivity = Math.sin(angularRadius) / targetSine
  return { kind: 'bounded', radiusDegrees: Math.asin(Math.min(1, Math.max(0, sensitivity))) / DEGREES_TO_RADIANS }
}

function normalizeLongitude(longitude: number): number {
  const normalized = ((longitude + 180) % 360 + 360) % 360 - 180
  return Object.is(normalized, -0) ? 0 : normalized
}

function sphericalAngularDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = lat1 * DEGREES_TO_RADIANS
  const phi2 = lat2 * DEGREES_TO_RADIANS
  const deltaPhi = phi2 - phi1
  const deltaLambda = (lon2 - lon1) * DEGREES_TO_RADIANS
  const haversine = Math.sin(deltaPhi / 2) ** 2
    + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2
  return 2 * Math.atan2(Math.sqrt(Math.max(0, haversine)), Math.sqrt(Math.max(0, 1 - haversine)))
}
