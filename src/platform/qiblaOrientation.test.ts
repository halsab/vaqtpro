import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { circularExponentialStep, createOrientationSession, eulerScreenTopHeading, hasRememberedOrientationGrant, projectedHorizontalHeadingRate, quaternionScreenTopHeading, screenAngleDegrees } from './qiblaOrientation'

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

  it('projects three-axis motion onto the screen-top azimuth and excludes flat pitch/roll-only rates', () => {
    const flat = { kind: 'euler' as const, alpha: 0, beta: 0, gamma: 0 }
    expect(projectedHorizontalHeadingRate(flat, 0, { x: 0, y: 0, z: -90 })).toBeCloseTo(90)
    expect(projectedHorizontalHeadingRate(flat, 0, { x: 90, y: 0, z: 0 })).toBeCloseTo(0)
    expect(projectedHorizontalHeadingRate(flat, 0, { x: 0, y: 90, z: 0 })).toBeCloseTo(0)
    expect(projectedHorizontalHeadingRate(flat, 90, { x: 0, y: 0, z: -90 })).toBeCloseTo(90)
    expect(projectedHorizontalHeadingRate({ ...flat, beta: 90 }, 0, { x: 0, y: 0, z: 90 })).toBeNull()
  })

  it('uses the quaternion screen frame for horizontal motion projection', () => {
    expect(projectedHorizontalHeadingRate({ kind: 'quaternion', quaternion: [0, 0, 0, 1] }, 0,
      { x: 0, y: 0, z: -90 })).toBeCloseTo(90)
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

  it('resumes a remembered grant on a visible screen even when hasFocus reports false', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    window.sessionStorage.setItem('vaqtpro.qibla.orientation-granted.v1', '1')
    const reports: string[] = []
    const session = createOrientationSession(window, status => reports.push(status))
    session.resumeFromRememberedGrant()
    window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
      alpha: 0, beta: 0, gamma: 0, absolute: false, webkitCompassHeading: 25, webkitCompassAccuracy: 5,
    }))
    expect(reports.at(-1)).toBe('live-unverified')
    session.stop()
  })

  it('restores a remembered grant after a hidden screen becomes visible without prompting', () => {
    const requestPermission = vi.fn()
    vi.stubGlobal('DeviceOrientationEvent', Object.assign(class extends Event {}, { requestPermission }))
    window.sessionStorage.setItem('vaqtpro.qibla.orientation-granted.v1', '1')
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    const reports: string[] = []
    const session = createOrientationSession(window, status => reports.push(status))
    try {
      session.resumeFromRememberedGrant()
      expect(reports.at(-1)).toBe('degraded')
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
        alpha: 0, beta: 0, gamma: 0, absolute: false, webkitCompassHeading: 25, webkitCompassAccuracy: 5,
      }))
      expect(reports.at(-1)).toBe('live-unverified')
      expect(requestPermission).not.toHaveBeenCalled()
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

  it('restores a granted permission flow after blur without waiting for a focus event', async () => {
    let resolvePermission: ((value: 'granted' | 'denied') => void) | undefined
    const requestPermission = vi.fn(() => new Promise<'granted' | 'denied'>(resolve => { resolvePermission = resolve }))
    vi.stubGlobal('AbsoluteOrientationSensor', undefined)
    vi.stubGlobal('DeviceOrientationEvent', Object.assign(class extends Event {}, { requestPermission }))
    const added = vi.spyOn(window, 'addEventListener')
    const diagnostics: string[] = []
    const reports: string[] = []
    const session = createOrientationSession(window, status => reports.push(status), event => diagnostics.push(event.cause))
    try {
      const pendingEnable = session.enableFromGesture()
      window.dispatchEvent(new Event('blur'))
      vi.spyOn(document, 'hasFocus').mockReturnValue(false)
      expect(added.mock.calls.filter(([type]) => type === 'deviceorientation')).toHaveLength(0)

      resolvePermission?.('granted')
      await pendingEnable
      expect(added.mock.calls.filter(([type]) => type === 'deviceorientation')).toHaveLength(1)
      expect(diagnostics).toContain('permission-dialog-returned')

      dispatchWebKitHeading(35)
      expect(reports.at(-1)).toBe('live-unverified')
    } finally {
      session.stop()
    }
  })

  it('restores after a pending permission resolves in background when visibility returns without focus', async () => {
    let resolvePermission: ((value: 'granted' | 'denied') => void) | undefined
    const requestPermission = vi.fn(() => new Promise<'granted' | 'denied'>(resolve => { resolvePermission = resolve }))
    vi.stubGlobal('DeviceOrientationEvent', Object.assign(class extends Event {}, { requestPermission }))
    const added = vi.spyOn(window, 'addEventListener')
    const removed = vi.spyOn(window, 'removeEventListener')
    const reports: string[] = []
    const session = createOrientationSession(window, status => reports.push(status))
    try {
      const pendingEnable = session.enableFromGesture()
      window.dispatchEvent(new Event('blur'))
      window.dispatchEvent(new Event('pagehide'))
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
      resolvePermission?.('granted')
      await pendingEnable
      expect(added.mock.calls.filter(([type]) => type === 'deviceorientation')).toHaveLength(0)

      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
      expect(added.mock.calls.filter(([type]) => type === 'deviceorientation')).toHaveLength(1)
      window.dispatchEvent(new Event('pageshow'))
      expect(added.mock.calls.filter(([type]) => type === 'deviceorientation')).toHaveLength(2)
      expect(removed.mock.calls.filter(([type]) => type === 'deviceorientation')).toHaveLength(1)
      window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
        alpha: 0, beta: 0, gamma: 0, absolute: false, webkitCompassHeading: 35, webkitCompassAccuracy: 5,
      }))
      expect(reports.at(-1)).toBe('live-unverified')
      expect(added.mock.calls.filter(([type]) => type === 'deviceorientation')).toHaveLength(2)
    } finally {
      session.stop()
    }
  })

  it('stops on blur and reacquires once on focus even if hasFocus remains false', async () => {
    vi.stubGlobal('AbsoluteOrientationSensor', undefined)
    vi.stubGlobal('DeviceOrientationEvent', class extends Event {})
    const added = vi.spyOn(window, 'addEventListener')
    const removed = vi.spyOn(window, 'removeEventListener')
    const reports: string[] = []
    const session = createOrientationSession(window, status => reports.push(status))
    try {
      await session.enableFromGesture()
      window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
        alpha: 0, beta: 0, gamma: 0, absolute: false, webkitCompassHeading: 10, webkitCompassAccuracy: 5,
      }))
      expect(reports.at(-1)).toBe('live-unverified')

      vi.spyOn(document, 'hasFocus').mockReturnValue(false)
      window.dispatchEvent(new Event('blur'))
      window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
        alpha: 0, beta: 0, gamma: 0, absolute: false, webkitCompassHeading: 11, webkitCompassAccuracy: 5,
      }))
      expect(reports.at(-1)).toBe('degraded')
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
        alpha: 0, beta: 0, gamma: 0, absolute: false, webkitCompassHeading: 12, webkitCompassAccuracy: 5,
      }))
      expect(reports.at(-1)).toBe('live-unverified')
      expect(added.mock.calls.filter(([type]) => type === 'deviceorientation')).toHaveLength(2)
      expect(removed.mock.calls.filter(([type]) => type === 'deviceorientation')).toHaveLength(1)
    } finally {
      session.stop()
    }
  })

  it('retries a previously working session after blur when hasFocus remains false', async () => {
    vi.stubGlobal('AbsoluteOrientationSensor', undefined)
    vi.stubGlobal('DeviceOrientationEvent', Object.assign(class extends Event {}, { requestPermission: vi.fn().mockResolvedValue('granted') }))
    const reports: string[] = []
    const session = createOrientationSession(window, status => reports.push(status))
    try {
      await session.enableFromGesture()
      window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
        alpha: 0, beta: 0, gamma: 0, absolute: false, webkitCompassHeading: 15, webkitCompassAccuracy: 5,
      }))
      expect(reports.at(-1)).toBe('live-unverified')

      vi.spyOn(document, 'hasFocus').mockReturnValue(false)
      window.dispatchEvent(new Event('blur'))
      expect(reports.at(-1)).toBe('degraded')
      await session.enableFromGesture()
      window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
        alpha: 0, beta: 0, gamma: 0, absolute: false, webkitCompassHeading: 16, webkitCompassAccuracy: 5,
      }))
      expect(reports.at(-1)).toBe('live-unverified')
    } finally {
      session.stop()
    }
  })

  it('forgets remembered access when the Generic Sensor API reports a reliable permission denial', async () => {
    const instances: { onerror: ((event: Event & { error?: { name?: string } }) => void) | null; start: () => void; stop: () => void }[] = []
    class MockAbsoluteOrientationSensor {
      quaternion = [0, 0, 0, 1]
      onreading: (() => void) | null = null
      onerror: ((event: Event & { error?: { name?: string } }) => void) | null = null
      start() {}
      stop() {}
      constructor() { instances.push(this) }
    }
    window.sessionStorage.setItem('vaqtpro.qibla.orientation-granted.v1', '1')
    vi.stubGlobal('AbsoluteOrientationSensor', MockAbsoluteOrientationSensor)
    const reports: string[] = []
    const session = createOrientationSession(window, status => reports.push(status))
    session.resumeFromRememberedGrant()
    instances[0]?.onerror?.(Object.assign(new Event('error'), { error: { name: 'NotAllowedError' } }))
    expect(reports.at(-1)).toBe('restricted')
    expect(hasRememberedOrientationGrant(window)).toBe(false)
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('pageshow'))
    expect(instances).toHaveLength(1)
    await session.enableFromGesture()
    expect(instances).toHaveLength(2)
    session.stop()
  })

  it('keeps denied permission dormant across lifecycle events and repeated explicit retries', async () => {
    const requestPermission = vi.fn().mockResolvedValueOnce('denied').mockResolvedValueOnce('denied').mockResolvedValueOnce('granted')
    vi.stubGlobal('AbsoluteOrientationSensor', undefined)
    vi.stubGlobal('DeviceOrientationEvent', Object.assign(class extends Event {}, { requestPermission }))
    const added = vi.spyOn(window, 'addEventListener')
    const removed = vi.spyOn(window, 'removeEventListener')
    const reports: string[] = []
    const session = createOrientationSession(window, status => reports.push(status))
    const dispatchLifecycle = () => {
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('pageshow'))
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
    }
    try {
      await session.enableFromGesture()
      expect(reports.at(-1)).toBe('denied')
      dispatchLifecycle()
      expect(added.mock.calls.filter(([type]) => type === 'deviceorientation')).toHaveLength(0)

      await session.enableFromGesture()
      expect(reports.at(-1)).toBe('denied')
      dispatchLifecycle()
      expect(added.mock.calls.filter(([type]) => type === 'deviceorientation')).toHaveLength(0)

      await session.enableFromGesture()
      expect(reports.at(-1)).toBe('acquiring')
      expect(added.mock.calls.filter(([type]) => type === 'deviceorientation')).toHaveLength(1)
      window.dispatchEvent(new Event('focus'))
      expect(added.mock.calls.filter(([type]) => type === 'deviceorientation')).toHaveLength(1)
      window.dispatchEvent(new Event('pageshow'))
      expect(added.mock.calls.filter(([type]) => type === 'deviceorientation')).toHaveLength(2)
      expect(removed.mock.calls.filter(([type]) => type === 'deviceorientation')).toHaveLength(1)
      expect(added.mock.calls.filter(([type]) => type === 'deviceorientation').length
        - removed.mock.calls.filter(([type]) => type === 'deviceorientation').length).toBe(1)
      expect(requestPermission).toHaveBeenCalledTimes(3)
    } finally {
      session.stop()
    }
  })

  it('forgets remembered access when Generic Sensor startup throws NotAllowedError', () => {
    class DeniedAbsoluteOrientationSensor {
      quaternion = null
      onreading: (() => void) | null = null
      onerror: ((event: Event & { error?: { name?: string } }) => void) | null = null
      start() { throw new DOMException('Permission was revoked', 'NotAllowedError') }
      stop() {}
    }
    window.sessionStorage.setItem('vaqtpro.qibla.orientation-granted.v1', '1')
    vi.stubGlobal('AbsoluteOrientationSensor', DeniedAbsoluteOrientationSensor)
    const reports: string[] = []
    const session = createOrientationSession(window, status => reports.push(status))
    session.resumeFromRememberedGrant()
    expect(reports.at(-1)).toBe('restricted')
    expect(hasRememberedOrientationGrant(window)).toBe(false)
    session.stop()
  })

  it.each([true, false])('classifies generic Euler orientation (absolute=%s) as unsupported without producing a heading', async absolute => {
    vi.useFakeTimers()
    vi.stubGlobal('DeviceOrientationEvent', class extends Event {})
    const reports: { status: string; reading?: unknown }[] = []
    const diagnostics: string[] = []
    const session = createOrientationSession(window, (status, reading) => reports.push({ status, reading }), event => diagnostics.push(event.cause))
    try {
      await session.enableFromGesture()
      window.dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: 270, beta: 0, gamma: 0, absolute }))
      expect(reports.at(-1)).toMatchObject({ status: 'acquiring' })
      expect(reports.some(event => event.reading !== undefined)).toBe(false)
      await vi.advanceTimersByTimeAsync(4000)
      expect(reports.at(-1)).toMatchObject({ status: 'unsupported' })
      expect(diagnostics).toContain('source-unsupported')
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('pageshow'))
      expect(reports.at(-1)).toMatchObject({ status: 'unsupported' })
    } finally {
      session.stop()
    }
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

  it('times out a source only while it is acquiring its first valid reading', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('DeviceOrientationEvent', class extends Event {})
    const reports: string[] = []
    const session = createOrientationSession(window, status => reports.push(status))
    try {
      await session.enableFromGesture()
      const reading = () => window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
        alpha: 0, beta: 0, gamma: 0, absolute: false, webkitCompassHeading: 15, webkitCompassAccuracy: 5,
      }))
      await vi.advanceTimersByTimeAsync(4000)
      expect(reports.at(-1)).toBe('timeout')

      await session.enableFromGesture()
      reading()
      expect(reports.at(-1)).toBe('live-unverified')
      await vi.advanceTimersByTimeAsync(20_000)
      expect(reports.at(-1)).toBe('live-unverified')
    } finally {
      session.stop()
    }
  })

  it('revalidates WebKit permission on an explicit retry after foreground reacquisition times out', async () => {
    vi.useFakeTimers()
    const requestPermission = vi.fn().mockResolvedValueOnce('granted').mockResolvedValueOnce('denied')
    vi.stubGlobal('AbsoluteOrientationSensor', undefined)
    vi.stubGlobal('DeviceOrientationEvent', Object.assign(class extends Event {}, { requestPermission }))
    const added = vi.spyOn(window, 'addEventListener')
    const removed = vi.spyOn(window, 'removeEventListener')
    const reports: string[] = []
    const session = createOrientationSession(window, status => reports.push(status))
    try {
      await session.enableFromGesture()
      window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
        alpha: 0, beta: 0, gamma: 0, absolute: false, webkitCompassHeading: 15, webkitCompassAccuracy: 5,
      }))
      expect(hasRememberedOrientationGrant(window)).toBe(true)

      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(4000)
      expect(reports.at(-1)).toBe('timeout')

      await session.enableFromGesture()

      expect(requestPermission).toHaveBeenCalledTimes(2)
      expect(requestPermission).toHaveBeenLastCalledWith(true)
      expect(reports.at(-1)).toBe('denied')
      expect(hasRememberedOrientationGrant(window)).toBe(false)
      expect(added.mock.calls.filter(([type]) => type === 'deviceorientation')).toHaveLength(2)
      expect(removed.mock.calls.filter(([type]) => type === 'deviceorientation')).toHaveLength(2)
    } finally {
      session.stop()
    }
  })

  it('keeps lifecycle events from starting during revalidation, then restores after grant without focus', async () => {
    vi.useFakeTimers()
    let resolveRevalidation: ((value: 'granted' | 'denied') => void) | undefined
    const requestPermission = vi.fn()
      .mockResolvedValueOnce('granted')
      .mockImplementationOnce(() => new Promise<'granted' | 'denied'>(resolve => { resolveRevalidation = resolve }))
    vi.stubGlobal('AbsoluteOrientationSensor', undefined)
    vi.stubGlobal('DeviceOrientationEvent', Object.assign(class extends Event {}, { requestPermission }))
    const added = vi.spyOn(window, 'addEventListener')
    const removed = vi.spyOn(window, 'removeEventListener')
    const reports: string[] = []
    const session = createOrientationSession(window, status => reports.push(status))
    try {
      await session.enableFromGesture()
      dispatchWebKitHeading(20)
      expect(reports.at(-1)).toBe('live-unverified')

      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(4000)
      expect(reports.at(-1)).toBe('timeout')

      const pendingEnable = session.enableFromGesture()
      expect(requestPermission).toHaveBeenCalledTimes(2)
      const listenerAddsBeforeRevalidation = added.mock.calls.filter(([type]) => type === 'deviceorientation').length
      window.dispatchEvent(new Event('blur'))
      vi.spyOn(document, 'hasFocus').mockReturnValue(false)
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('pageshow'))
      expect(added.mock.calls.filter(([type]) => type === 'deviceorientation')).toHaveLength(listenerAddsBeforeRevalidation)

      resolveRevalidation?.('granted')
      await pendingEnable
      expect(added.mock.calls.filter(([type]) => type === 'deviceorientation')).toHaveLength(listenerAddsBeforeRevalidation + 1)
      dispatchWebKitHeading(21)
      expect(reports.at(-1)).toBe('live-unverified')
      expect(requestPermission).toHaveBeenCalledTimes(2)
      expect(added.mock.calls.filter(([type]) => type === 'deviceorientation')).toHaveLength(listenerAddsBeforeRevalidation + 1)
      expect(removed.mock.calls.filter(([type]) => type === 'deviceorientation')).toHaveLength(listenerAddsBeforeRevalidation)
    } finally {
      session.stop()
    }
  })

  it('disables a previously active session after async permission rejection until explicit retry', async () => {
    vi.useFakeTimers()
    const requestPermission = vi.fn()
      .mockResolvedValueOnce('granted')
      .mockRejectedValueOnce(new DOMException('Permission was revoked', 'NotAllowedError'))
      .mockResolvedValueOnce('granted')
    vi.stubGlobal('AbsoluteOrientationSensor', undefined)
    vi.stubGlobal('DeviceOrientationEvent', Object.assign(class extends Event {}, { requestPermission }))
    const added = vi.spyOn(window, 'addEventListener')
    const removed = vi.spyOn(window, 'removeEventListener')
    const reports: string[] = []
    const session = createOrientationSession(window, status => reports.push(status))
    try {
      await session.enableFromGesture()
      dispatchWebKitHeading(25)
      expect(hasRememberedOrientationGrant(window)).toBe(true)
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(4000)
      expect(reports.at(-1)).toBe('timeout')

      await session.enableFromGesture()
      expect(reports.at(-1)).toBe('restricted')
      expect(hasRememberedOrientationGrant(window)).toBe(false)
      const listenerAddsAfterFailure = added.mock.calls.filter(([type]) => type === 'deviceorientation').length
      const listenerRemovesAfterFailure = removed.mock.calls.filter(([type]) => type === 'deviceorientation').length
      expect(listenerRemovesAfterFailure).toBe(listenerAddsAfterFailure)

      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('pageshow'))
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
      dispatchWebKitHeading(26)
      expect(reports.at(-1)).toBe('restricted')
      expect(added.mock.calls.filter(([type]) => type === 'deviceorientation')).toHaveLength(listenerAddsAfterFailure)

      await session.enableFromGesture()
      expect(requestPermission).toHaveBeenCalledTimes(3)
      expect(added.mock.calls.filter(([type]) => type === 'deviceorientation')).toHaveLength(listenerAddsAfterFailure + 1)
      dispatchWebKitHeading(27)
      expect(reports.at(-1)).toBe('live-unverified')
    } finally {
      session.stop()
    }
  })

  it('cancels an active source and first-reading probe after a sensor permission failure', async () => {
    vi.useFakeTimers()
    const instances: { onerror: ((event: Event & { error?: { name?: string } }) => void) | null; start: () => void; stop: () => void }[] = []
    class MockAbsoluteOrientationSensor {
      quaternion = null
      onreading: (() => void) | null = null
      onerror: ((event: Event & { error?: { name?: string } }) => void) | null = null
      start() {}
      stop() {}
      constructor() { instances.push(this) }
    }
    vi.stubGlobal('AbsoluteOrientationSensor', MockAbsoluteOrientationSensor)
    const reports: string[] = []
    const session = createOrientationSession(window, status => reports.push(status))
    try {
      await session.enableFromGesture()
      expect(instances).toHaveLength(1)
      instances[0]?.onerror?.(Object.assign(new Event('error'), { error: { name: 'NotAllowedError' } }))
      expect(reports.at(-1)).toBe('restricted')
      await vi.advanceTimersByTimeAsync(4000)
      expect(reports.at(-1)).toBe('restricted')
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('pageshow'))
      expect(instances).toHaveLength(1)
    } finally {
      session.stop()
    }
  })

  it('keeps a granted permission attempt from activating a stopped session', async () => {
    let resolvePermission: ((value: 'granted' | 'denied') => void) | undefined
    const requestPermission = vi.fn(() => new Promise<'granted' | 'denied'>(resolve => { resolvePermission = resolve }))
    vi.stubGlobal('AbsoluteOrientationSensor', undefined)
    vi.stubGlobal('DeviceOrientationEvent', Object.assign(class extends Event {}, { requestPermission }))
    const added = vi.spyOn(window, 'addEventListener')
    const reports: string[] = []
    const session = createOrientationSession(window, status => reports.push(status))
    const pendingEnable = session.enableFromGesture()
    session.stop()
    resolvePermission?.('granted')
    await pendingEnable
    expect(added.mock.calls.filter(([type]) => type === 'deviceorientation')).toHaveLength(0)
    expect(reports).not.toContain('live-unverified')
  })

  it('handles an actual Generic Sensor failure after a stationary accepted reading', async () => {
    const instances: { quaternion: number[]; onreading: (() => void) | null; onerror: ((event: Event & { error?: { name?: string } }) => void) | null }[] = []
    class MockAbsoluteOrientationSensor {
      quaternion = [0, 0, 0, 1]
      onreading: (() => void) | null = null
      onerror: ((event: Event & { error?: { name?: string } }) => void) | null = null
      start() {}
      stop() {}
      constructor() { instances.push(this) }
    }
    vi.stubGlobal('AbsoluteOrientationSensor', MockAbsoluteOrientationSensor)
    vi.stubGlobal('DeviceOrientationEvent', class extends Event {})
    const reports: string[] = []
    const session = createOrientationSession(window, status => reports.push(status))
    try {
      await session.enableFromGesture()
      instances[0]?.onreading?.()
      expect(reports.at(-1)).toBe('live-unverified')
      instances[0]?.onerror?.(Object.assign(new Event('error'), { error: { name: 'NotReadableError' } }))
      expect(reports.at(-1)).toBe('acquiring')
      window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
        alpha: 0, beta: 0, gamma: 0, absolute: false, webkitCompassHeading: 25, webkitCompassAccuracy: 5,
      }))
      expect(reports.at(-1)).toBe('live-unverified')
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

  it('ignores an invalid WebKit accuracy estimate instead of presenting a negative uncertainty', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted')
    vi.stubGlobal('DeviceOrientationEvent', Object.assign(class extends Event {}, { requestPermission }))
    const reports: ({ status: string; reading?: { accuracyDegrees: number | null } | undefined } | undefined)[] = []
    const diagnostics: string[] = []
    const session = createOrientationSession(window, (status, reading) => reports.push({ status, reading }), event => diagnostics.push(event.cause))
    await session.enableFromGesture()
    window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
      alpha: 0, beta: 0, gamma: 0, absolute: false, webkitCompassHeading: 42, webkitCompassAccuracy: -1,
    }))
    expect(reports.at(-1)).toMatchObject({ status: 'calibrating' })
    expect(diagnostics).toContain('invalid-accuracy')
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
    expect(requestPermission).toHaveBeenCalledTimes(2)
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
    vi.useFakeTimers()
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
    await vi.advanceTimersByTimeAsync(4000)
    expect(reports.at(-1)).toBe('timeout')
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
    const diagnostics: string[] = []
    const session = createOrientationSession(window, status => reports.push(status), event => diagnostics.push(event.cause))
    try {
      await session.enableFromGesture()
      expect(reports.at(-1)).toBe('unsupported')
      expect(diagnostics.filter(cause => cause === 'source-unsupported')).toHaveLength(1)
      expect(added.mock.calls.filter(([type]) => type === 'devicemotion' || type === 'deviceorientation')).toHaveLength(0)

      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('pageshow'))
      document.dispatchEvent(new Event('visibilitychange'))
      expect(reports.at(-1)).toBe('unsupported')
      expect(diagnostics.filter(cause => cause === 'source-unsupported')).toHaveLength(1)
      expect(added.mock.calls.filter(([type]) => type === 'devicemotion' || type === 'deviceorientation')).toHaveLength(0)
    } finally {
      session.stop()
    }
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
