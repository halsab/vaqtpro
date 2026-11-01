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
  const [retry, setRetry] = useState(0)
  const busy = useRef(false)
  const preparation = useRef<Promise<MonthlyExportPreparation> | null>(null)

  useEffect(() => {
    let current = true
    if (view) {
      preparation.current ??= import('./monthlyExportRenderer')
        .then(({ prepareMonthlyExportFiles }) => prepareMonthlyExportFiles(view))
      void preparation.current.then(result => {
          if (!current) return
          setPrepared(result)
          setFailed(false)
        })
        .catch(() => { if (current) setFailed(true) })
    }
    return () => { current = false }
  }, [view, retry])
  const result = prepared
  const hasAvailableFormat = Boolean(result?.pdf || result?.png)
  const error = failed || Boolean(result?.failures.length)

  const onChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
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
    <span className={`monthly-export-control${hasAvailableFormat ? '' : ' is-disabled'}`}>
      <IconActionButton label={t('shareMonthlyTimetable')} title={t('shareMonthlyTimetable')} aria-hidden="true" tabIndex={-1} disabled={!hasAvailableFormat}>
        <ShareIcon />
      </IconActionButton>
      <select aria-label={t('shareMonthlyTimetable')} aria-busy={!result || undefined} disabled={!hasAvailableFormat}
        value="" onChange={onChange}>
        <option value="" hidden />
        <option value="pdf" disabled={!result?.pdf}>{t('exportPdf')}</option>
        <option value="png" disabled={!result?.png}>{t('exportPng')}</option>
      </select>
    </span>
    {error ? <span className="monthly-export-error" role="alert">{t('monthlyExportFailed')}
      <button type="button" className="monthly-export-retry" onClick={() => {
        setPrepared(null)
        setFailed(false)
        preparation.current = null
        setRetry(value => value + 1)
      }}>{t('retry')}</button>
    </span> : null}
  </>
}
