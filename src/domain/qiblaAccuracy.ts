export type QiblaAccuracyCategory =
  | 'excellent'
  | 'good'
  | 'medium'
  | 'low'
  | 'very-low'
  | 'unavailable'
  | 'unknown'

export function classifyQiblaAccuracy(degrees: number | null): QiblaAccuracyCategory {
  if (degrees === null || !Number.isFinite(degrees) || degrees < 0 || degrees >= 180) return 'unknown'
  if (degrees <= 5) return 'excellent'
  if (degrees <= 10) return 'good'
  if (degrees <= 20) return 'medium'
  if (degrees <= 40) return 'low'
  if (degrees <= 60) return 'very-low'
  return 'unavailable'
}
