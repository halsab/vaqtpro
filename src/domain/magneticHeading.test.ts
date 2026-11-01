import { describe, expect, it } from 'vitest'

import { qiblaRelativeAngle, toTrueHeading } from './magneticHeading'

describe('magnetic heading conversion', () => {
  it('applies east-positive declination once', () => {
    expect(toTrueHeading(30, 'magnetic', 10)).toEqual({ kind: 'true-heading', degrees: 40 })
    expect(qiblaRelativeAngle(140, 40)).toBe(100)
    expect(toTrueHeading(30, 'magnetic', -10)).toEqual({ kind: 'true-heading', degrees: 20 })
    expect(qiblaRelativeAngle(140, 20)).toBe(120)
  })

  it('wraps magnetic and true headings across north', () => {
    expect(toTrueHeading(359, 'magnetic', 2)).toEqual({ kind: 'true-heading', degrees: 1 })
    expect(toTrueHeading(361, 'true')).toEqual({ kind: 'true-heading', degrees: 1 })
    expect(qiblaRelativeAngle(1, 359)).toBe(2)
  })

  it('never treats unknown north or missing model output as true north', () => {
    expect(toTrueHeading(30, 'unknown', 10)).toEqual({ kind: 'unavailable', reason: 'unknown-reference' })
    expect(toTrueHeading(30, 'magnetic')).toEqual({ kind: 'unavailable', reason: 'declination-unavailable' })
    expect(toTrueHeading(Number.NaN, 'true')).toEqual({ kind: 'unavailable', reason: 'invalid-heading' })
  })
})
