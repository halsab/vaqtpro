import { describe, expect, it } from 'vitest'
import { QiblaHeadingEvidenceGate, type HeadingEvidenceSample } from './qiblaHeadingEvidence'

const sample = (headingDegrees: number, timeMs: number, changes: Partial<HeadingEvidenceSample> = {}): HeadingEvidenceSample => ({
  headingDegrees, timeMs, source: 'webkit-compass', screenAngle: 0,
  motionRateDegreesPerSecond: null, reportedAccuracyDegrees: 5, ...changes,
})

describe('Qibla heading evidence continuity', () => {
  it('preserves fast turns within the source evidence limit and crosses north on the short arc', () => {
    const gate = new QiblaHeadingEvidenceGate()
    expect(gate.push(sample(359, 1000))).toMatchObject({ kind: 'accepted', headingDegrees: 359 })
    expect(gate.push(sample(1, 1020))).toMatchObject({ kind: 'accepted', headingDegrees: 1 })
    expect(gate.push(sample(81, 1100))).toMatchObject({ kind: 'accepted', headingDegrees: 81 })
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

  it('does not promote a sustained disturbance with unknown or degraded reported accuracy', () => {
    const gate = new QiblaHeadingEvidenceGate()
    gate.push(sample(0, 1000, { reportedAccuracyDegrees: 5 }))
    expect(gate.push(sample(180, 1050, { reportedAccuracyDegrees: 40 })).kind).toBe('suspect')
    expect(gate.push(sample(180, 1650, { reportedAccuracyDegrees: 40 })).kind).toBe('suspect')
    expect(gate.settle(3050)).toMatchObject({ kind: 'degraded', candidateHeadingDegrees: 180 })
  })

  it('accepts a fast turn when contemporaneous motion explains the heading change', () => {
    const gate = new QiblaHeadingEvidenceGate()
    gate.push(sample(0, 1000))
    expect(gate.push(sample(180, 1050, { motionRateDegreesPerSecond: 3600 })))
      .toMatchObject({ kind: 'accepted', headingDegrees: 180 })
  })

  it('recovers a candidate turn from fresh motion evidence when the source reports no accuracy', () => {
    const gate = new QiblaHeadingEvidenceGate()
    gate.push(sample(0, 1000, { reportedAccuracyDegrees: null }))
    expect(gate.push(sample(180, 1100, { reportedAccuracyDegrees: null })).kind).toBe('suspect')
    expect(gate.push(sample(240, 1160, {
      reportedAccuracyDegrees: null, motionRateDegreesPerSecond: 3600,
    })).kind).toBe('suspect')
    expect(gate.push(sample(270, 1200, {
      reportedAccuracyDegrees: null, motionRateDegreesPerSecond: 3600,
    }))).toMatchObject({ kind: 'accepted', headingDegrees: 270, recoveredFromSuspect: true })
  })

  it('accepts a time-coherent candidate turn without requiring an arbitrary sample count', () => {
    const gate = new QiblaHeadingEvidenceGate()
    gate.push(sample(0, 1000))
    expect(gate.push(sample(150, 1100)).kind).toBe('suspect')
    expect(gate.push(sample(165, 1116)).kind).toBe('suspect')
    expect(gate.push(sample(180, 1132)).kind).toBe('suspect')
    expect(gate.push(sample(225, 1180))).toMatchObject({ kind: 'accepted', headingDegrees: 225, recoveredFromSuspect: true })
  })

  it('ignores equal-time duplicates and nonmonotonic samples without reseeding the accepted heading', () => {
    const gate = new QiblaHeadingEvidenceGate()
    gate.push(sample(0, 1000))
    expect(gate.push(sample(1, 1000)).kind).toBe('ignored')
    expect(gate.push(sample(180, 1000)).kind).toBe('suspect')
    expect(gate.push(sample(90, 999)).kind).toBe('ignored')
    expect(gate.push(sample(2, 1010))).toMatchObject({ kind: 'accepted', headingDegrees: 2, recoveredFromSuspect: true })
  })

  it('quarantines an unexplained large change after a long sampling gap instead of trusting it as a new baseline', () => {
    const gate = new QiblaHeadingEvidenceGate()
    gate.push(sample(0, 1000))
    expect(gate.push(sample(180, 3001)).kind).toBe('suspect')
    expect(gate.settle(3601).kind).toBe('suspect')
    expect(gate.push(sample(180, 3601))).toMatchObject({ kind: 'accepted', headingDegrees: 180, recoveredFromSuspect: true })
  })

  it('checks screen-frame changes in a canonical device frame and rejects arbitrary source changes', () => {
    const gate = new QiblaHeadingEvidenceGate()
    gate.push(sample(0, 1000))
    expect(gate.push(sample(90, 1000, { screenAngle: 90 })))
      .toMatchObject({ kind: 'accepted', headingDegrees: 90 })
    expect(gate.push(sample(90, 1010, { source: 'absolute-orientation-sensor', screenAngle: 90 })))
      .toMatchObject({ kind: 'accepted', headingDegrees: 90 })
    expect(gate.push(sample(220, 1020, { source: 'webkit-compass' })).kind).toBe('suspect')
  })

  it('quarantines a frame or source transition when the reported accuracy has degraded', () => {
    const gate = new QiblaHeadingEvidenceGate()
    gate.push(sample(0, 1000, { reportedAccuracyDegrees: 5 }))
    expect(gate.push(sample(0, 1010, {
      source: 'absolute-orientation-sensor', screenAngle: 0, reportedAccuracyDegrees: 40,
    })).kind).toBe('suspect')
  })

  it('uses accuracy as a recovery constraint and rejects malformed evidence', () => {
    const gate = new QiblaHeadingEvidenceGate()
    gate.push(sample(0, 1000, { reportedAccuracyDegrees: 5 }))
    expect(gate.push(sample(180, 1050, { reportedAccuracyDegrees: 30 })).kind).toBe('suspect')
    expect(gate.settle(1650).kind).toBe('suspect')
    expect(gate.push(sample(180, 1700, { reportedAccuracyDegrees: 5 })).kind).toBe('suspect')
    expect(gate.push(sample(180, 2300, { reportedAccuracyDegrees: 5 })))
      .toMatchObject({ kind: 'accepted', headingDegrees: 180, recoveredFromSuspect: true })
    expect(gate.push(sample(20, 2310, { reportedAccuracyDegrees: 180 }))).toEqual({ kind: 'invalid' })
    expect(gate.push(sample(Number.NaN, 2320))).toEqual({ kind: 'invalid' })
  })
})
