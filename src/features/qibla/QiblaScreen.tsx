import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

import type { Place } from '../../domain/place'
import { calculateQiblaBearing, estimateBearingOriginUncertainty, formatAngularUncertainty, roundAzimuthForDisplay, wrap360 } from '../../domain/qibla'
import { toTrueHeading } from '../../domain/magneticHeading'
import { calculateWmm2025 } from '../../domain/wmm2025'
import { circularExponentialStep, createOrientationSession, type OrientationStatus } from '../../platform/qiblaOrientation'
import { useLocalization } from '../../localization'
import { ActionButton } from '../../ui/controls'
import { BackButton, Screen } from '../../ui/Screen'

export function QiblaScreen({ place, onBack, onOpenLocation }: { place: Place | null; onBack: () => void; onOpenLocation: () => void }) {
  const { t, locale } = useLocalization()
  const [orientation, setOrientation] = useState<{ status: OrientationStatus; heading: number | null; accuracy: number | null; reason: 'blackout' | 'caution' | 'model-unavailable' | null }>({
    status: 'idle', heading: null, accuracy: null, reason: null,
  })
  const session = useRef<ReturnType<typeof createOrientationSession> | null>(null)
  const filteredHeading = useRef<number | null>(null)
  const lastFilterTime = useRef(0)
  const lastSensorFrame = useRef<{ source: string; screenAngle: number } | null>(null)
  const pendingFrame = useRef<number | null>(null)
  const pendingOrientation = useRef(orientation)
  const wmm = useMemo(() => {
    if (!place) return { kind: 'invalid-input' as const }
    const now = new Date()
    const year = now.getUTCFullYear()
    const start = Date.UTC(year, 0, 1)
    const end = Date.UTC(year + 1, 0, 1)
    return calculateWmm2025({
      year: year + (now.getTime() - start) / (end - start),
      latitude: place.latitude,
      longitude: place.longitude,
      altitudeKm: 0,
    })
  }, [place])
  const wmmRef = useRef(wmm)
  useEffect(() => { wmmRef.current = wmm }, [wmm])

  useEffect(() => {
    const publish = (next: typeof orientation) => {
      pendingOrientation.current = next
      if (pendingFrame.current !== null) return
      pendingFrame.current = requestAnimationFrame(() => {
        pendingFrame.current = null
        setOrientation(pendingOrientation.current)
      })
    }
    session.current = createOrientationSession(window, (status, reading) => {
      if (!reading) {
        if (status !== 'live-unverified') {
          filteredHeading.current = null
          lastFilterTime.current = 0
          lastSensorFrame.current = null
          publish({ status, heading: null, accuracy: null, reason: null })
        }
        return
      }
      const model = wmmRef.current
      if (model.kind !== 'calculated') {
        publish({ status: 'degraded', heading: null, accuracy: reading.accuracyDegrees, reason: 'model-unavailable' })
        return
      }
      if (model.horizontalIntensityNt < 2000) {
        publish({ status: 'degraded', heading: null, accuracy: reading.accuracyDegrees, reason: 'blackout' })
        return
      }
      const heading = toTrueHeading(reading.headingMagneticDegrees, reading.northReference, model.declinationEastDegrees)
      if (heading.kind !== 'true-heading') {
        publish({ status: 'degraded', heading: null, accuracy: reading.accuracyDegrees, reason: null })
        return
      }
      const now = performance.now()
      const frameChanged = lastSensorFrame.current !== null
        && (lastSensorFrame.current.source !== reading.source || lastSensorFrame.current.screenAngle !== reading.screenAngle)
      const filtered = filteredHeading.current === null || frameChanged
        ? wrap360(heading.degrees)
        : circularExponentialStep(filteredHeading.current, heading.degrees, now - lastFilterTime.current)
      filteredHeading.current = filtered
      lastFilterTime.current = now
      lastSensorFrame.current = { source: reading.source, screenAngle: reading.screenAngle }
      publish({
        status: 'live-unverified', heading: filtered, accuracy: reading.accuracyDegrees,
        reason: model.horizontalIntensityNt < 6000 ? 'caution' : null,
      })
    })
    return () => {
      session.current?.stop()
      session.current = null
      if (pendingFrame.current !== null) cancelAnimationFrame(pendingFrame.current)
    }
  }, [])

  const timestampValid = place !== null && Number.isFinite(place.timestamp) && Number.isFinite(new Date(place.timestamp).getTime())
  const bearing = place && timestampValid ? calculateQiblaBearing(place) : { kind: 'undefined' as const, reason: 'invalid-position' as const }
  const originUncertainty = place && timestampValid ? estimateBearingOriginUncertainty(place) : { kind: 'unknown' as const }
  const source = place?.selection === 'gps' ? t('qiblaLocationGps') : t('qiblaLocationCity')
  const orientationMessage = (() => {
    switch (orientation.status) {
      case 'idle': return t('qiblaOrientationIdle')
      case 'acquiring': return t('qiblaOrientationAcquiring')
      case 'live-unverified': return t('qiblaOrientationLiveUnverified')
      case 'tilt': return t('qiblaOrientationTilt')
      case 'degraded': return t('qiblaOrientationDegraded')
      case 'denied': return t('qiblaOrientationDenied')
      case 'restricted': return t('qiblaOrientationRestricted')
      case 'unsupported': return t('qiblaOrientationUnsupported')
      case 'security': return t('qiblaOrientationSecurity')
      case 'null-reading': return t('qiblaOrientationNullReading')
      case 'timeout': return t('qiblaOrientationTimeout')
    }
  })()
  const recordedAt = place?.selection === 'gps' && Number.isFinite(place.timestamp)
    && Number.isFinite(new Date(place.timestamp).getTime())
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(place.timestamp))
    : null

  return <Screen label={t('qiblaTitle')} top={<BackButton onClick={onBack} />} contentClassName="qibla-screen-content">
    <div className="qibla-screen">
      <h1>{t('qiblaTitle')}</h1>
      {bearing.kind === 'bearing' ? <>
        {originUncertainty.kind === 'unbounded'
          ? <p className="screen-copy" role="status">{t('qiblaOriginBearingUncertaintyUnbounded')}</p>
          : <div className="qibla-dial" role="img" aria-label={t('qiblaDialDescription', { azimuth: roundAzimuthForDisplay(bearing.azimuth) })}
            style={{ transform: `rotate(${orientation.heading === null ? 0 : -orientation.heading}deg)` }}>
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
        {orientation.reason === 'blackout' ? <p>{t('qiblaMagneticBlackout')}</p> : null}
        {orientation.reason === 'caution' ? <p>{t('qiblaMagneticCaution')}</p> : null}
        {orientation.reason === 'model-unavailable' ? <p>{t('qiblaMagneticModelUnavailable')}</p> : null}
        <p>{t('qiblaWmmAltitudeAssumption')}</p>
        {orientation.accuracy !== null ? <p>{t('qiblaSensorAccuracy', { degrees: formatAngularUncertainty(orientation.accuracy) })}</p> : null}
        {orientation.status === 'idle' || orientation.status === 'denied' || orientation.status === 'restricted'
          || orientation.status === 'unsupported' || orientation.status === 'security' || orientation.status === 'timeout'
          || orientation.status === 'null-reading'
          ? <ActionButton onClick={() => { void session.current?.enableFromGesture() }}>{t('qiblaEnableCompass')}</ActionButton> : null}
        <ActionButton onClick={onOpenLocation}>{t('qiblaRefinePlace')}</ActionButton>
      </div>
    </div>
  </Screen>
}
