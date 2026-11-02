import { describe, expect, it } from 'vitest'

import { classifyQiblaAccuracy } from './qiblaAccuracy'

describe('Qibla sensor accuracy classification', () => {
  it.each([
    [0, 'excellent'], [5, 'excellent'], [5.001, 'good'], [10, 'good'],
    [10.001, 'medium'], [20, 'medium'], [20.001, 'low'], [40, 'low'],
    [40.001, 'very-low'], [60, 'very-low'], [60.001, 'unavailable'],
    [90, 'unavailable'],
  ] as const)('classifies ±%s° as %s', (degrees, expected) => {
    expect(classifyQiblaAccuracy(degrees)).toBe(expected)
  })

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY, -0.01, 180, 360])(
    'treats unusable or missing accuracy %s as unknown', value => {
      expect(classifyQiblaAccuracy(value)).toBe('unknown')
    },
  )
})
