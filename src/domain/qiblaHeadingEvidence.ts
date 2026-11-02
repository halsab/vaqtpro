import { shortestAngleDelta, wrap360 } from './qibla'

export interface HeadingEvidenceSample {
  headingDegrees: number
  timeMs: number
  source: string
  screenAngle: number
  motionHeadingDeltaDegrees: number | null
  motionEvidenceCoverage: number
  reportedAccuracyDegrees: number | null
}

export type HeadingEvidenceDecision =
  | { kind: 'accepted'; headingDegrees: number; recoveredFromSuspect: boolean; confidence: 'supported' | 'limited' }
  | { kind: 'suspect'; candidateHeadingDegrees: number }
  | { kind: 'degraded'; candidateHeadingDegrees: number }
  | { kind: 'ignored' }
  | { kind: 'invalid' }

// Предварительные пороги доверия к датчикам; их нужно проверить на устройствах.
const MAX_UNCORROBORATED_TURN_RATE_DPS = 1080
const MAX_SAMPLE_GAP_MS = 1000
const MIN_CANDIDATE_PROGRESS_DEGREES = 2
const MOTION_CORROBORATION_RATIO = 0.65
const MAX_MOTION_CORROBORATION_INTERVAL_MS = 250
const MIN_STATIONARY_RECOVERY_MS = 600
const MIN_UNVERIFIED_STATIONARY_RECOVERY_MS = 1500
const MAX_QUARANTINE_MS = 2000
const MIN_COHERENT_TURN_MS = 80
const MIN_COHERENT_TURN_DEGREES = 30
const MAX_RECOVERY_ACCURACY_DEGREES = 15
const MAX_LIVE_ACCURACY_DEGREES = 60
const MAX_ACCURACY_WORSENING_DEGREES = 10
const MAX_STATIONARY_STEP_DEGREES = 4
const ACCURACY_MATCH_CAP_DEGREES = 20

interface Candidate {
  sample: HeadingEvidenceSample
  deviceHeading: number
  startedAtMs: number
  stableSinceMs: number
  direction: number
  coherentTravelDegrees: number
  baselineAccuracyDegrees: number | null
  initialCandidateAccuracyDegrees: number | null
  lastSeenAtMs: number
}

export class QiblaHeadingEvidenceGate {
  private accepted: HeadingEvidenceSample | null = null
  private candidate: Candidate | null = null
  private lastObservedTimeMs: number | null = null

  reset() {
    this.accepted = null
    this.candidate = null
    this.lastObservedTimeMs = null
  }

  settle(nowMs: number): HeadingEvidenceDecision {
    const candidate = this.candidate
    if (!candidate || !Number.isFinite(nowMs) || nowMs < candidate.startedAtMs) return { kind: 'ignored' }
    if (nowMs - candidate.startedAtMs >= MAX_QUARANTINE_MS) {
      return { kind: 'degraded', candidateHeadingDegrees: candidate.sample.headingDegrees }
    }
    return { kind: 'suspect', candidateHeadingDegrees: candidate.sample.headingDegrees }
  }

