import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { circularExponentialStep, createOrientationSession, eulerScreenTopHeading, hasRememberedOrientationGrant, quaternionScreenTopHeading, screenAngleDegrees } from './qiblaOrientation'

describe('Qibla orientation geometry', () => {
  it.each([[0, 0], [90, 90], [180, 180], [270, 270]])('maps screen rotation %i once', (angle, expected) => {
    expect(screenAngleDegrees(angle)).toBe(expected)
  })
  it('does not invent a screen angle when neither the platform nor legacy API provides one', () => {
    expect(screenAngleDegrees(undefined)).toBeNull()
    expect(screenAngleDegrees(45)).toBeNull()
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

  it('resumes a previously granted orientation session without requesting permission again', () => {
    const requestPermission = vi.fn().mockResolvedValue('granted')
    vi.stubGlobal('DeviceOrientationEvent', Object.assign(class extends Event {}, { requestPermission }))
    window.sessionStorage.setItem('vaqtpro.qibla.orientation-granted.v1', '1')
    expect(hasRememberedOrientationGrant(window)).toBe(true)
    const reports: string[] = []
    const session = createOrientationSession(window, status => reports.push(status))
    session.resumeFromRememberedGrant()
    expect(requestPermission).not.toHaveBeenCalled()
    window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
      alpha: 0, beta: 0, gamma: 0, absolute: false, webkitCompassHeading: 25, webkitCompassAccuracy: 5,
    }))
    expect(reports).toContain('live-unverified')
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
    expect(reports.at(-1)).toMatchObject({ status: 'calibrating' })
    window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
      alpha: 0, beta: 0, gamma: 0, absolute: false, webkitCompassHeading: 43, webkitCompassAccuracy: 7,
    }))
    expect(reports.at(-1)).toMatchObject({ status: 'live-unverified', reading: { accuracyDegrees: 7, headingMagneticDegrees: 43 } })
    session.stop()
  })

  it('times out while WebKit calibration stays invalid and retries without duplicating readings', async () => {
    vi.useFakeTimers()
    const requestPermission = vi.fn().mockResolvedValue('granted')
    vi.stubGlobal('DeviceOrientationEvent', Object.assign(class extends Event {}, { requestPermission }))
    const reports: string[] = []
    const added = vi.spyOn(window, 'addEventListener')
    const removed = vi.spyOn(window, 'removeEventListener')
    const session = createOrientationSession(window, status => reports.push(status))
    await session.enableFromGesture()
    window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
      alpha: 0, beta: 0, gamma: 0, absolute: false, webkitCompassHeading: 42, webkitCompassAccuracy: -1,
    }))
    await vi.advanceTimersByTimeAsync(4000)
    expect(reports.at(-1)).toBe('timeout')

    await session.enableFromGesture()
    window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
      alpha: 0, beta: 0, gamma: 0, absolute: false, webkitCompassHeading: 43, webkitCompassAccuracy: 7,
    }))
    expect(reports.filter(status => status === 'live-unverified')).toHaveLength(1)
    expect(requestPermission).toHaveBeenCalledOnce()
    session.stop()
    expect(added.mock.calls.filter(([type]) => type === 'devicemotion')).toHaveLength(2)
    expect(removed.mock.calls.filter(([type]) => type === 'devicemotion')).toHaveLength(2)
  })

  it('uses validated legacy window.orientation as a landscape fallback and updates on rotationchange', async () => {
    vi.stubGlobal('DeviceOrientationEvent', class extends Event {})
    Object.defineProperty(window, 'screen', { configurable: true, value: {} })
    Object.defineProperty(window, 'orientation', { configurable: true, writable: true, value: 90 })
    const reports: { status: string; reading?: { headingMagneticDegrees: number; screenAngle: number } | undefined }[] = []
    const session = createOrientationSession(window, (status, reading) => reports.push({ status, reading }))
    await session.enableFromGesture()
    window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
      alpha: 0, beta: 0, gamma: 0, absolute: false, webkitCompassHeading: 20, webkitCompassAccuracy: 5,
    }))
    expect(reports.at(-1)).toMatchObject({ status: 'live-unverified', reading: { headingMagneticDegrees: 110, screenAngle: 90 } })
    Object.defineProperty(window, 'orientation', { configurable: true, writable: true, value: -90 })
    window.dispatchEvent(new Event('orientationchange'))
    expect(reports.at(-1)).toMatchObject({ status: 'live-unverified', reading: { headingMagneticDegrees: 290, screenAngle: 270 } })
    session.stop()
  })

  it('disables live pointing when no screen-frame source exists', async () => {
    vi.stubGlobal('DeviceOrientationEvent', class extends Event {})
    Object.defineProperty(window, 'screen', { configurable: true, value: {} })
    Object.defineProperty(window, 'orientation', { configurable: true, value: undefined })
    const reports: string[] = []
    const addListener = vi.spyOn(window, 'addEventListener')
    const session = createOrientationSession(window, status => reports.push(status))
    await session.enableFromGesture()
    expect(reports.at(-1)).toBe('frame-unavailable')
    expect(addListener).not.toHaveBeenCalledWith('deviceorientation', expect.any(Function))
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

  it('falls back to WebKit only after Generic Sensor startup fails', async () => {
    class BrokenAbsoluteOrientationSensor {
      quaternion = null
      onreading: (() => void) | null = null
      onerror: ((event: Event & { error?: { name?: string } }) => void) | null = null
      start() { throw new Error('sensor unavailable') }
      stop() {}
    }
    vi.stubGlobal('AbsoluteOrientationSensor', BrokenAbsoluteOrientationSensor)
    vi.stubGlobal('DeviceOrientationEvent', class extends Event {})
    const reports: string[] = []
    const session = createOrientationSession(window, status => reports.push(status))
    await session.enableFromGesture()
    expect(reports.at(-1)).toBe('acquiring')
    window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
      alpha: 0, beta: 0, gamma: 0, absolute: false, webkitCompassHeading: 12, webkitCompassAccuracy: 4,
    }))
    expect(reports.at(-1)).toBe('live-unverified')
    session.stop()
  })

  it('falls back after an asynchronous Generic Sensor error and retries without duplicate subscriptions', async () => {
    const instances: { onreading: (() => void) | null; onerror: ((event: Event & { error?: { name?: string } }) => void) | null; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = []
    class BrokenAbsoluteOrientationSensor {
      quaternion = null
      onreading: (() => void) | null = null
      onerror: ((event: Event & { error?: { name?: string } }) => void) | null = null
      start = vi.fn()
      stop = vi.fn()
      constructor() { instances.push(this) }
    }
    vi.stubGlobal('AbsoluteOrientationSensor', BrokenAbsoluteOrientationSensor)
    vi.stubGlobal('DeviceOrientationEvent', class extends Event {})
    const added = vi.spyOn(window, 'addEventListener')
    const removed = vi.spyOn(window, 'removeEventListener')
    const reports: string[] = []
    const session = createOrientationSession(window, status => reports.push(status))
    await session.enableFromGesture()
    instances[0]?.onerror?.(Object.assign(new Event('error'), { error: { name: 'NotReadableError' } }))
    window.dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: 0, beta: 0, gamma: 0, absolute: true }))
    expect(reports.at(-1)).toBe('degraded')
    await session.enableFromGesture()
    expect(instances).toHaveLength(2)
    const orientationAdds = added.mock.calls.filter(([type]) => type === 'deviceorientation')
    const orientationRemoves = removed.mock.calls.filter(([type]) => type === 'deviceorientation')
    expect(orientationAdds).toHaveLength(1)
    expect(orientationRemoves).toHaveLength(1)
    instances[1]?.onerror?.(Object.assign(new Event('error'), { error: { name: 'NotReadableError' } }))
    window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
      alpha: 0, beta: 0, gamma: 0, absolute: false, webkitCompassHeading: 30, webkitCompassAccuracy: 5,
    }))
    expect(reports.at(-1)).toBe('live-unverified')
    session.stop()
    expect(instances[0]?.stop).toHaveBeenCalledOnce()
    expect(instances[1]?.stop).toHaveBeenCalledOnce()
    expect(removed.mock.calls.filter(([type]) => type === 'deviceorientation')).toHaveLength(2)
    expect(added.mock.calls.filter(([type]) => type === 'devicemotion')).toHaveLength(4)
    expect(removed.mock.calls.filter(([type]) => type === 'devicemotion')).toHaveLength(4)
  })

  it('does not retain motion evidence when no usable orientation source exists', async () => {
    vi.stubGlobal('DeviceOrientationEvent', undefined)
    vi.stubGlobal('AbsoluteOrientationSensor', undefined)
    const added = vi.spyOn(window, 'addEventListener')
    const reports: string[] = []
    const session = createOrientationSession(window, status => reports.push(status))
    await session.enableFromGesture()
    expect(reports.at(-1)).toBe('unsupported')
    expect(added.mock.calls.filter(([type]) => type === 'devicemotion')).toHaveLength(0)
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
