export interface QiblaTraceEntry {
  elapsedMs: number
  event: 'status' | 'reading' | 'place-change' | 'model-change' | 'retry' | 'resume' | 'source-change'
  status?: string
  source?: string
  magneticHeadingDegrees?: number
  acceptedHeadingDegrees?: number
  displayedRelativeDegrees?: number
  screenAngleDegrees?: number
  reportedAccuracyDegrees?: number | null
  horizontalProjection?: number | null
  declinationEastDegrees?: number | null
  modelValid?: boolean
}

export interface QiblaDiagnosticTrace {
  enabled: boolean
  record(entry: Omit<QiblaTraceEntry, 'elapsedMs'>): void
  read(): readonly QiblaTraceEntry[]
  close(): void
}

declare global {
  interface Window {
    __qiblaCompassTrace?: () => readonly QiblaTraceEntry[]
  }
}

const TRACE_LIMIT = 240

export function qiblaDiagnosticsRequested(target: Window): boolean {
  if (!import.meta.env.DEV) return false
  try { return new URLSearchParams(target.location.search).get('qiblaDiagnostics') === '1' }
  catch { return false }
}

export function createQiblaDiagnosticTrace(target: Window, enabled: boolean): QiblaDiagnosticTrace {
  const startedAt = target.performance.now()
  const entries: QiblaTraceEntry[] = []
  const reader = () => entries.map(entry => ({ ...entry }))
  if (enabled) Object.defineProperty(target, '__qiblaCompassTrace', { configurable: true, value: reader })
  return {
    enabled,
    record(entry) {
      if (!enabled) return
      entries.push({ ...entry, elapsedMs: Math.max(0, target.performance.now() - startedAt) })
      if (entries.length > TRACE_LIMIT) entries.splice(0, entries.length - TRACE_LIMIT)
    },
    read: reader,
    close() {
      if (enabled && target.__qiblaCompassTrace === reader) delete target.__qiblaCompassTrace
      entries.length = 0
    },
  }
}