  push(sample: HeadingEvidenceSample): HeadingEvidenceDecision {
    if (!Number.isFinite(sample.headingDegrees) || !Number.isFinite(sample.timeMs)
      || !Number.isFinite(sample.screenAngle)
      || (sample.motionHeadingDeltaDegrees !== null && !Number.isFinite(sample.motionHeadingDeltaDegrees))
      || !Number.isFinite(sample.motionEvidenceCoverage) || sample.motionEvidenceCoverage < 0 || sample.motionEvidenceCoverage > 1
      || (sample.reportedAccuracyDegrees !== null
        && (!Number.isFinite(sample.reportedAccuracyDegrees) || sample.reportedAccuracyDegrees < 0
          || sample.reportedAccuracyDegrees >= 180))) return { kind: 'invalid' }

    const normalized = { ...sample, headingDegrees: wrap360(sample.headingDegrees) }
    if (this.lastObservedTimeMs !== null && normalized.timeMs < this.lastObservedTimeMs) return { kind: 'ignored' }
    if (this.lastObservedTimeMs !== null && normalized.timeMs === this.lastObservedTimeMs) {
      if (normalized.reportedAccuracyDegrees !== null && normalized.reportedAccuracyDegrees > MAX_LIVE_ACCURACY_DEGREES) {
        this.candidate = null
        return { kind: 'degraded', candidateHeadingDegrees: normalized.headingDegrees }
      }
      return { kind: 'ignored' }
    }
    if (this.candidate?.lastSeenAtMs === normalized.timeMs) return { kind: 'ignored' }
    this.lastObservedTimeMs = normalized.timeMs
    if (normalized.reportedAccuracyDegrees !== null && normalized.reportedAccuracyDegrees > MAX_LIVE_ACCURACY_DEGREES) {
      this.candidate = null
      return { kind: 'degraded', candidateHeadingDegrees: normalized.headingDegrees }
    }

    const previous = this.accepted
    if (!previous) {
      this.accepted = normalized
      return { kind: 'accepted', headingDegrees: normalized.headingDegrees, recoveredFromSuspect: false, confidence: 'supported' }
    }

    const transitioned = previous.source !== normalized.source || previous.screenAngle !== normalized.screenAngle
    if (transitioned && this.isKnownFrameOrSourceContinuation(previous, normalized)) {
      this.accepted = normalized
      const recoveredFromSuspect = this.candidate !== null
      this.candidate = null
      return { kind: 'accepted', headingDegrees: normalized.headingDegrees, recoveredFromSuspect, confidence: 'supported' }
    }
    if (transitioned) return this.startCandidate(normalized, previous)

    const elapsedMs = normalized.timeMs - previous.timeMs
    if (elapsedMs <= 0) {
      if (this.candidate) return this.updateCandidate(normalized, previous)
      if (this.deviceHeadingDistance(previous, normalized) <= this.matchTolerance(previous, normalized)) return { kind: 'ignored' }
      return this.startCandidate(normalized, previous)
    }
    if (this.candidate) return this.updateCandidate(normalized, previous)
    const delta = this.deviceHeadingDistance(previous, normalized)
    const motionExplainsChange = elapsedMs <= MAX_MOTION_CORROBORATION_INTERVAL_MS
      && this.motionExplains(normalized, delta)
    if (elapsedMs > MAX_SAMPLE_GAP_MS) {
      if (delta <= this.matchTolerance(previous, normalized)) {
        this.accepted = normalized
        return { kind: 'accepted', headingDegrees: normalized.headingDegrees, recoveredFromSuspect: false, confidence: 'supported' }
      }
      return this.startCandidate(normalized, previous)
    }

    const maxPlausibleChange = MAX_UNCORROBORATED_TURN_RATE_DPS * elapsedMs / 1000
    if (delta <= maxPlausibleChange || motionExplainsChange) {
      this.accepted = normalized
      return { kind: 'accepted', headingDegrees: normalized.headingDegrees, recoveredFromSuspect: false, confidence: 'supported' }
    }
    return this.startCandidate(normalized, previous)
  }

  private startCandidate(sample: HeadingEvidenceSample, baseline: HeadingEvidenceSample): HeadingEvidenceDecision {
    const baselineDeviceHeading = this.deviceHeading(baseline)
    const candidateDeviceHeading = this.deviceHeading(sample)
    this.candidate = {
      sample,
      deviceHeading: candidateDeviceHeading,
      startedAtMs: sample.timeMs,
      stableSinceMs: sample.timeMs,
      direction: Math.sign(shortestAngleDelta(baselineDeviceHeading, candidateDeviceHeading)),
      coherentTravelDegrees: 0,
      baselineAccuracyDegrees: baseline.reportedAccuracyDegrees,
      initialCandidateAccuracyDegrees: sample.reportedAccuracyDegrees,
      lastSeenAtMs: sample.timeMs,
    }
    return this.quarantineDecision(sample)
  }

