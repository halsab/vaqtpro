import { describe, expect, it } from 'vitest'
import { QiblaHeadingEvidenceGate, type HeadingEvidenceSample } from './qiblaHeadingEvidence'

const sample = (headingDegrees: number, timeMs: number, changes: Partial<HeadingEvidenceSample> = {}): HeadingEvidenceSample => ({
  headingDegrees, timeMs, source: 'webkit-compass', screenAngle: 0,
  motionRateDegreesPerSecond: null, reportedAccuracyDegrees: 5, ...changes,
})

describe('Qibla heading evidence continuity', () => {
  it('preserves ordinary fast turns and crosses north by the shortest arc', () => {
    const gate = new QiblaHeadingEvidenceGate()
    expect(gate.push(sample(359, 1000))).toMatchObject({ kind: 'accepted', headingDegrees: 359 })
    expect(gate.push(sample(1, 1020))).toMatchObject({ kind: 'accepted', headingDegrees: 1 })
    expect(gate.push(sample(81, 1100))).toMatchObject({ kind: 'accepted', headingDegrees: 81 })
  })

  it('quarantines a single abrupt jump, then recovers when the heading returns', () => {
    const gate = new QiblaHeadingEvidenceGate()
    gate.push(sample(0, 1000))
    expect(gate.push(sample(180, 1050))).toEqual({ kind: 'suspect', candidateHeadingDegrees: 180 })
    expect(gate.push(sample(180, 1055))).toEqual({ kind: 'suspect', candidateHeadingDegrees: 180 })
    expect(gate.push(sample(2, 1060))).toMatchObject({ kind: 'accepted', headingDegrees: 2, recoveredFromSuspect: true })
  })

  it('keeps a sustained ambiguous discontinuity untrusted without corroboration', () => {
    const gate = new QiblaHeadingEvidenceGate()
    gate.push(sample(0, 1000))
    expect(gate.push(sample(180, 1050)).kind).toBe('suspect')
    expect(gate.push(sample(180, 1055)).kind).toBe('suspect')
    expect(gate.push(sample(180, 1060)).kind).toBe('suspect')
  })

  it('allows a high-rate turn when optional motion evidence corroborates the change', () => {
    const gate = new QiblaHeadingEvidenceGate()
    gate.push(sample(0, 1000))
    expect(gate.push(sample(180, 1050, { motionRateDegreesPerSecond: 3600 })))
      .toMatchObject({ kind: 'accepted', headingDegrees: 180 })
  })

  it('quarantines a sudden large shift when motion evidence does not support it, even if it returns quickly', () => {
    const gate = new QiblaHeadingEvidenceGate()
    gate.push(sample(0, 1000))
    expect(gate.push(sample(180, 1100, { motionRateDegreesPerSecond: 0 })).kind).toBe('suspect')
    expect(gate.push(sample(2, 1150, { motionRateDegreesPerSecond: 0 })))
      .toMatchObject({ kind: 'accepted', headingDegrees: 2, recoveredFromSuspect: true })
  })

  it('accepts a rapid but temporally continuous turn after a short candidate quarantine', () => {
    const gate = new QiblaHeadingEvidenceGate()
    gate.push(sample(0, 1000))
    expect(gate.push(sample(150, 1100)).kind).toBe('suspect')
    expect(gate.push(sample(165, 1116)).kind).toBe('suspect')
    expect(gate.push(sample(180, 1132))).toMatchObject({ kind: 'accepted', headingDegrees: 180, recoveredFromSuspect: true })
  })

  it('reseeds on source, frame and long-gap transitions and rejects nonfinite readings', () => {
    const gate = new QiblaHeadingEvidenceGate()
    gate.push(sample(0, 1000))
    expect(gate.push(sample(180, 1010, { screenAngle: 90 }))).toMatchObject({ kind: 'accepted', headingDegrees: 180 })
    expect(gate.push(sample(0, 1020, { source: 'absolute-orientation-sensor' })).kind).toBe('accepted')
    expect(gate.push(sample(180, 3000)).kind).toBe('accepted')
    expect(gate.push(sample(Number.NaN, 3010))).toEqual({ kind: 'invalid' })
  })
})
