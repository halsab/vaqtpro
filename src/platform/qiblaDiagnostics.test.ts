import { afterEach, describe, expect, it, vi } from 'vitest'

import { createQiblaDiagnosticTrace, qiblaDiagnosticsRequested } from './qiblaDiagnostics'

describe('Qibla diagnostics', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete window.__qiblaCompassTrace
    window.history.replaceState({}, '', '/')
  })

  it('requires the explicit development query flag', () => {
    expect(qiblaDiagnosticsRequested(window)).toBe(false)
    window.history.replaceState({}, '', '/?qiblaDiagnostics=1')
    expect(qiblaDiagnosticsRequested(window)).toBe(import.meta.env.DEV)
  })

  it('keeps a bounded in-memory trace, exposes no coordinates, and clears it on close', () => {
    let now = 100
    vi.spyOn(window.performance, 'now').mockImplementation(() => now)
    const trace = createQiblaDiagnosticTrace(window, true)
    now = 125
    trace.record({ event: 'reading', source: 'webkit-compass', magneticHeadingDegrees: 5,
      displayedRelativeDegrees: -30, reportedAccuracyDegrees: 6, modelValid: true })
    expect(window.__qiblaCompassTrace?.()).toEqual([{
      event: 'reading', source: 'webkit-compass', magneticHeadingDegrees: 5,
      displayedRelativeDegrees: -30, reportedAccuracyDegrees: 6, modelValid: true, elapsedMs: 25,
    }])

    for (let index = 0; index < 250; index += 1) trace.record({ event: 'status', status: 'live-unverified' })
    expect(trace.read()).toHaveLength(240)
    expect(trace.read().some(entry => 'latitude' in entry || 'longitude' in entry)).toBe(false)

    trace.close()
    expect(window.__qiblaCompassTrace).toBeUndefined()
    expect(trace.read()).toHaveLength(0)
  })
})
