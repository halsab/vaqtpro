import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { circularExponentialStep, createOrientationSession, eulerScreenTopHeading, hasRememberedOrientationGrant, projectedHorizontalHeadingRate, quaternionScreenTopHeading, screenAngleDegrees } from './qiblaOrientation'

describe('Qibla orientation geometry', () => {

  it('derives a flat cardinal heading from the full Z-X-Y Euler transform', () => {
    expect(eulerScreenTopHeading({ alpha: 0, beta: 0, gamma: 0, screenAngle: 0 })).toMatchObject({ heading: 0 })
    expect(eulerScreenTopHeading({ alpha: 270, beta: 0, gamma: 0, screenAngle: 0 })).toMatchObject({ heading: 90 })
    expect(eulerScreenTopHeading({ alpha: 180, beta: 0, gamma: 0, screenAngle: 0 })).toMatchObject({ heading: 180 })
    expect(eulerScreenTopHeading({ alpha: 90, beta: 0, gamma: 0, screenAngle: 0 })).toMatchObject({ heading: 270 })
  })

  it('rejects a vertical screen top and normalizes quaternions', () => {
    expect(eulerScreenTopHeading({ alpha: 45, beta: 90, gamma: 0, screenAngle: 0 }).kind).toBe('tilt')
    expect(quaternionScreenTopHeading([0, 0, 0, 1], 0)).toMatchObject({ kind: 'heading', heading: 0 })
    expect(quaternionScreenTopHeading([0, 0, 0, 0], 0).kind).toBe('invalid')
  })




})

