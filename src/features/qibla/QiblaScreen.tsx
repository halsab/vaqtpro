import type { CSSProperties } from 'react'

import type { Place } from '../../domain/place'
import { calculateQiblaBearing, estimateBearingOriginUncertainty } from '../../domain/qibla'
import { useLocalization } from '../../localization'
import { ActionButton } from '../../ui/controls'
import { BackButton, Screen } from '../../ui/Screen'

export function QiblaScreen({ place, onBack, onOpenLocation }: { place: Place | null; onBack: () => void; onOpenLocation: () => void }) {
  const { t, locale } = useLocalization()
  const timestampValid = place !== null && Number.isFinite(place.timestamp) && Number.isFinite(new Date(place.timestamp).getTime())
  const bearing = place && timestampValid ? calculateQiblaBearing(place) : { kind: 'undefined' as const, reason: 'invalid-position' as const }
  const originUncertainty = place && timestampValid ? estimateBearingOriginUncertainty(place) : { kind: 'unknown' as const }
  const source = place?.selection === 'gps' ? t('qiblaLocationGps') : t('qiblaLocationCity')
  const recordedAt = place?.selection === 'gps' && Number.isFinite(place.timestamp)
    && Number.isFinite(new Date(place.timestamp).getTime())
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(place.timestamp))
    : null

  return <Screen label={t('qiblaTitle')} top={<BackButton onClick={onBack} />} contentClassName="qibla-screen-content">
    <div className="qibla-screen">
      <h1>{t('qiblaTitle')}</h1>
      {bearing.kind === 'bearing' ? <>
        <div className="qibla-dial" role="img" aria-label={t('qiblaDialDescription', { azimuth: Math.round(bearing.azimuth) })}>
          <span className="qibla-north" aria-hidden="true">{t('qiblaNorth')}</span>
          <span className="qibla-south" aria-hidden="true">{t('qiblaSouth')}</span>
          <span className="qibla-east" aria-hidden="true">{t('qiblaEast')}</span>
          <span className="qibla-west" aria-hidden="true">{t('qiblaWest')}</span>
          <span className="qibla-pointer" style={{ '--qibla-angle': `${bearing.azimuth}deg` } as CSSProperties} aria-hidden="true" />
          <span className="qibla-center" aria-hidden="true" />
        </div>
        <p className="qibla-bearing"><span>{bearing.azimuth.toFixed(0)}°</span><span>{t('qiblaTrueNorth')}</span></p>
      </> : <p className="screen-copy" role="status">{t(bearing.reason === 'invalid-position' ? 'qiblaNoValidPlace' : 'qiblaDirectionUndefined')}</p>}
      <div className="qibla-status">
        <p>{t('qiblaPlaceSource', { source })}</p>
        {place?.selection === 'gps' && place.accuracy !== null
          ? <p>{t('qiblaLocationAccuracy', { meters: Math.round(place.accuracy) })}</p>
          : place?.selection === 'city' ? <p>{t('qiblaCityAccuracyUnknown')}</p> : null}
        {recordedAt ? <p>{t('qiblaLocationRecordedAt', { value: recordedAt })}</p> : null}
        {originUncertainty.kind === 'bounded' ? <p>{t('qiblaOriginBearingUncertainty', { degrees: originUncertainty.radiusDegrees.toFixed(1) })}</p>
          : originUncertainty.kind === 'unbounded' ? <p>{t('qiblaOriginBearingUncertaintyUnbounded')}</p> : null}
        <p>{t('qiblaStaticMode')}</p>
        <p>{t('qiblaLiveUnavailable')}</p>
        <ActionButton onClick={onOpenLocation}>{t('qiblaRefinePlace')}</ActionButton>
      </div>
    </div>
  </Screen>
}
