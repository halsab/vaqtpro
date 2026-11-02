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
  return <MonthlyPdfAction key={viewKey} view={view} />
}

function MonthlyPdfAction({ view }: { view: ReturnType<typeof createMonthlyExportView> | null }) {
  const { t } = useLocalization()
  const [file, setFile] = useState<File | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [failed, setFailed] = useState(false)
  const preparationBusy = useRef(false)
  const sharingBusy = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const prepareFromTap = () => {
    if (!view || preparationBusy.current) return
    preparationBusy.current = true
    setFailed(false)
    setPreparing(true)
    // Never import or render a PDF on screen entry. Preparation starts
    // exclusively with this explicit button action.
    void import('./monthlyExportRenderer')
      .then(({ prepareMonthlyPdf }) => prepareMonthlyPdf(view))
      .then(pdf => {
        if (!mounted.current) return
        setFile(pdf)
      })
      .catch(() => { if (mounted.current) setFailed(true) })
      .finally(() => {
        preparationBusy.current = false
        if (mounted.current) setPreparing(false)
      })
  }

  const sharePreparedPdf = () => {
    if (!file || sharingBusy.current) return
    sharingBusy.current = true
    setSharing(true)
    setFailed(false)
    // deliverFile calls navigator.share synchronously, before any await.
    void deliverFile(file, navigator).then(result => {
      if (result === 'failed') setFailed(true)
    }).catch(() => setFailed(true)).finally(() => {
      sharingBusy.current = false
      setSharing(false)
    })
  }

  const handleAction = () => {
    if (preparing || sharing) return
    if (file) sharePreparedPdf()
    else prepareFromTap()
  }

  return <>
    <span className={`monthly-export-control${!view ? ' is-disabled' : ''}`}>
      <IconActionButton label={failed ? `${t('retry')}: ${t('exportPdf')}` : t('shareMonthlyTimetable')}
        title={failed ? `${t('retry')}: ${t('exportPdf')}` : t('exportPdf')}
        aria-busy={preparing || sharing || undefined}
        disabled={!view || preparing || sharing}
        onClick={handleAction}>
        {preparing || sharing ? <LoadingSpinner /> : <ShareIcon />}
      </IconActionButton>
    </span>
    {failed ? <span className="monthly-export-error" role="alert">{t('monthlyExportFailed')}</span> : null}
  </>
}
