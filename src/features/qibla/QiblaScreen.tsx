import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

import type { Place } from '../../domain/place'
import { calculateQiblaBearing, estimateBearingOriginUncertainty, formatAngularUncertainty, roundAzimuthForDisplay, wrap360 } from '../../domain/qibla'
import { qiblaRelativeAngle, toTrueHeading } from '../../domain/magneticHeading'
import { calculateWmm2025 } from '../../domain/wmm2025'
import { circularExponentialStep, createOrientationSession, type OrientationStatus } from '../../platform/qiblaOrientation'
import { useLocalization } from '../../localization'
import { ActionButton } from '../../ui/controls'
import { BackButton, Screen } from '../../ui/Screen'
import { formatRelativeGuidance } from './relativeGuidance'

type OrientationView = {
  status: OrientationStatus
  accuracy: number | null
  reason: 'blackout' | 'caution' | 'model-unavailable' | null
}

const INITIAL_ORIENTATION: OrientationView = { status: 'idle', accuracy: null, reason: null }
const ANNOUNCEMENT_INTERVAL_MS = 2500

export function QiblaScreen({ place, onBack, onOpenLocation }: { place: Place | null; onBack: () => void; onOpenLocation: () => void }) {
  const { t, locale } = useLocalization()
  const [orientation, setOrientation] = useState<OrientationView>(INITIAL_ORIENTATION)
  const [relativeAnnouncement, setRelativeAnnouncement] = useState('')
  const session = useRef<ReturnType<typeof createOrientationSession> | null>(null)
  const dialRef = useRef<HTMLDivElement>(null)
  const frameRequest = useRef<number | null>(null)
  const pendingRotation = useRef(0)
  const filteredHeading = useRef<number | null>(null)
  const lastFilterTime = useRef(0)
  const lastSensorFrame = useRef<{ source: string; screenAngle: number } | null>(null)
  const lastAnnouncementAt = useRef(Number.NEGATIVE_INFINITY)
  const pendingAnnouncement = useRef<string | null>(null)
  const announcementTimer = useRef<number | null>(null)

  const wmm = useMemo(() => {
    if (!place) return { kind: 'invalid-input' as const }
    const now = new Date()
    const year = now.getUTCFullYear()
    const start = Date.UTC(year, 0, 1)
    const end = Date.UTC(year + 1, 0, 1)
    return calculateWmm2025({ year: year + (now.getTime() - start) / (end - start),
      latitude: place.latitude, longitude: place.longitude, altitudeKm: 0 })
  }, [place])
  const wmmRef = useRef(wmm)

  const timestampValid = useMemo(() => place !== null && Number.isFinite(place.timestamp)
    && Number.isFinite(new Date(place.timestamp).getTime()), [place])
  const bearing = useMemo(() => place && timestampValid
    ? calculateQiblaBearing(place) : { kind: 'undefined' as const, reason: 'invalid-position' as const }, [place, timestampValid])
  const originUncertainty = useMemo(() => place && timestampValid
    ? estimateBearingOriginUncertainty(place) : { kind: 'unknown' as const }, [place, timestampValid])
  const bearingRef = useRef(bearing)
  const originUncertaintyRef = useRef(originUncertainty)

  useEffect(() => {
    wmmRef.current = wmm
    bearingRef.current = bearing
    originUncertaintyRef.current = originUncertainty
  }, [bearing, originUncertainty, wmm])

  useEffect(() => {
    let active = true
    const publishStatus = (next: OrientationView) => {
      if (!active) return
      setOrientation(previous => previous.status === next.status && previous.reason === next.reason
        && (previous.status === 'live-unverified' || previous.accuracy === next.accuracy) ? previous : next)
    }
    const queueDialRotation = (heading: number) => {
      pendingRotation.current = wrap360(-heading)
      if (frameRequest.current !== null) return
      const handle = window.requestAnimationFrame(() => {
        if (frameRequest.current === handle) frameRequest.current = null
        if (active && dialRef.current) dialRef.current.style.transform = `rotate(${pendingRotation.current}deg)`
      })
      frameRequest.current = handle
    }
    const flushAnnouncement = () => {
      announcementTimer.current = null
      if (!active) return
      const next = pendingAnnouncement.current
      pendingAnnouncement.current = null
      if (next) {
        lastAnnouncementAt.current = performance.now()
        setRelativeAnnouncement(next)
      }
    }
    const queueAnnouncement = (text: string) => {
      if (!active || !text) return
      pendingAnnouncement.current = text
      const remaining = ANNOUNCEMENT_INTERVAL_MS - (performance.now() - lastAnnouncementAt.current)
      if (remaining <= 0) {
        if (announcementTimer.current !== null) window.clearTimeout(announcementTimer.current)
        announcementTimer.current = null
        pendingAnnouncement.current = null
        lastAnnouncementAt.current = performance.now()
        setRelativeAnnouncement(text)
      } else if (announcementTimer.current === null) {
        announcementTimer.current = window.setTimeout(flushAnnouncement, remaining)
      }
    }
    const resetLivePresentation = (status: OrientationStatus, reason: OrientationView['reason'] = null) => {
      filteredHeading.current = null
      lastFilterTime.current = 0
      lastSensorFrame.current = null
      queueDialRotation(0)
      pendingAnnouncement.current = null
      if (announcementTimer.current !== null) {
        window.clearTimeout(announcementTimer.current)
        announcementTimer.current = null
      }
      setRelativeAnnouncement(previous => previous ? '' : previous)
      publishStatus({ status, accuracy: null, reason })
    }

    const currentSession = createOrientationSession(window, (status, reading) => {
      if (!active) return
      if (!reading) {
        if (status !== 'live-unverified') resetLivePresentation(status)
        return
      }
      const model = wmmRef.current
      if (model.kind !== 'calculated') {
        resetLivePresentation('degraded', 'model-unavailable')
        return
      }
      if (model.horizontalIntensityNt < 2000) {
        resetLivePresentation('degraded', 'blackout')
        return
      }
      const trueHeading = toTrueHeading(reading.headingMagneticDegrees, reading.northReference, model.declinationEastDegrees)
      if (trueHeading.kind !== 'true-heading' || bearingRef.current.kind !== 'bearing'
        || originUncertaintyRef.current.kind === 'unbounded') {
        resetLivePresentation('degraded')
        return
      }
      const now = performance.now()
      const frameChanged = lastSensorFrame.current !== null
        && (lastSensorFrame.current.source !== reading.source || lastSensorFrame.current.screenAngle !== reading.screenAngle)
      const filtered = filteredHeading.current === null || frameChanged
        ? wrap360(trueHeading.degrees)
        : circularExponentialStep(filteredHeading.current, trueHeading.degrees, now - lastFilterTime.current)
      filteredHeading.current = filtered
      lastFilterTime.current = now
      lastSensorFrame.current = { source: reading.source, screenAngle: reading.screenAngle }
      queueDialRotation(filtered)
      const relative = qiblaRelativeAngle(bearingRef.current.azimuth, filtered)
      if (relative !== null) queueAnnouncement(formatRelativeGuidance(relative, t))
      publishStatus({ status: 'live-unverified', accuracy: reading.accuracyDegrees,
        reason: model.horizontalIntensityNt < 6000 ? 'caution' : null })
    })
    session.current = currentSession

    return () => {
      active = false
      currentSession.stop()
      if (session.current === currentSession) session.current = null
      if (frameRequest.current !== null) {
        window.cancelAnimationFrame(frameRequest.current)
        frameRequest.current = null
      }
      if (announcementTimer.current !== null) {
        window.clearTimeout(announcementTimer.current)
        announcementTimer.current = null
      }
      pendingAnnouncement.current = null
    }
  }, [t])

  const source = place?.selection === 'gps' ? t('qiblaLocationGps') : t('qiblaLocationCity')
  const orientationMessage = (() => {
    switch (orientation.status) {
      case 'idle': return t('qiblaOrientationIdle')
      case 'acquiring': return t('qiblaOrientationAcquiring')
      case 'live-unverified': return t('qiblaOrientationLiveUnverified')
      case 'calibrating': return t('qiblaOrientationCalibrating')
      case 'tilt': return t('qiblaOrientationTilt')
      case 'degraded': return t('qiblaOrientationDegraded')
      case 'denied': return t('qiblaOrientationDenied')
      case 'restricted': return t('qiblaOrientationRestricted')
      case 'unsupported': return t('qiblaOrientationUnsupported')
      case 'security': return t('qiblaOrientationSecurity')
      case 'frame-unavailable': return t('qiblaOrientationFrameUnavailable')
      case 'null-reading': return t('qiblaOrientationNullReading')
      case 'timeout': return t('qiblaOrientationTimeout')
    }
  })()
  const recordedAt = place?.selection === 'gps' && Number.isFinite(place.timestamp)
    && Number.isFinite(new Date(place.timestamp).getTime())
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(place.timestamp))
    : null
  const canRetry = orientation.status === 'idle' || orientation.status === 'denied' || orientation.status === 'restricted'
    || orientation.status === 'degraded' || orientation.status === 'frame-unavailable'
    || orientation.status === 'timeout' || orientation.status === 'null-reading'

  return <Screen label={t('qiblaTitle')} top={<BackButton onClick={onBack} />} contentClassName="qibla-screen-content">
    <div className="qibla-screen">
      <h1>{t('qiblaTitle')}</h1>
      {bearing.kind === 'bearing' ? <>
        {originUncertainty.kind === 'unbounded'
          ? <p className="screen-copy" role="status">{t('qiblaOriginBearingUncertaintyUnbounded')}</p>
          : <div ref={dialRef} className="qibla-dial" role="img" aria-label={t('qiblaDialDescription', { azimuth: roundAzimuthForDisplay(bearing.azimuth) })}>
            <span className="qibla-north" aria-hidden="true">{t('qiblaNorth')}</span>
            <span className="qibla-south" aria-hidden="true">{t('qiblaSouth')}</span>
            <span className="qibla-east" aria-hidden="true">{t('qiblaEast')}</span>
            <span className="qibla-west" aria-hidden="true">{t('qiblaWest')}</span>
            <span className="qibla-pointer" style={{ '--qibla-angle': `${bearing.azimuth}deg` } as CSSProperties} aria-hidden="true" />
            <span className="qibla-center" aria-hidden="true" />
          </div>}
        <p className="qibla-bearing"><span>{roundAzimuthForDisplay(bearing.azimuth)}°</span><span>{t('qiblaTrueNorth')}</span></p>
      </> : <p className="screen-copy" role="status">{t(bearing.reason === 'invalid-position' ? 'qiblaNoValidPlace' : 'qiblaDirectionUndefined')}</p>}
      <div className="qibla-status">
        <p>{t('qiblaPlaceSource', { source })}</p>
        {place?.selection === 'gps' && place.accuracy !== null
          ? <p>{t('qiblaLocationAccuracy', { meters: Math.round(place.accuracy) })}</p>
          : place?.selection === 'city' ? <p>{t('qiblaCityAccuracyUnknown')}</p> : null}
        {recordedAt ? <p>{t('qiblaLocationRecordedAt', { value: recordedAt })}</p> : null}
        {originUncertainty.kind === 'bounded' && originUncertainty.radiusDegrees > 0 ? <p>{t('qiblaOriginBearingUncertainty', { degrees: formatAngularUncertainty(originUncertainty.radiusDegrees) })}</p>
          : originUncertainty.kind === 'unbounded' ? <p>{t('qiblaOriginBearingUncertaintyUnbounded')}</p> : null}
        <p>{t('qiblaStaticMode')}</p>
        {orientation.status === 'idle' ? <p>{t('qiblaLiveUnavailable')}</p> : <p role="status">{orientationMessage}</p>}
        <p aria-live="polite" aria-atomic="true" className="qibla-relative-guidance">{relativeAnnouncement}</p>
        {orientation.reason === 'blackout' ? <p>{t('qiblaMagneticBlackout')}</p> : null}
        {orientation.reason === 'caution' ? <p>{t('qiblaMagneticCaution')}</p> : null}
        {orientation.reason === 'model-unavailable' ? <p>{t('qiblaMagneticModelUnavailable')}</p> : null}
        <p>{t('qiblaWmmAltitudeAssumption')}</p>
        {orientation.accuracy !== null ? <p>{t('qiblaSensorAccuracy', { degrees: formatAngularUncertainty(orientation.accuracy) })}</p> : null}
        {canRetry ? <ActionButton onClick={() => { void session.current?.enableFromGesture() }}>{t('qiblaEnableCompass')}</ActionButton> : null}
        <ActionButton onClick={onOpenLocation}>{t('qiblaRefinePlace')}</ActionButton>
      </div>
    </div>
  </Screen>
}