  private updateCandidate(sample: HeadingEvidenceSample, baseline: HeadingEvidenceSample): HeadingEvidenceDecision {
    const candidate = this.candidate
    if (!candidate || sample.timeMs <= candidate.lastSeenAtMs) return { kind: 'ignored' }

    const nextDeviceHeading = this.deviceHeading(sample)
    const candidateStep = shortestAngleDelta(candidate.deviceHeading, nextDeviceHeading)
    const elapsedMs = sample.timeMs - candidate.lastSeenAtMs
    const sampleAccuracy = sample.reportedAccuracyDegrees
    const accuracyWorsened = sampleAccuracy !== null && candidate.baselineAccuracyDegrees !== null
      && sampleAccuracy > candidate.baselineAccuracyDegrees + MAX_ACCURACY_WORSENING_DEGREES
    const motionCorroboratesCandidate = elapsedMs <= MAX_MOTION_CORROBORATION_INTERVAL_MS
      && this.motionExplains(sample, candidateStep)
    const qualitySupportsRecovery = (this.hasReliableAccuracy(sample) && !accuracyWorsened)
      || motionCorroboratesCandidate
    const matchToAccepted = shortestAngleDelta(this.deviceHeading(baseline), nextDeviceHeading)

    if (Math.abs(matchToAccepted) <= this.matchTolerance(baseline, sample)
      && (sampleAccuracy === null || sampleAccuracy <= MAX_RECOVERY_ACCURACY_DEGREES)) {
      this.accepted = sample
      this.candidate = null
      return { kind: 'accepted', headingDegrees: sample.headingDegrees, recoveredFromSuspect: true, confidence: 'supported' }
    }

    if (sampleAccuracy !== null && sampleAccuracy > MAX_LIVE_ACCURACY_DEGREES) {
      candidate.sample = sample
      candidate.deviceHeading = nextDeviceHeading
      candidate.stableSinceMs = sample.timeMs
      candidate.lastSeenAtMs = sample.timeMs
      return this.quarantineDecision(sample)
    }

    const stationary = Math.abs(candidateStep) <= this.stationaryTolerance(candidate.sample, sample)
    const motionContradictsStationary = stationary && sample.motionHeadingDeltaDegrees !== null
      && sample.motionEvidenceCoverage >= 0.75
      && Math.abs(sample.motionHeadingDeltaDegrees) > this.stationaryTolerance(candidate.sample, sample) * 1.5 + 4
    if (stationary) {
      if (motionContradictsStationary) candidate.stableSinceMs = sample.timeMs
      if (this.hasReliableAccuracy(sample) && !this.hasReliableAccuracy(candidate.sample)) candidate.stableSinceMs = sample.timeMs
      if (elapsedMs > MAX_SAMPLE_GAP_MS) candidate.stableSinceMs = sample.timeMs
    } else {
      const progressesInSameDirection = Math.sign(candidateStep) === candidate.direction
        && Math.abs(candidateStep) >= MIN_CANDIDATE_PROGRESS_DEGREES
        && Math.abs(candidateStep) <= MAX_UNCORROBORATED_TURN_RATE_DPS * elapsedMs / 1000
      if (progressesInSameDirection && qualitySupportsRecovery) {
        candidate.coherentTravelDegrees += Math.abs(candidateStep)
        if (sample.timeMs - candidate.startedAtMs >= MIN_COHERENT_TURN_MS
          && candidate.coherentTravelDegrees >= MIN_COHERENT_TURN_DEGREES) {
          this.accepted = sample
          this.candidate = null
          return { kind: 'accepted', headingDegrees: sample.headingDegrees, recoveredFromSuspect: true, confidence: 'supported' }
        }
      } else {
        candidate.direction = Math.sign(candidateStep)
        candidate.coherentTravelDegrees = 0
      }
      candidate.stableSinceMs = sample.timeMs
    }

    candidate.sample = sample
    candidate.deviceHeading = nextDeviceHeading
    candidate.lastSeenAtMs = sample.timeMs
    const stableForMs = sample.timeMs - candidate.stableSinceMs
    const supportedStationaryRecovery = qualitySupportsRecovery && stableForMs >= MIN_STATIONARY_RECOVERY_MS
    const limitedStationaryRecovery = sample.reportedAccuracyDegrees === null
      && candidate.initialCandidateAccuracyDegrees === null
      && stableForMs >= MIN_UNVERIFIED_STATIONARY_RECOVERY_MS
      && !motionContradictsStationary
    if (!motionContradictsStationary && elapsedMs <= MAX_SAMPLE_GAP_MS
      && (supportedStationaryRecovery || limitedStationaryRecovery)) {
      this.accepted = sample
      this.candidate = null
      return { kind: 'accepted', headingDegrees: sample.headingDegrees, recoveredFromSuspect: true,
        confidence: limitedStationaryRecovery ? 'limited' : 'supported' }
    }
    return this.quarantineDecision(sample)
  }