describe('Qibla orientation browser adapters', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
    Object.defineProperty(window, 'orientation', { configurable: true, writable: true, value: 0 })
    Object.defineProperty(window, 'screen', { configurable: true, value: { orientation: { angle: 0, addEventListener() {}, removeEventListener() {} } } })
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  })
  afterEach(() => {
    window.sessionStorage.clear()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const dispatchWebKitHeading = (heading: number) => window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
    alpha: 0, beta: 0, gamma: 0, absolute: false,
    webkitCompassHeading: heading, webkitCompassAccuracy: 5,
  }))

  it('requests absolute sensor permission only from the explicit call and rejects denial', async () => {
    const requestPermission = vi.fn().mockResolvedValue('denied')
    vi.stubGlobal('DeviceOrientationEvent', Object.assign(class extends Event {}, { requestPermission }))
    window.sessionStorage.setItem('vaqtpro.qibla.orientation-granted.v1', '1')
    const reports: string[] = []
    const session = createOrientationSession(window, status => reports.push(status))
    await session.enableFromGesture()
    expect(requestPermission).toHaveBeenCalledWith(true)
    expect(reports.at(-1)).toBe('denied')
    expect(hasRememberedOrientationGrant(window)).toBe(false)
    session.stop()
  })





  it('restores after BFCache pagehide/pageshow without a new focus event or duplicate source', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    vi.stubGlobal('AbsoluteOrientationSensor', undefined)
    vi.stubGlobal('DeviceOrientationEvent', class extends Event {})
    const added = vi.spyOn(window, 'addEventListener')
    const removed = vi.spyOn(window, 'removeEventListener')
    const reports: string[] = []
    const session = createOrientationSession(window, status => reports.push(status))
    try {
      await session.enableFromGesture()
      dispatchWebKitHeading(11)
      window.dispatchEvent(new Event('blur'))
      window.dispatchEvent(new Event('pagehide'))
      window.dispatchEvent(new Event('pageshow'))
      dispatchWebKitHeading(12)
      expect(reports.at(-1)).toBe('live-unverified')
      window.dispatchEvent(new Event('pageshow'))
      expect(added.mock.calls.filter(([type]) => type === 'deviceorientation')).toHaveLength(2)
      expect(removed.mock.calls.filter(([type]) => type === 'deviceorientation')).toHaveLength(1)
    } finally {
      session.stop()
    }
  })

  it('recovers after permission-dialog blur and resume events arrive before the permission promise settles', async () => {
    let resolvePermission: ((value: 'granted' | 'denied') => void) | undefined
    const requestPermission = vi.fn(() => new Promise<'granted' | 'denied'>(resolve => { resolvePermission = resolve }))
    vi.stubGlobal('DeviceOrientationEvent', Object.assign(class extends Event {}, { requestPermission }))
    const reports: string[] = []
    const diagnostics: string[] = []
    const session = createOrientationSession(window, status => reports.push(status), event => diagnostics.push(event.cause))
    try {
      const pendingEnable = session.enableFromGesture()
      window.dispatchEvent(new Event('blur'))
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('pageshow'))
      window.dispatchEvent(new Event('focus'))
      vi.spyOn(document, 'hasFocus').mockReturnValue(false)
      resolvePermission?.('granted')
      await pendingEnable
      window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
        alpha: 0, beta: 0, gamma: 0, absolute: false, webkitCompassHeading: 35, webkitCompassAccuracy: 5,
      }))
      expect(reports.at(-1)).toBe('live-unverified')
      expect(requestPermission).toHaveBeenCalledOnce()
      expect(diagnostics).toEqual(expect.arrayContaining([
        'permission-requested', 'focus-lost', 'visibility-hidden', 'visibility-restored',
        'page-restored', 'focus-restored', 'permission-granted', 'source-start',
      ]))
    } finally {
      session.stop()
    }
  })




















  it('uses the documented WebKit magnetic heading and applies screen angle once', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted')
    vi.stubGlobal('DeviceOrientationEvent', Object.assign(class extends Event {}, { requestPermission }))
    let screenChange: (() => void) | undefined
    const orientation = {
      angle: 90,
      addEventListener: vi.fn((_type: string, listener: () => void) => { screenChange = listener }),
      removeEventListener: vi.fn(),
    }
    Object.defineProperty(window, 'screen', {
      configurable: true,
      value: { orientation },
    })
    const reports: { status: string; reading?: { headingMagneticDegrees: number; northReference: string; accuracyDegrees: number | null; screenAngle: number } | undefined }[] = []
    const session = createOrientationSession(window, (status, reading) => reports.push({ status, reading }))
    await session.enableFromGesture()
    const event = Object.assign(new Event('deviceorientation'), { alpha: 0, beta: 0, gamma: 0, absolute: false,
      webkitCompassHeading: 359, webkitCompassAccuracy: 8 })
    window.dispatchEvent(event)
    expect(reports.at(-1)?.status).toBe('live-unverified')
    expect(reports.at(-1)?.reading?.headingMagneticDegrees).toBe(89)
    expect(reports.at(-1)?.reading?.northReference).toBe('magnetic')
    expect(reports.at(-1)?.reading?.accuracyDegrees).toBe(8)
    expect(reports.at(-1)?.reading?.screenAngle).toBe(90)
    window.dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: null, beta: null, gamma: null, absolute: false }))
    expect(reports.at(-1)?.status).toBe('live-unverified')
    orientation.angle = 180
    screenChange?.()
    expect(reports.at(-1)?.reading?.headingMagneticDegrees).toBe(179)
    expect(reports.at(-1)?.reading?.screenAngle).toBe(180)
    session.stop()
  })










  it('falls back to the validated WebKit scalar after Generic Sensor produces no readings', async () => {
    const instances: { onreading: (() => void) | null; onerror: ((event: Event & { error?: { name?: string } }) => void) | null }[] = []
    class SilentAbsoluteOrientationSensor {
      quaternion = null
      onreading: (() => void) | null = null
      onerror: ((event: Event & { error?: { name?: string } }) => void) | null = null
      start() {}
      stop() {}
      constructor() { instances.push(this) }
    }
    vi.stubGlobal('AbsoluteOrientationSensor', SilentAbsoluteOrientationSensor)
    vi.stubGlobal('DeviceOrientationEvent', class extends Event {})
    vi.useFakeTimers()
    const reports: string[] = []
    const session = createOrientationSession(window, status => reports.push(status))
    await session.enableFromGesture()
    await vi.advanceTimersByTimeAsync(4000)
    expect(reports.at(-1)).toBe('acquiring')
    expect(instances[0]).toBeDefined()
    window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
      alpha: 0, beta: 0, gamma: 0, absolute: false, webkitCompassHeading: 220, webkitCompassAccuracy: 8,
    }))
    expect(reports.at(-1)).toBe('live-unverified')
    session.stop()
    vi.useRealTimers()
  })


  it('stops reading while hidden and resumes once visible without asking permission again', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted')
    vi.stubGlobal('DeviceOrientationEvent', Object.assign(class extends Event {}, { requestPermission }))
    const reports: string[] = []
    const session = createOrientationSession(window, status => reports.push(status))
    await session.enableFromGesture()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(reports.at(-1)).toBe('degraded')
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(requestPermission).toHaveBeenCalledOnce()
    session.stop()
  })
})
