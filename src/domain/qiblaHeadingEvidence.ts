import { shortestAngleDelta, wrap360 } from './qibla'

export interface HeadingEvidenceSample {
  headingDegrees: number
  timeMs: number
  source: string
  screenAngle: number
  motionRateDegreesPerSecond: number | null
  reportedAccuracyDegrees: number | null
}

export type HeadingEvidenceDecision =
  | { kind: 'accepted'; headingDegrees: number; recoveredFromSuspect: boolean }
  | { kind: 'suspect'; candidateHeadingDegrees: number }
  | { kind: 'invalid' }

// Предварительные пределы для карантина одиночных скачков; требуют калибровки на устройствах.
const MAX_UNCORROBORATED_TURN_RATE_DPS = 1080
const MAX_SAMPLE_GAP_MS = 1000
const MIN_CANDIDATE_PROGRESS_DEGREES = 2
const MOTION_CORROBORATION_RATIO = 0.65

export class QiblaHeadingEvidenceGate {
  private accepted: HeadingEvidenceSample | null = null
  private candidate: HeadingEvidenceSample | null = null
  private candidateDirection = 0
  private candidateProgressSamples = 0

  reset() {
    this.accepted = null
    this.clearCandidate()
  }

  push(sample: HeadingEvidenceSample): HeadingEvidenceDecision {
    if (!Number.isFinite(sample.headingDegrees) || !Number.isFinite(sample.timeMs)
      || !Number.isFinite(sample.screenAngle)
      || (sample.motionRateDegreesPerSecond !== null
        && (!Number.isFinite(sample.motionRateDegreesPerSecond) || sample.motionRateDegreesPerSecond < 0))) {
      return { kind: 'invalid' }
    }

    const normalized = { ...sample, headingDegrees: wrap360(sample.headingDegrees) }
    const previous = this.accepted
    if (!previous || previous.source !== normalized.source || previous.screenAngle !== normalized.screenAngle
      || normalized.timeMs <= previous.timeMs || normalized.timeMs - previous.timeMs > MAX_SAMPLE_GAP_MS) {
      this.accepted = normalized
      const recoveredFromSuspect = this.candidate !== null
      this.clearCandidate()
      return { kind: 'accepted', headingDegrees: normalized.headingDegrees, recoveredFromSuspect }
    }

    const elapsedMs = normalized.timeMs - previous.timeMs
    const delta = shortestAngleDelta(previous.headingDegrees, normalized.headingDegrees)
    const maxPlausibleChange = MAX_UNCORROBORATED_TURN_RATE_DPS * elapsedMs / 1000
    const motionExplainsChange = normalized.motionRateDegreesPerSecond !== null
      && normalized.motionRateDegreesPerSecond * elapsedMs / 1000 >= Math.abs(delta) * MOTION_CORROBORATION_RATIO
    if (Math.abs(delta) <= maxPlausibleChange || motionExplainsChange) {
      this.accepted = normalized
      const recoveredFromSuspect = this.candidate !== null
      this.clearCandidate()
      return { kind: 'accepted', headingDegrees: normalized.headingDegrees, recoveredFromSuspect }
    }

    const priorCandidate = this.candidate
    if (!priorCandidate) {
      this.candidate = normalized
      this.candidateDirection = Math.sign(delta)
      this.candidateProgressSamples = 0
      return { kind: 'suspect', candidateHeadingDegrees: normalized.headingDegrees }
    }

    const candidateStep = shortestAngleDelta(priorCandidate.headingDegrees, normalized.headingDegrees)
    const candidateElapsed = normalized.timeMs - priorCandidate.timeMs
    const progressesInSameDirection = Math.sign(candidateStep) === this.candidateDirection
      && Math.abs(candidateStep) >= MIN_CANDIDATE_PROGRESS_DEGREES
      && candidateElapsed > 0
      && Math.abs(candidateStep) <= MAX_UNCORROBORATED_TURN_RATE_DPS * candidateElapsed / 1000
    if (progressesInSameDirection) {
      this.candidate = normalized
      this.candidateProgressSamples += 1
      if (this.candidateProgressSamples >= 2) {
        this.accepted = normalized
        this.clearCandidate()
        return { kind: 'accepted', headingDegrees: normalized.headingDegrees, recoveredFromSuspect: true }
      }
    } else if (Math.abs(shortestAngleDelta(previous.headingDegrees, normalized.headingDegrees)) <= MIN_CANDIDATE_PROGRESS_DEGREES) {
      this.accepted = normalized
      this.clearCandidate()
      return { kind: 'accepted', headingDegrees: normalized.headingDegrees, recoveredFromSuspect: true }
    } else {
      this.candidate = normalized
      this.candidateDirection = Math.sign(shortestAngleDelta(previous.headingDegrees, normalized.headingDegrees))
      this.candidateProgressSamples = 0
    }

    return { kind: 'suspect', candidateHeadingDegrees: normalized.headingDegrees }
  }

  private clearCandidate() {
    this.candidate = null
    this.candidateDirection = 0
    this.candidateProgressSamples = 0
  }
}
