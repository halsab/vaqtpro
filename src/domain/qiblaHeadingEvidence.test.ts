import { describe, expect, it } from 'vitest'
import { QiblaHeadingEvidenceGate, type HeadingEvidenceSample } from './qiblaHeadingEvidence'

const sample = (headingDegrees: number, timeMs: number, changes: Partial<HeadingEvidenceSample> = {}): HeadingEvidenceSample => ({
  headingDegrees, timeMs, source: 'webkit-compass', screenAngle: 0,
  motionHeadingDeltaDegrees: null, motionEvidenceCoverage: 0, reportedAccuracyDegrees: 5, ...changes,
})

describe('Qibla heading evidence continuity', () => {
  it('preserves fast turns within the source evidence limit and crosses north on the short arc', () => {
    const gate = new QiblaHeadingEvidenceGate()
    expect(gate.push(sample(359, 1000))).toMatchObject({ kind: 'accepted', headingDegrees: 359 })
    expect(gate.push(sample(1, 1020))).toMatchObject({ kind: 'accepted', headingDegrees: 1 })
    expect(gate.push(sample(81, 1100))).toMatchObject({ kind: 'accepted', headingDegrees: 81 })
  })


  it('rejects poor accuracy on the first sample after a source transition', () => {
    const gate = new QiblaHeadingEvidenceGate()
    gate.push(sample(20, 1000, { reportedAccuracyDegrees: 5 }))
    expect(gate.push(sample(20, 1016, {
      source: 'absolute-orientation-sensor', reportedAccuracyDegrees: 90,
    }))).toMatchObject({ kind: 'degraded' })
    expect(gate.push(sample(21, 1032, {
      source: 'absolute-orientation-sensor', reportedAccuracyDegrees: 8,
    }))).toMatchObject({ kind: 'accepted', headingDegrees: 21 })
  })

  it('quarantines a transient jump, then recovers when readings return near the accepted direction', () => {
    const gate = new QiblaHeadingEvidenceGate()
    gate.push(sample(0, 1000))
    expect(gate.push(sample(180, 1050)).kind).toBe('suspect')
    expect(gate.push(sample(180, 1055)).kind).toBe('suspect')
    expect(gate.push(sample(2, 1060))).toMatchObject({ kind: 'accepted', headingDegrees: 2, recoveredFromSuspect: true })
  })

  it('recovers a genuine rapid turn followed by stationary, accurately reported readings after a time bound', () => {
    const gate = new QiblaHeadingEvidenceGate()
    gate.push(sample(0, 1000))
    expect(gate.push(sample(180, 1050)).kind).toBe('suspect')
    expect(gate.push(sample(180, 1200)).kind).toBe('suspect')
    expect(gate.settle(1649).kind).toBe('suspect')
    expect(gate.settle(1650).kind).toBe('suspect')
    expect(gate.push(sample(180, 1650))).toMatchObject({ kind: 'accepted', headingDegrees: 180, recoveredFromSuspect: true })
  })




  it('accepts a fast turn when contemporaneous motion explains the heading change', () => {
    const gate = new QiblaHeadingEvidenceGate()
    gate.push(sample(0, 1000))
    expect(gate.push(sample(180, 1050, { motionHeadingDeltaDegrees: 180, motionEvidenceCoverage: 1 })))
      .toMatchObject({ kind: 'accepted', headingDegrees: 180 })
  })

  it('does not accept a magnetic jump when gyro evidence explains only pitch or roll', () => {
    const gate = new QiblaHeadingEvidenceGate()
    gate.push(sample(0, 1000))
    expect(gate.push(sample(180, 1050, {
      motionHeadingDeltaDegrees: 0, motionEvidenceCoverage: 1,
    })).kind).toBe('suspect')
  })




  it('ignores duplicate and out-of-order samples even when their reported accuracy changes', () => {
    const gate = new QiblaHeadingEvidenceGate()
    gate.push(sample(0, 1000, { reportedAccuracyDegrees: 25 }))
    expect(gate.push(sample(1, 1000, { reportedAccuracyDegrees: 1 })).kind).toBe('ignored')
    expect(gate.push(sample(180, 1000, { reportedAccuracyDegrees: 0 })).kind).toBe('ignored')
    expect(gate.push(sample(90, 999, { reportedAccuracyDegrees: 0 })).kind).toBe('ignored')
    expect(gate.push(sample(2, 1010, { reportedAccuracyDegrees: 25 })))
      .toMatchObject({ kind: 'accepted', headingDegrees: 2, recoveredFromSuspect: false })
  })






})
