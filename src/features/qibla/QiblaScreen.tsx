import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { Place } from '../../domain/place'
import { calculateQiblaBearing, estimateBearingOriginUncertainty, roundAzimuthForDisplay, shortestAngleDelta, wrap360, wrapSigned } from '../../domain/qibla'
import type { BearingOriginUncertainty, QiblaBearing } from '../../domain/qibla'
import { qiblaRelativeAngle, toTrueHeading } from '../../domain/magneticHeading'
import { calculateWmm2025 } from '../../domain/wmm2025'
import type { WmmResult } from '../../domain/wmm2025'
import { QiblaHeadingEvidenceGate } from '../../domain/qiblaHeadingEvidence'
import { classifyQiblaAccuracy, type QiblaAccuracyCategory } from '../../domain/qiblaAccuracy'
import { createOrientationSession, hasRememberedOrientationGrant, type OrientationReading, type OrientationStatus } from '../../platform/qiblaOrientation'
import { createQiblaDiagnosticTrace, qiblaDiagnosticsRequested, type QiblaDiagnosticTrace } from '../../platform/qiblaDiagnostics'
import { useLocalization } from '../../localization'
import { ActionButton } from '../../ui/controls'
import { BackButton, Screen } from '../../ui/Screen'
import { formatRelativeGuidance } from './relativeGuidance'

type CompassState = { status: OrientationStatus; reason: 'blackout' | 'caution' | 'model-unavailable' | 'reacquired' | null }

const INITIAL_COMPASS_STATE: CompassState = { status: 'idle', reason: null }
const ACCESSIBLE_ANNOUNCEMENT_INTERVAL_MS = 2500

function decimalYearUtc(timestamp: number): number {
  const now = new Date(timestamp)
  const year = now.getUTCFullYear()
  const start = Date.UTC(year, 0, 1)
  return year + (timestamp - start) / (Date.UTC(year + 1, 0, 1) - start)
}

