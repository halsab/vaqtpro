import { describe, expect, it } from 'vitest'

import { calculateWmm2025 } from './wmm2025'

describe('WMM2025 NOAA reference values', () => {
  it.each([
    [2025, 0, 80, 0, 6521.6, 145.9, 54791.5, 6523.2, 55178.5, 83.21, 1.28],
    [2025, 0, 0, 120, 39677.8, -109.6, -10580.2, 39677.9, 41064.3, -14.93, -0.16],
    [2025, 0, -80, -120, 6117.5, 15751.9, -52022.5, 16898.1, 54698.2, -72, 68.78],
    [2025, 100, 80, 0, 6216, 92.4, 52598.8, 6216.7, 52964.9, 83.26, 0.85],
    [2025, 100, 0, 120, 37688.6, -96.2, -10152.1, 37688.7, 39032.1, -15.08, -0.15],
    [2025, 100, -80, -120, 5907.6, 14780.3, -49540.7, 15917.1, 52035, -72.19, 68.21],
    [2027.5, 0, 80, 0, 6500.8, 294.5, 54869.4, 6507.5, 55253.9, 83.24, 2.59],
    [2027.5, 0, 0, 120, 39701.6, -167.4, -10381.8, 39702, 41036.9, -14.65, -0.24],
    [2027.5, 0, -80, -120, 6200.7, 15730.3, -51783.7, 16908.3, 54474.2, -71.92, 68.49],
    [2027.5, 100, 80, 0, 6196.7, 233.8, 52670.5, 6201.1, 53034.3, 83.29, 2.16],
    [2027.5, 100, 0, 120, 37711.5, -148.7, -9969.8, 37711.8, 39007.4, -14.81, -0.23],
    [2027.5, 100, -80, -120, 5984, 14760.1, -49317.7, 15927, 51825.7, -72.1, 67.93],
  ])('matches NOAA vector at %s / %s km / (%s,%s)', (year, altitudeKm, latitude, longitude, x, y, z, h, f, inclination, declination) => {
    const result = calculateWmm2025({ year, altitudeKm, latitude, longitude })
    expect(result.kind).toBe('calculated')
    if (result.kind === 'calculated') {
      expect(Math.abs(result.x - x)).toBeLessThanOrEqual(0.1)
      expect(Math.abs(result.y - y)).toBeLessThanOrEqual(0.1)
      expect(Math.abs(result.z - z)).toBeLessThanOrEqual(0.1)
      expect(Math.abs(result.horizontalIntensityNt - h)).toBeLessThanOrEqual(0.1)
      expect(Math.abs(result.f - f)).toBeLessThanOrEqual(0.1)
      expect(Math.abs(result.inclinationDegrees - inclination)).toBeLessThanOrEqual(0.01)
      expect(Math.abs(result.declinationEastDegrees - declination)).toBeLessThanOrEqual(0.01)
    }
  })

  it('rejects dates outside WMM2025 validity and malformed input', () => {
    expect(calculateWmm2025({ year: 2024.99, altitudeKm: 0, latitude: 0, longitude: 0 }).kind).toBe('unsupported-date')
    expect(calculateWmm2025({ year: 2030, altitudeKm: 0, latitude: 0, longitude: 0 }).kind).toBe('unsupported-date')
    expect(calculateWmm2025({ year: 2025, altitudeKm: 0, latitude: 91, longitude: 0 }).kind).toBe('invalid-input')
  })
})
