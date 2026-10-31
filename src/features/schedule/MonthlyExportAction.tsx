import { useEffect, useMemo, useRef, useState } from 'react'

import { useLocalization } from '../../localization'
import { IconActionButton } from '../../ui/controls'
import { deliverFile } from './monthlyExportDelivery'
import { createMonthlyExportView, type MonthlyExportSnapshot } from './monthlyExportModel'

function ShareIcon() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 15V3m0 0 4 4m-4-4L8 7M5 12v8h14v-8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

export function MonthlyExportAction({ snapshot, labels }: {
  snapshot: MonthlyExportSnapshot | null
  labels: Record<string, string>
}) {
  const { t } = useLocalization()
  const [prepared, setPrepared] = useState<{ key: string; files: { pdf: File; png: File } } | null>(null)
  const [failedKey, setFailedKey] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const busy = useRef(false)
  const view = useMemo(() => {
    if (!snapshot) return null
    try { return createMonthlyExportView(snapshot, labels) } catch { return null }
  }, [snapshot, labels])
  const viewKey = view ? JSON.stringify(view) : ''

  useEffect(() => {
    let current = true
    if (view) {
      void import('./monthlyExportRenderer').then(({ prepareMonthlyExportFiles }) => prepareMonthlyExportFiles(view))
        .then(files => { if (current) setPrepared({ key: viewKey, files }) })
        .catch(() => { if (current) setFailedKey(viewKey) })
    }
    return () => { current = false }
  }, [view, viewKey, retry])
  const files = prepared?.key === viewKey ? prepared.files : null
  const error = failedKey === viewKey

  const onChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const format = event.currentTarget.value
    event.currentTarget.value = ''
    if (!files || busy.current || (format !== 'pdf' && format !== 'png')) return
    busy.current = true
    setFailedKey(null)
    const file = format === 'pdf' ? files.pdf : files.png
    void deliverFile(file, navigator).then(result => {
      if (result === 'failed') setFailedKey(viewKey)
    }).catch(() => setFailedKey(viewKey)).finally(() => { busy.current = false })
  }

  return <>
    <span className={`monthly-export-control${files ? '' : ' is-disabled'}`}>
      <IconActionButton label={t('shareMonthlyTimetable')} title={t('shareMonthlyTimetable')} aria-hidden="true" tabIndex={-1} disabled={!files}>
        <ShareIcon />
      </IconActionButton>
      <select aria-label={t('shareMonthlyTimetable')} aria-busy={!files || undefined} disabled={!files}
        value="" onChange={onChange}>
        <option value="pdf">{t('exportPdf')}</option>
        <option value="png">{t('exportPng')}</option>
      </select>
    </span>
    {error ? <span className="monthly-export-error" role="alert">{t('monthlyExportFailed')}
      {!files ? <button type="button" className="monthly-export-retry" onClick={() => { setFailedKey(null); setRetry(value => value + 1) }}>{t('retry')}</button> : null}
    </span> : null}
  </>
}