  private quarantineDecision(sample: HeadingEvidenceSample): HeadingEvidenceDecision {
    if (this.candidate && sample.timeMs - this.candidate.startedAtMs >= MAX_QUARANTINE_MS) {
      return { kind: 'degraded', candidateHeadingDegrees: sample.headingDegrees }
    }
    return { kind: 'suspect', candidateHeadingDegrees: sample.headingDegrees }
  }

  private isKnownFrameOrSourceContinuation(previous: HeadingEvidenceSample, current: HeadingEvidenceSample): boolean {
    return this.deviceHeadingDistance(previous, current) <= this.matchTolerance(previous, current)
      && (current.reportedAccuracyDegrees === null || current.reportedAccuracyDegrees <= MAX_RECOVERY_ACCURACY_DEGREES)
  }

  private deviceHeading(sample: HeadingEvidenceSample): number {
    return wrap360(sample.headingDegrees - sample.screenAngle)
  }

  private deviceHeadingDistance(first: HeadingEvidenceSample, second: HeadingEvidenceSample): number {
    return Math.abs(shortestAngleDelta(this.deviceHeading(first), this.deviceHeading(second)))
  }

  private matchTolerance(first: HeadingEvidenceSample, second: HeadingEvidenceSample): number {
    const firstAccuracy = first.reportedAccuracyDegrees
    const secondAccuracy = second.reportedAccuracyDegrees
    if (firstAccuracy === null || secondAccuracy === null) return MAX_STATIONARY_STEP_DEGREES
    return Math.min(ACCURACY_MATCH_CAP_DEGREES,
      Math.max(MAX_STATIONARY_STEP_DEGREES, firstAccuracy + secondAccuracy))
  }

  private stationaryTolerance(first: HeadingEvidenceSample, second: HeadingEvidenceSample): number {
    return this.matchTolerance(first, second)
  }

  private hasReliableAccuracy(sample: HeadingEvidenceSample): boolean {
    const accuracy = sample.reportedAccuracyDegrees
    if (accuracy === null || accuracy > MAX_RECOVERY_ACCURACY_DEGREES) return false
    const baselineAccuracy = this.candidate?.baselineAccuracyDegrees
    return baselineAccuracy === null || baselineAccuracy === undefined
      || accuracy <= baselineAccuracy + MAX_ACCURACY_WORSENING_DEGREES
  }

  private motionExplains(sample: HeadingEvidenceSample, headingDeltaDegrees: number): boolean {
    const observed = sample.motionHeadingDeltaDegrees
    if (observed === null || sample.motionEvidenceCoverage < 0.75) return false
    const observedMagnitude = Math.abs(observed)
    const headingMagnitude = Math.abs(headingDeltaDegrees)
    return Math.sign(observed) === Math.sign(headingDeltaDegrees)
      && observedMagnitude >= headingMagnitude * MOTION_CORROBORATION_RATIO
      && observedMagnitude <= headingMagnitude * 1.6 + 6
  }
}