function useModelTimestamp() {
  const [timestamp, setTimestamp] = useState(() => Date.now())

  useEffect(() => {
    let timer = 0
    const scheduleMidnightRefresh = () => {
      window.clearTimeout(timer)
      const now = Date.now()
      const date = new Date(now)
      const nextMidnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)
      timer = window.setTimeout(refresh, Math.max(1, nextMidnight - now + 10))
    }
    const refresh = () => {
      setTimestamp(Date.now())
      scheduleMidnightRefresh()
    }
    window.addEventListener('pageshow', refresh)
    document.addEventListener('visibilitychange', refresh)
    scheduleMidnightRefresh()
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pageshow', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  return timestamp
}

function deriveRelativePointer(
  reading: OrientationReading,
  model: WmmResult,
  bearing: QiblaBearing,
  originUncertainty: BearingOriginUncertainty,
): { kind: 'direction'; relativeDegrees: number; northRotationDegrees: number } | { kind: 'unavailable'; reason: 'model-unavailable' | 'blackout' | 'bearing' | 'uncertainty' | 'tilt' | 'heading' } {
  if (model.kind !== 'calculated') return { kind: 'unavailable', reason: 'model-unavailable' }
  if (model.horizontalIntensityNt < 2000) return { kind: 'unavailable', reason: 'blackout' }
  if (bearing.kind !== 'bearing') return { kind: 'unavailable', reason: 'bearing' }
  if (originUncertainty.kind === 'unbounded') return { kind: 'unavailable', reason: 'uncertainty' }
  if (!Number.isFinite(reading.horizontalProjection) || reading.horizontalProjection < 0.35) return { kind: 'unavailable', reason: 'tilt' }
  const trueHeading = toTrueHeading(reading.headingMagneticDegrees, reading.northReference, model.declinationEastDegrees)
  if (trueHeading.kind !== 'true-heading') return { kind: 'unavailable', reason: 'heading' }
  const relativeDegrees = qiblaRelativeAngle(bearing.azimuth, trueHeading.degrees)
  return relativeDegrees === null ? { kind: 'unavailable', reason: 'heading' }
    : { kind: 'direction', relativeDegrees, northRotationDegrees: -trueHeading.degrees }
}

function orientationIssue(status: OrientationStatus, reason: CompassState['reason'], t: ReturnType<typeof useLocalization>['t']): string | null {
  if (reason === 'blackout') return t('qiblaMagneticBlackout')
  if (reason === 'caution') return t('qiblaMagneticCaution')
  if (reason === 'reacquired') return t('qiblaOrientationReacquired')
  if (reason === 'model-unavailable') return t('qiblaMagneticModelUnavailable')
  switch (status) {
    case 'acquiring': return t('qiblaCompassConnecting')
    case 'calibrating': return t('qiblaOrientationCalibrating')
    case 'tilt': return t('qiblaOrientationTilt')
    case 'tilt-unknown': return t('qiblaOrientationTiltUnknown')
    case 'suspect': return t('qiblaOrientationSuspect')
    case 'degraded': return t('qiblaOrientationDegraded')
    case 'denied': return t('qiblaOrientationDenied')
    case 'restricted': return t('qiblaOrientationRestricted')
    case 'unsupported': return t('qiblaOrientationUnsupported')
    case 'security': return t('qiblaOrientationSecurity')
    case 'frame-unavailable': return t('qiblaOrientationFrameUnavailable')
    case 'null-reading': return t('qiblaOrientationNullReading')
    case 'timeout': return t('qiblaOrientationTimeout')
    default: return null
  }
}

function shouldOfferRetry(status: OrientationStatus): boolean {
  return ['calibrating', 'tilt', 'tilt-unknown', 'suspect', 'degraded', 'denied', 'restricted',
    'frame-unavailable', 'null-reading', 'timeout'].includes(status)
}

function accuracyCategoryText(category: QiblaAccuracyCategory, t: ReturnType<typeof useLocalization>['t']): string {
  switch (category) {
    case 'excellent': return t('qiblaAccuracyExcellent')
    case 'good': return t('qiblaAccuracyGood')
    case 'medium': return t('qiblaAccuracyMedium')
    case 'low': return t('qiblaAccuracyLow')
    case 'very-low': return t('qiblaAccuracyVeryLow')
    case 'unavailable': return t('qiblaAccuracyUnavailable')
    case 'unknown': return t('qiblaAccuracyUnknown')
  }
}

export function QiblaScreen({ place, onBack }: { place: Place | null; onBack: () => void }) {
  const { t } = useLocalization()
  const tRef = useRef(t)
  const modelTimestamp = useModelTimestamp()
  const [compass, setCompass] = useState<CompassState>(() => hasRememberedOrientationGrant(window)
    ? { status: 'acquiring', reason: null } : INITIAL_COMPASS_STATE)
  const [pointerVisible, setPointerVisible] = useState(false)
  const [accessibleRelative, setAccessibleRelative] = useState('')
  const [accuracyCategory, setAccuracyCategory] = useState<QiblaAccuracyCategory>('unknown')
  const [announcedAccuracyCategory, setAnnouncedAccuracyCategory] = useState<QiblaAccuracyCategory | null>(null)
  const compassStateRef = useRef(compass)
  const pointerVisibleRef = useRef(false)
  const accessibleRelativeRef = useRef('')
  const accuracyCategoryRef = useRef<QiblaAccuracyCategory>('unknown')
  const lastAccuracyAnnouncementAt = useRef(Number.NEGATIVE_INFINITY)
  const pendingAccuracyCategory = useRef<QiblaAccuracyCategory | null>(null)
  const accuracyAnnouncementTimer = useRef<number | null>(null)
  const session = useRef<ReturnType<typeof createOrientationSession> | null>(null)
  const traceRef = useRef<QiblaDiagnosticTrace | null>(null)
  const pointerRef = useRef<HTMLSpanElement>(null)
  const roseRef = useRef<HTMLDivElement>(null)
  const frameRequest = useRef<number | null>(null)
  const pendingPointerAngle = useRef(0)
  const pendingNorthRotation = useRef(0)
  const pointerAngle = useRef<number | null>(null)
  const unwrappedPointerAngle = useRef(0)
  const evidenceTimer = useRef<number | null>(null)
  const suspectReading = useRef<OrientationReading | null>(null)
  const latestReading = useRef<OrientationReading | null>(null)
  const lastSource = useRef<string | null>(null)
  const limitedReacquisition = useRef(false)
  const continuity = useRef(new QiblaHeadingEvidenceGate())
  const lastAnnouncedBucket = useRef<number | null>(null)
  const lastAnnouncementAt = useRef(Number.NEGATIVE_INFINITY)
  const pendingAnnouncement = useRef<string | null>(null)
  const pendingAnnouncementBucket = useRef<number | null>(null)
  const announcementTimer = useRef<number | null>(null)
  const processReadingRef = useRef<(reading: OrientationReading) => void>(() => {})
  const previousPlace = useRef(place)

  useLayoutEffect(() => { tRef.current = t }, [t])

  const model = useMemo(() => place
    ? calculateWmm2025({ year: decimalYearUtc(modelTimestamp), latitude: place.latitude, longitude: place.longitude, altitudeKm: 0 })
    : { kind: 'invalid-input' as const }, [modelTimestamp, place])
  const timestampValid = place !== null && Number.isFinite(place.timestamp) && Number.isFinite(new Date(place.timestamp).getTime())
  const bearing = useMemo(() => place && timestampValid
    ? calculateQiblaBearing(place)
    : { kind: 'undefined' as const, reason: 'invalid-position' as const }, [place, timestampValid])
  const originUncertainty = useMemo(() => place && timestampValid
    ? estimateBearingOriginUncertainty(place)
    : { kind: 'unknown' as const }, [place, timestampValid])

  const modelRef = useRef(model)
  const bearingRef = useRef<QiblaBearing>(bearing)
  const uncertaintyRef = useRef<BearingOriginUncertainty>(originUncertainty)

  const queuePointer = (relativeDegrees: number, northRotationDegrees: number) => {
    const next = wrapSigned(relativeDegrees)
    const previous = pointerAngle.current
    unwrappedPointerAngle.current = previous === null
      ? next
      : unwrappedPointerAngle.current + shortestAngleDelta(previous, next)
    pointerAngle.current = next
    pendingPointerAngle.current = unwrappedPointerAngle.current
    pendingNorthRotation.current = northRotationDegrees
    if (frameRequest.current !== null) return
    const handle = window.requestAnimationFrame(() => {
      if (frameRequest.current === handle) frameRequest.current = null
      if (pointerRef.current) pointerRef.current.style.setProperty('--qibla-angle', `${pendingPointerAngle.current}deg`)
      if (roseRef.current) roseRef.current.style.setProperty('--qibla-rose-angle', `${pendingNorthRotation.current}deg`)
    })
    frameRequest.current = handle
  }

  const publishPointerVisibility = useCallback((visible: boolean) => {
    if (pointerVisibleRef.current === visible) return
    pointerVisibleRef.current = visible
    setPointerVisible(visible)
  }, [])

  const clearPointer = useCallback(() => {
    if (frameRequest.current !== null) window.cancelAnimationFrame(frameRequest.current)
    frameRequest.current = null
    pointerAngle.current = null
    unwrappedPointerAngle.current = 0
    publishPointerVisibility(false)
  }, [publishPointerVisibility])

  const clearAccessibleDirection = useCallback(() => {
    pendingAnnouncement.current = null
    pendingAnnouncementBucket.current = null
    lastAnnouncedBucket.current = null
    if (announcementTimer.current !== null) window.clearTimeout(announcementTimer.current)
    announcementTimer.current = null
    if (accessibleRelativeRef.current) {
      accessibleRelativeRef.current = ''
      setAccessibleRelative('')
    }
  }, [])

  const scheduleAccessibleDirection = (relativeDegrees: number) => {
    const bucket = Math.round(wrapSigned(relativeDegrees) / 15) * 15
    if (bucket === lastAnnouncedBucket.current && pendingAnnouncementBucket.current === null) return
    pendingAnnouncement.current = formatRelativeGuidance(bucket, tRef.current)
    pendingAnnouncementBucket.current = bucket
    const remaining = ACCESSIBLE_ANNOUNCEMENT_INTERVAL_MS - (performance.now() - lastAnnouncementAt.current)
    const publish = () => {
      announcementTimer.current = null
      const next = pendingAnnouncement.current
      const nextBucket = pendingAnnouncementBucket.current
      pendingAnnouncement.current = null
      pendingAnnouncementBucket.current = null
      if (!next || nextBucket === null) return
      lastAnnouncementAt.current = performance.now()
      lastAnnouncedBucket.current = nextBucket
      if (accessibleRelativeRef.current !== next) {
        accessibleRelativeRef.current = next
        setAccessibleRelative(next)
      }
    }
    if (remaining <= 0) publish()
    else if (announcementTimer.current === null) announcementTimer.current = window.setTimeout(publish, remaining)
  }

  const publishCompassState = useCallback((next: CompassState) => {
    const previous = compassStateRef.current
    if (previous.status === next.status && previous.reason === next.reason) return
    compassStateRef.current = next
    setCompass(next)
  }, [])

  const publishAccuracyCategory = useCallback((next: QiblaAccuracyCategory) => {
    if (accuracyCategoryRef.current === next) return
    accuracyCategoryRef.current = next
    setAccuracyCategory(next)
    pendingAccuracyCategory.current = next
    const publish = () => {
      accuracyAnnouncementTimer.current = null
      const pending = pendingAccuracyCategory.current
      pendingAccuracyCategory.current = null
      if (pending === null) return
      lastAccuracyAnnouncementAt.current = performance.now()
      setAnnouncedAccuracyCategory(pending)
    }
    const remaining = ACCESSIBLE_ANNOUNCEMENT_INTERVAL_MS - (performance.now() - lastAccuracyAnnouncementAt.current)
    if (remaining <= 0) publish()
    else if (accuracyAnnouncementTimer.current === null) {
      accuracyAnnouncementTimer.current = window.setTimeout(publish, remaining)
    }
  }, [])

  const processReading = (reading: OrientationReading) => {
    const derived = deriveRelativePointer(reading, modelRef.current, bearingRef.current, uncertaintyRef.current)
    if (derived.kind !== 'direction') {
      latestReading.current = null
      clearPointer()
      clearAccessibleDirection()
      const status: OrientationStatus = derived.reason === 'tilt' ? 'tilt' : 'degraded'
      const reason: CompassState['reason'] = derived.reason === 'blackout' ? 'blackout'
        : derived.reason === 'model-unavailable' ? 'model-unavailable'
          : modelRef.current.kind === 'calculated' && modelRef.current.horizontalIntensityNt < 6000 ? 'caution' : null
      traceRef.current?.record({ event: 'status', status, source: reading.source, modelValid: modelRef.current.kind === 'calculated' })
      publishCompassState({ status, reason })
      return
    }
    queuePointer(derived.relativeDegrees, derived.northRotationDegrees)
    publishPointerVisibility(true)
    scheduleAccessibleDirection(derived.relativeDegrees)
    const reason = modelRef.current.kind === 'calculated' && modelRef.current.horizontalIntensityNt < 6000 ? 'caution'
      : limitedReacquisition.current ? 'reacquired' : null
    publishCompassState({ status: 'live-unverified', reason })
    traceRef.current?.record({
      event: 'reading', source: reading.source, magneticHeadingDegrees: reading.headingMagneticDegrees,
      acceptedHeadingDegrees: wrap360(reading.headingMagneticDegrees + (modelRef.current.kind === 'calculated' ? modelRef.current.declinationEastDegrees : 0)),
      displayedRelativeDegrees: derived.relativeDegrees, screenAngleDegrees: reading.screenAngle,
      reportedAccuracyDegrees: reading.accuracyDegrees, horizontalProjection: reading.horizontalProjection,
      declinationEastDegrees: modelRef.current.kind === 'calculated' ? modelRef.current.declinationEastDegrees : null,
      modelValid: modelRef.current.kind === 'calculated',
    })
  }

  useLayoutEffect(() => {
    const placeChanged = previousPlace.current !== place
    modelRef.current = model
    bearingRef.current = bearing
    uncertaintyRef.current = originUncertainty
    if (placeChanged) traceRef.current?.record({ event: 'place-change' })
    traceRef.current?.record({ event: 'model-change', modelValid: model.kind === 'calculated',
      declinationEastDegrees: model.kind === 'calculated' ? model.declinationEastDegrees : null })
    previousPlace.current = place
  }, [bearing, model, originUncertainty, place])

  useLayoutEffect(() => { processReadingRef.current = processReading })

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (latestReading.current) processReadingRef.current(latestReading.current)
      else if (bearingRef.current.kind !== 'bearing' || uncertaintyRef.current.kind === 'unbounded') {
        clearPointer()
        clearAccessibleDirection()
      }
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [bearing, clearAccessibleDirection, clearPointer, model, originUncertainty, place])

  useEffect(() => {
    const trace = createQiblaDiagnosticTrace(window, qiblaDiagnosticsRequested(window))
    traceRef.current = trace
    let active = true
    const cancelEvidenceTimer = () => {
      if (evidenceTimer.current !== null) window.clearTimeout(evidenceTimer.current)
      evidenceTimer.current = null
    }
    const settleSuspectReading = () => {
      evidenceTimer.current = null
      if (!active) return
      const decision = continuity.current.settle(performance.now())
      if (decision.kind === 'accepted' && suspectReading.current) {
        const recoveredReading = suspectReading.current
        suspectReading.current = null
        latestReading.current = recoveredReading
        publishAccuracyCategory(classifyQiblaAccuracy(recoveredReading.accuracyDegrees))
        trace.record({ event: 'status', status: 'live-unverified', source: recoveredReading.source,
          reportedAccuracyDegrees: recoveredReading.accuracyDegrees, screenAngleDegrees: recoveredReading.screenAngle,
          modelValid: modelRef.current.kind === 'calculated' })
        processReadingRef.current(recoveredReading)
      } else if (decision.kind === 'degraded') {
        suspectReading.current = null
        latestReading.current = null
        publishAccuracyCategory('unknown')
        clearPointer()
        clearAccessibleDirection()
        trace.record({ event: 'status', status: 'degraded',
          modelValid: modelRef.current.kind === 'calculated' })
        publishCompassState({ status: 'degraded', reason: null })
      } else if (decision.kind === 'suspect') scheduleEvidenceSettlement()
    }
    const scheduleEvidenceSettlement = () => {
      cancelEvidenceTimer()
      evidenceTimer.current = window.setTimeout(settleSuspectReading, 600)
    }
    const setIssue = (status: OrientationStatus) => {
      if (!active) return
      publishAccuracyCategory('unknown')
      cancelEvidenceTimer()
      suspectReading.current = null
      if (status !== 'suspect') {
        continuity.current.reset()
        latestReading.current = null
        lastSource.current = null
        limitedReacquisition.current = false
      } else latestReading.current = null
      clearPointer()
      clearAccessibleDirection()
      trace.record({ event: 'status', status })
      publishCompassState({ status, reason: null })
    }
    const orientationSession = createOrientationSession(window, (status, reading) => {
      if (!active) return
      if (!reading) {
        setIssue(status)
        return
      }
      if (reading.horizontalProjection < 0.35) {
        setIssue('tilt')
        return
      }
      const decision = continuity.current.push({
        headingDegrees: reading.headingMagneticDegrees, timeMs: reading.sampleTimeMs,
        source: reading.source, screenAngle: reading.screenAngle,
        motionHeadingDeltaDegrees: reading.motionHeadingDeltaDegrees,
        motionEvidenceCoverage: reading.motionEvidenceCoverage,
        reportedAccuracyDegrees: reading.accuracyDegrees,
      })
      if (decision.kind === 'invalid') {
        setIssue('degraded')
        return
      }
      if (decision.kind === 'ignored') return
      if (decision.kind === 'degraded') {
        cancelEvidenceTimer()
        suspectReading.current = null
        latestReading.current = null
        clearPointer()
        clearAccessibleDirection()
        const reportedAccuracy = classifyQiblaAccuracy(reading.accuracyDegrees)
        publishAccuracyCategory(reportedAccuracy === 'unavailable' ? 'unavailable' : 'unknown')
        trace.record({ event: 'status', status: 'degraded', source: reading.source,
          reportedAccuracyDegrees: reading.accuracyDegrees, modelValid: modelRef.current.kind === 'calculated' })
        publishCompassState({ status: 'degraded', reason: null })
        return
      }
      if (decision.kind === 'suspect') {
        limitedReacquisition.current = false
        suspectReading.current = reading
        scheduleEvidenceSettlement()
        latestReading.current = null
        publishAccuracyCategory('unknown')
        clearPointer()
        clearAccessibleDirection()
        trace.record({ event: 'status', status: 'suspect', source: reading.source,
          magneticHeadingDegrees: reading.headingMagneticDegrees, screenAngleDegrees: reading.screenAngle,
          reportedAccuracyDegrees: reading.accuracyDegrees, horizontalProjection: reading.horizontalProjection,
          modelValid: modelRef.current.kind === 'calculated' })
        publishCompassState({ status: 'suspect', reason: null })
        return
      }
      cancelEvidenceTimer()
      suspectReading.current = null
      latestReading.current = reading
      publishAccuracyCategory(classifyQiblaAccuracy(reading.accuracyDegrees))
      if (lastSource.current && lastSource.current !== reading.source) trace.record({ event: 'source-change', source: reading.source })
      lastSource.current = reading.source
      if (decision.confidence === 'limited') limitedReacquisition.current = true
      else if ((reading.accuracyDegrees !== null && reading.accuracyDegrees <= 15)
        || (reading.motionEvidenceCoverage >= 0.75 && reading.motionHeadingDeltaDegrees !== null)) {
        limitedReacquisition.current = false
      }
      processReadingRef.current(reading)
    }, event => trace.record({ event: 'adapter', ...event }))
    session.current = orientationSession
    trace.record({ event: 'status', status: 'idle' })
    trace.record({ event: 'session-start' })
    orientationSession.resumeFromRememberedGrant()

    return () => {
      active = false
      orientationSession.stop()
      if (session.current === orientationSession) session.current = null
      if (frameRequest.current !== null) window.cancelAnimationFrame(frameRequest.current)
      frameRequest.current = null
      if (announcementTimer.current !== null) window.clearTimeout(announcementTimer.current)
      announcementTimer.current = null
      if (accuracyAnnouncementTimer.current !== null) window.clearTimeout(accuracyAnnouncementTimer.current)
      accuracyAnnouncementTimer.current = null
      pendingAccuracyCategory.current = null
      cancelEvidenceTimer()
      suspectReading.current = null
      trace.close()
      if (traceRef.current === trace) traceRef.current = null
    }
  }, [clearAccessibleDirection, clearPointer, publishAccuracyCategory, publishCompassState])

  const issue = orientationIssue(compass.status, compass.reason, t)
  const placeIssue = bearing.kind === 'undefined'
    ? bearing.reason === 'invalid-position' ? t('qiblaPlaceRequiredBrief') : t('qiblaDirectionUndefined')
    : originUncertainty.kind === 'unbounded' ? t('qiblaPlaceUncertainBrief') : null
  const visibleIssue = placeIssue ?? issue
  const bearingLabel = bearing.kind === 'bearing' ? roundAzimuthForDisplay(bearing.azimuth) : null
  const staticState = !pointerVisible
  const showInitialAction = compass.status === 'idle' && bearing.kind === 'bearing' && originUncertainty.kind !== 'unbounded'
  const showRetry = shouldOfferRetry(compass.status)
  const accuracyText = accuracyCategoryText(accuracyCategory, t)
  const actionLabel = showInitialAction ? t('qiblaEnableCompass')
    : compass.status === 'calibrating' || compass.status === 'suspect' || compass.status === 'tilt' || compass.status === 'tilt-unknown'
      ? t('qiblaCheckCompass') : t('retryAgain')
  const dialLabel = bearing.kind === 'bearing'
    ? t('qiblaDialDescription', { azimuth: bearingLabel ?? 0 })
    : t('qiblaDirectionUndefined')

  return <Screen label={t('qiblaTitle')} top={<BackButton onClick={onBack} />}
    bottom={<div className="qibla-footer">
      {visibleIssue || showInitialAction || showRetry ? <div className="qibla-recovery">
        {visibleIssue ? <p role="status">{visibleIssue}</p> : null}
        {showInitialAction || showRetry ? <ActionButton disabled={compass.status === 'acquiring'} onClick={() => {
          traceRef.current?.record({ event: 'retry', status: compass.status })
          continuity.current.reset()
          limitedReacquisition.current = false
          suspectReading.current = null
          publishAccuracyCategory('unknown')
          if (evidenceTimer.current !== null) window.clearTimeout(evidenceTimer.current)
          evidenceTimer.current = null
          void session.current?.enableFromGesture()
        }}>{compass.status === 'acquiring' ? t('qiblaCompassConnecting') : actionLabel}</ActionButton> : null}
      </div> : null}
      <span className="qibla-accuracy" role="note" aria-label={t('qiblaAccuracyStatus', { category: accuracyText })}>{t('qiblaAccuracyPrefix')}{accuracyText}</span>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {announcedAccuracyCategory === null ? '' : t('qiblaAccuracyStatus', {
          category: accuracyCategoryText(announcedAccuracyCategory, t),
        })}
      </span>
    </div>}
    contentClassName="qibla-screen-content">
    <div className="qibla-screen">
      <div className="qibla-dial" data-live={pointerVisible || undefined} role="img" aria-label={dialLabel}>
        <div ref={roseRef} className="qibla-rose" aria-hidden="true">
          <span className="qibla-cardinal qibla-cardinal-north">{t('qiblaNorth')}</span>
          <span className="qibla-cardinal qibla-cardinal-east">{t('qiblaEast')}</span>
          <span className="qibla-cardinal qibla-cardinal-south">{t('qiblaSouth')}</span>
          <span className="qibla-cardinal qibla-cardinal-west">{t('qiblaWest')}</span>
        </div>
        <span ref={pointerRef} className="qibla-pointer" data-visible={pointerVisible || undefined} aria-hidden="true" />
        <span className="qibla-center" aria-hidden="true" />
      </div>
      {staticState && bearingLabel !== null ? <span className="qibla-static-bearing" aria-hidden="true">{bearingLabel}°</span> : null}
      <span className="sr-only" aria-live="polite" aria-atomic="true">{accessibleRelative}</span>
      {compass.status === 'live-unverified' ? <span className="sr-only">{t('qiblaOrientationLiveUnverified')}</span> : null}
    </div>
  </Screen>
}
