import type { GeolocationFailure } from '../domain/errors'
import { failure, success, type Result } from '../domain/result'

export type GeolocationPermission = PermissionState | 'unsupported'

export interface Coordinates {
  latitude: number
  longitude: number
  accuracy: number | null
  timestamp: number
}

export type PositionAccuracy = 'coarse' | 'precise'

export async function getGeolocationPermission(): Promise<GeolocationPermission> {
  const permissions = (navigator as { permissions?: Permissions }).permissions
  if (!permissions) return 'unsupported'

  try {
    return (await permissions.query({ name: 'geolocation' })).state
  } catch {
    return 'unsupported'
  }
}

export function getCurrentPosition(
  accuracy: PositionAccuracy = 'coarse',
): Promise<Result<Coordinates, GeolocationFailure>> {
  const geolocation = (navigator as { geolocation?: Geolocation }).geolocation
  if (!geolocation) {
    return Promise.resolve(failure({
      kind: 'geolocation',
      reason: 'unsupported',
    }))
  }

  return new Promise((resolve) => {
    try {
      geolocation.getCurrentPosition(
        ({ coords, timestamp }) =>
          resolve(success({
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy: Number.isFinite(coords.accuracy) ? coords.accuracy : null,
            timestamp,
          })),
        (error) => resolve(failure(mapPositionError(error))),
        accuracy === 'precise'
          ? { enableHighAccuracy: true, timeout: 30_000, maximumAge: 0 }
          : { enableHighAccuracy: false, timeout: 10_000, maximumAge: 0 },
      )
    } catch {
      resolve(failure({ kind: 'geolocation', reason: 'unavailable' }))
    }
  })
}

function mapPositionError(error: GeolocationPositionError): GeolocationFailure {
  if (error.code === 1) return { kind: 'geolocation', reason: 'denied' }
  if (error.code === 3) return { kind: 'geolocation', reason: 'timeout' }
  return { kind: 'geolocation', reason: 'unavailable' }
}

export function pulseHaptic(): void {
  if (typeof navigator.vibrate === 'function') {
    navigator.vibrate(8)
  }
}
