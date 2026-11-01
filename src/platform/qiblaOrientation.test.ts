import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { circularExponentialStep, createOrientationSession, eulerScreenTopHeading, quaternionScreenTopHeading, screenAngleDegrees } from './qiblaOrientation'

describe('Qibla orientation geometry', () => {
  it.each([[0, 0], [90, 90], [180, 180], [270, 270]])('maps screen rotation %i once', (angle, expected) => {
    expect(screenAngleDegrees(angle)).toBe(expected)
  })

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

  it.each([[0, 0], [90, 90], [180, 180], [270, 270]])('maps the device-frame screen top at %i degrees', (screenAngle, expected) => {
    expect(quaternionScreenTopHeading([0, 0, 0, 1], screenAngle)).toMatchObject({ heading: expected })
  })

  it('smooths across north in the short direction and reseeds on interrupted time', () => {
    const filtered = circularExponentialStep(359, 1, 100, 120)
    expect(filtered > 359 || filtered < 1).toBe(true)
    expect(circularExponentialStep(359, 90, 0, 120)).toBe(90)
  })
})

describe('Qibla orientation browser adapters', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('requests absolute sensor permission only from the explicit call and rejects denial', async () => {
    const requestPermission = vi.fn().mockResolvedValue('denied')
    vi.stubGlobal('DeviceOrientationEvent', Object.assign(class extends Event {}, { requestPermission }))
    const reports: string[] = []
    const session = createOrientationSession(window, status => reports.push(status))
    await session.enableFromGesture()
    expect(requestPermission).toHaveBeenCalledWith(true)
    expect(reports.at(-1)).toBe('denied')
    session.stop()
  })

  it('rejects an unverified absolute Euler event instead of converting alpha to a compass bearing', async () => {
    vi.stubGlobal('DeviceOrientationEvent', class extends Event {})
    const reports: string[] = []
    const session = createOrientationSession(window, status => reports.push(status))
    await session.enableFromGesture()
    window.dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: 270, beta: 0, gamma: 0, absolute: true }))
    expect(reports.at(-1)).toBe('degraded')
    session.stop()
  })

  it('distinguishes a null sensor reading and stops probing after its bounded timeout', async () => {
    vi.stubGlobal('DeviceOrientationEvent', class extends Event {})
    const reports: string[] = []
    const session = createOrientationSession(window, status => reports.push(status))
    await session.enableFromGesture()
    window.dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: null, beta: null, gamma: null, absolute: false }))
    expect(reports.at(-1)).toBe('null-reading')
    session.stop()

    vi.useFakeTimers()
    const timeoutSession = createOrientationSession(window, status => reports.push(status))
    await timeoutSession.enableFromGesture()
    await vi.advanceTimersByTimeAsync(4000)
    expect(reports.at(-1)).toBe('timeout')
    timeoutSession.stop()
    vi.useRealTimers()
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

  it('ignores an invalid WebKit accuracy estimate instead of presenting a negative uncertainty', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted')
    vi.stubGlobal('DeviceOrientationEvent', Object.assign(class extends Event {}, { requestPermission }))
    const reports: ({ status: string; reading?: { accuracyDegrees: number | null } | undefined } | undefined)[] = []
    const session = createOrientationSession(window, (status, reading) => reports.push({ status, reading }))
    await session.enableFromGesture()
    window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
      alpha: 0, beta: 0, gamma: 0, absolute: false, webkitCompassHeading: 42, webkitCompassAccuracy: -1,
    }))
    expect(reports.at(-1)).toMatchObject({ status: 'live-unverified', reading: { accuracyDegrees: null } })
    session.stop()
  })

  it('uses a device-frame absolute sensor, and stops and detaches it on session cleanup', async () => {
    const instances: { quaternion: number[]; onreading: (() => void) | null; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = []
    class MockAbsoluteOrientationSensor {
      quaternion = [0, 0, 0, 1]
      onreading: (() => void) | null = null
      onerror: ((event: Event & { error?: { name?: string } }) => void) | null = null
      start = vi.fn()
      stop = vi.fn()
      constructor(options?: { referenceFrame?: string }) {
        expect(options).toEqual({ referenceFrame: 'device' })
        instances.push(this)
      }
    }
    vi.stubGlobal('AbsoluteOrientationSensor', MockAbsoluteOrientationSensor)
    const reports: string[] = []
    const session = createOrientationSession(window, status => reports.push(status))
    await session.enableFromGesture()
    instances[0]?.onreading?.()
    expect(reports).toContain('live-unverified')
    session.stop()
    expect(instances[0]?.stop).toHaveBeenCalledOnce()
    expect(instances[0]?.onreading).toBeNull()
  })

  it('reports excessive tilt separately instead of publishing a geographic heading', async () => {
    const instances: { quaternion: number[]; onreading: (() => void) | null }[] = []
    class MockAbsoluteOrientationSensor {
      quaternion = [Math.SQRT1_2, 0, 0, Math.SQRT1_2]
      onreading: (() => void) | null = null
      onerror: ((event: Event & { error?: { name?: string } }) => void) | null = null
      start() {}
      stop() {}
      constructor() { instances.push(this) }
    }
    vi.stubGlobal('AbsoluteOrientationSensor', MockAbsoluteOrientationSensor)
    const reports: string[] = []
    const session = createOrientationSession(window, status => reports.push(status))
    await session.enableFromGesture()
    instances[0]?.onreading?.()
    expect(reports.at(-1)).toBe('tilt')
    session.stop()
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
