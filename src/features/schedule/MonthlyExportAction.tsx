import { useEffect, useMemo, useRef, useState } from 'react'

import { useLocalization } from '../../localization'
import { IconActionButton } from '../../ui/controls'
import { deliverFile } from './monthlyExportDelivery'
import { createMonthlyExportView, type MonthlyExportSnapshot } from './monthlyExportModel'
import type { MonthlyExportPreparation } from './monthlyExportRenderer'

function ShareIcon() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 15V3m0 0 4 4m-4-4L8 7M5 12v8h14v-8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

function LoadingSpinner() {
  return <svg className="monthly-export-spinner" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2" strokeDasharray="36 18" />
  </svg>
}

export function MonthlyExportAction({ snapshot, labels }: {
  snapshot: MonthlyExportSnapshot | null
  labels: Record<string, string>
}) {
  const view = useMemo(() => {
    if (!snapshot) return null
    try { return createMonthlyExportView(snapshot, labels) } catch { return null }
  }, [snapshot, labels])
  const viewKey = view ? JSON.stringify(view) : ''
  return <MonthlyExportActionForView key={viewKey} view={view} />
}

function MonthlyExportActionForView({ view }: { view: ReturnType<typeof createMonthlyExportView> | null }) {
  const { t } = useLocalization()
  const [prepared, setPrepared] = useState<MonthlyExportPreparation | null>(null)
  const [failed, setFailed] = useState(false)
  const [preparationRequest, setPreparationRequest] = useState(0)
  const [preparing, setPreparing] = useState(false)
  const preparationBusy = useRef(false)
  const busy = useRef(false)
  const preparation = useRef<Promise<MonthlyExportPreparation> | null>(null)
  const select = useRef<HTMLSelectElement>(null)
  const autoOpenPicker = useRef(false)

  useEffect(() => {
    let current = true
    if (view && preparationRequest > 0) {
      preparation.current ??= import('./monthlyExportRenderer')
        .then(({ prepareMonthlyExportFiles }) => prepareMonthlyExportFiles(view))
      void preparation.current.then(result => {
          if (!current) return
          setPrepared(result)
          setFailed(false)
        })
        .catch(() => { if (current) setFailed(true) })
        .finally(() => {
          if (!current) return
          preparationBusy.current = false
          setPreparing(false)
        })
    }
    return () => { current = false }
  }, [view, preparationRequest])
  const result = prepared
  const hasAvailableFormat = Boolean(result?.pdf || result?.png)
  const error = failed || Boolean(result?.failures.length)

  useEffect(() => {
    if (!hasAvailableFormat || preparing || !autoOpenPicker.current) return
    autoOpenPicker.current = false
    try {
      select.current?.showPicker()
    } catch {
      // При блокировке браузером готовый селектор остаётся доступен по следующему тапу.
    }
  }, [hasAvailableFormat, preparing])

  const onChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    autoOpenPicker.current = false
    const format = event.currentTarget.value
    event.currentTarget.value = ''
    if (!result || busy.current || (format !== 'pdf' && format !== 'png')) return
    busy.current = true
    setFailed(false)
    const file = format === 'pdf' ? result.pdf : result.png
    if (!file) {
      busy.current = false
      return
    }
    void deliverFile(file, navigator).then(deliveryResult => {
      if (deliveryResult === 'failed') setFailed(true)
    }).catch(() => setFailed(true)).finally(() => { busy.current = false })
  }

  return <>
    <span className={`monthly-export-control${!view ? ' is-disabled' : ''}`}>
      {hasAvailableFormat ? <>
        <IconActionButton label={t('shareMonthlyTimetable')} title={t('shareMonthlyTimetable')} aria-hidden="true" tabIndex={-1}>
          {preparing ? <LoadingSpinner /> : <ShareIcon />}
        </IconActionButton>
        <select ref={select} aria-label={t('shareMonthlyTimetable')} aria-busy={preparing || undefined}
          value="" onChange={onChange}>
          <option value="" hidden />
          <option value="pdf" disabled={!result?.pdf}>{t('exportPdf')}</option>
          <option value="png" disabled={!result?.png}>{t('exportPng')}</option>
        </select>
      </> : <IconActionButton label={t('shareMonthlyTimetable')} title={t('shareMonthlyTimetable')}
        aria-busy={preparing || undefined} aria-disabled={!view || preparing || failed || undefined} disabled={!view}
        onClick={() => {
          if (!view || preparationBusy.current || failed) return
          preparationBusy.current = true
          autoOpenPicker.current = true
          setPreparing(true)
          setPreparationRequest(value => value + 1)
        }}>
        {preparing ? <LoadingSpinner /> : <ShareIcon />}
      </IconActionButton>}
    </span>
    {error ? <span className="monthly-export-error" role="alert">{t('monthlyExportFailed')}
      <button type="button" className="monthly-export-retry" onClick={() => {
        setPrepared(null)
        setFailed(false)
        preparation.current = null
        preparationBusy.current = true
        autoOpenPicker.current = true
        setPreparing(true)
        setPreparationRequest(value => value + 1)
      }}>{t('retry')}</button>
    </span> : null}
  </>
}
