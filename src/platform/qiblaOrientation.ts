import { shortestAngleDelta, wrap360 } from '../domain/qibla'

export type OrientationStatus = 'idle' | 'acquiring' | 'live-unverified' | 'tilt' | 'degraded' | 'denied' | 'restricted' | 'unsupported' | 'security' | 'null-reading' | 'timeout'
export interface OrientationReading {
  headingMagneticDegrees: number
  source: 'webkit-compass' | 'absolute-orientation-sensor'
  accuracyDegrees: number | null
  horizontalProjection: number
  screenAngle: number
  northReference: 'magnetic'
}
export type OrientationHandler = (status: OrientationStatus, reading?: OrientationReading) => void

const TAU_MS = 120
const MIN_HORIZONTAL_PROJECTION = 0.35
const NO_READING_TIMEOUT_MS = 4000
// Пробные пороги фильтра, наклона и ожидания требуют настройки и проверки на реальных устройствах.

export function screenAngleDegrees(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? wrap360(value) : 0
}

export function circularExponentialStep(previous: number, next: number, elapsedMs: number, tauMs = TAU_MS): number {
  if (!Number.isFinite(previous) || !Number.isFinite(next)) return Number.isFinite(next) ? wrap360(next) : 0
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0 || elapsedMs > 1000) return wrap360(next)
  const alpha = 1 - Math.exp(-elapsedMs / tauMs)
  return wrap360(previous + alpha * shortestAngleDelta(previous, next))
}

export type HeadingGeometry =
  | { kind: 'heading'; heading: number; horizontalProjection: number }
  | { kind: 'tilt' }
  | { kind: 'invalid' }

export function eulerScreenTopHeading(input: { alpha: number; beta: number; gamma: number; screenAngle: number }): HeadingGeometry {
  const { alpha, beta, gamma, screenAngle } = input
  if (![alpha, beta, gamma, screenAngle].every(Number.isFinite)) return { kind: 'invalid' }
  const a = alpha * Math.PI / 180, b = beta * Math.PI / 180, g = gamma * Math.PI / 180
  const sa = Math.sin(a), ca = Math.cos(a), sb = Math.sin(b), cb = Math.cos(b), sg = Math.sin(g), cg = Math.cos(g)
  // Z-X-Y intrinsic rotation maps natural device coordinates into the absolute reference frame.
  const matrix = new Float64Array(9)
  matrix[0] = ca * cg - sa * sb * sg; matrix[1] = -sa * cb
  matrix[3] = sa * cg + ca * sb * sg; matrix[4] = ca * cb
  const angle = screenAngle * Math.PI / 180
  const deviceX = Math.sin(angle), deviceY = Math.cos(angle)
  const east = matrix[0] * deviceX + matrix[1] * deviceY
  const north = matrix[3] * deviceX + matrix[4] * deviceY
  const horizontalProjection = Math.hypot(east, north)
  if (!Number.isFinite(horizontalProjection)) return { kind: 'invalid' }
  if (horizontalProjection < MIN_HORIZONTAL_PROJECTION) return { kind: 'tilt' }
  return { kind: 'heading', heading: wrap360(Math.atan2(east, north) * 180 / Math.PI), horizontalProjection }
}

export function quaternionScreenTopHeading(quaternion: readonly number[], screenAngle: number): HeadingGeometry {
  if (quaternion.length !== 4 || ![...quaternion, screenAngle].every(Number.isFinite)) return { kind: 'invalid' }
  const magnitude = Math.hypot(...quaternion)
  if (magnitude < 1e-8) return { kind: 'invalid' }
  const x = Number(quaternion[0]) / magnitude, y = Number(quaternion[1]) / magnitude
  const z = Number(quaternion[2]) / magnitude, w = Number(quaternion[3]) / magnitude
  const angle = screenAngle * Math.PI / 180
  const vx = Math.sin(angle), vy = Math.cos(angle)
  const east = (1 - 2 * (y * y + z * z)) * vx + 2 * (x * y - z * w) * vy
  const north = 2 * (x * y + z * w) * vx + (1 - 2 * (x * x + z * z)) * vy
  const horizontalProjection = Math.hypot(east, north)
  if (!Number.isFinite(horizontalProjection)) return { kind: 'invalid' }
  if (horizontalProjection < MIN_HORIZONTAL_PROJECTION) return { kind: 'tilt' }
  return { kind: 'heading', heading: wrap360(Math.atan2(east, north) * 180 / Math.PI), horizontalProjection }
}

export interface OrientationSession {
  enableFromGesture(): Promise<void>
  stop(): void
}

interface OrientationEventLike extends Event {
  alpha: number | null
  beta: number | null
  gamma: number | null
  absolute: boolean
  webkitCompassHeading?: number
  webkitCompassAccuracy?: number
}
interface AbsoluteOrientationLike extends EventTarget {
  quaternion: ArrayLike<number> | null
  start(): void
  stop(): void
  onreading: (() => void) | null
  onerror: ((event: Event & { error?: { name?: string } }) => void) | null
}
interface QiblaWindow extends Window {
  AbsoluteOrientationSensor?: new (options?: { referenceFrame?: 'device' | 'screen' }) => AbsoluteOrientationLike
  DeviceOrientationEvent?: typeof DeviceOrientationEvent & { requestPermission?: (absolute?: boolean) => Promise<'granted' | 'denied'> }
}

export function createOrientationSession(target: Window, report: OrientationHandler): OrientationSession {
  const win = target as QiblaWindow
  const doc = target.document
  let enabled = false
  let stopped = false
  let sensor: AbsoluteOrientationLike | null = null
  let eventHandler: ((event: Event) => void) | null = null
  let probeTimer = 0
  let lastReadingAt = 0
  let permissionGranted = false
  let hasCurrentReading = false
  let screenAngle = 0
  let latestWebKit: { heading: number; accuracyDegrees: number | null } | null = null

  const getScreenOrientation = () => (target.screen as unknown as { orientation?: ScreenOrientation }).orientation
  const readScreenAngle = () => { screenAngle = screenAngleDegrees(getScreenOrientation()?.angle) }
  const clearSource = () => {
    if (probeTimer) target.clearTimeout(probeTimer)
    probeTimer = 0
    latestWebKit = null
    hasCurrentReading = false
    if (eventHandler) target.removeEventListener('deviceorientation', eventHandler)
    eventHandler = null
    if (sensor) {
      sensor.onreading = null
      sensor.onerror = null
      try { sensor.stop() } catch { /* Sensor may already have stopped. */ }
      sensor = null
    }
  }
  const startSource = () => {
    if (!enabled || stopped || doc.visibilityState === 'hidden' || !doc.hasFocus()) return
    clearSource()
    readScreenAngle()
    report('acquiring')
    const hasOrientationEvent = typeof (target as Window & { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent === 'function'
    if (!win.AbsoluteOrientationSensor && !hasOrientationEvent) { report('unsupported'); return }
    lastReadingAt = Date.now()
    probeTimer = target.setTimeout(() => {
      if (Date.now() - lastReadingAt >= NO_READING_TIMEOUT_MS) {
        clearSource()
        report('timeout')
      }
    }, NO_READING_TIMEOUT_MS)

    if (win.AbsoluteOrientationSensor) {
      try {
        sensor = new win.AbsoluteOrientationSensor({ referenceFrame: 'device' })
        sensor.onreading = () => {
          if (!sensor?.quaternion) { if (!hasCurrentReading) report('null-reading'); return }
          lastReadingAt = Date.now()
          if (probeTimer) target.clearTimeout(probeTimer)
          probeTimer = 0
          const geometry = quaternionScreenTopHeading(Array.from(sensor.quaternion), screenAngle)
          if (geometry.kind === 'tilt') { hasCurrentReading = false; report('tilt'); return }
          if (geometry.kind !== 'heading') { report('degraded'); return }
          hasCurrentReading = true
          report('live-unverified', {
            headingMagneticDegrees: geometry.heading,
            source: 'absolute-orientation-sensor',
            accuracyDegrees: null,
            horizontalProjection: geometry.horizontalProjection,
            screenAngle,
            northReference: 'magnetic',
          })
        }
        sensor.onerror = event => {
          const name = event.error?.name
          report(name === 'NotAllowedError' ? 'restricted' : name === 'SecurityError' ? 'security' : 'degraded')
        }
        sensor.start()
        return
      } catch (error) {
        clearSource()
        report(error instanceof DOMException && error.name === 'SecurityError' ? 'security'
          : error instanceof DOMException && error.name === 'NotAllowedError' ? 'restricted' : 'degraded')
        return
      }
    }

    eventHandler = event => {
      const orientation = event as OrientationEventLike
      if (typeof orientation.webkitCompassHeading === 'number') {
        const rawHeading = orientation.webkitCompassHeading
        if (!Number.isFinite(rawHeading) || rawHeading < 0) { report('degraded'); return }
        lastReadingAt = Date.now()
        if (probeTimer) target.clearTimeout(probeTimer)
        probeTimer = 0
          const angle = screenAngleDegrees(getScreenOrientation()?.angle)
        const accuracy = orientation.webkitCompassAccuracy
        const accuracyDegrees = typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null
        latestWebKit = { heading: rawHeading, accuracyDegrees }
        hasCurrentReading = true
        report('live-unverified', {
          headingMagneticDegrees: wrap360(latestWebKit.heading + angle),
          source: 'webkit-compass',
          accuracyDegrees: latestWebKit.accuracyDegrees,
          horizontalProjection: 1,
          screenAngle: angle,
          northReference: 'magnetic',
        })
      } else if (orientation.alpha === null || orientation.beta === null || orientation.gamma === null) {
        if (hasCurrentReading) return
        report('null-reading')
      } else if (orientation.absolute) {
        // Generic absolute DeviceOrientationEvent does not identify a north or screen frame.
        report('degraded')
      } else report('degraded')
    }
    target.addEventListener('deviceorientation', eventHandler)
  }
  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') { clearSource(); if (enabled) report('degraded') }
    else if (enabled) startSource()
  }
  const onBlur = () => { clearSource(); if (enabled) report('degraded') }
  const onFocus = () => { if (enabled) startSource() }
  const onScreenChange = () => {
    readScreenAngle()
    if (!enabled) return
    if (latestWebKit) {
      report('live-unverified', {
        headingMagneticDegrees: wrap360(latestWebKit.heading + screenAngle),
        source: 'webkit-compass',
        accuracyDegrees: latestWebKit.accuracyDegrees,
        horizontalProjection: 1,
        screenAngle,
        northReference: 'magnetic',
      })
    } else startSource()
  }
  doc.addEventListener('visibilitychange', onVisibility)
  target.addEventListener('pagehide', onBlur)
  target.addEventListener('blur', onBlur)
  target.addEventListener('focus', onFocus)
  getScreenOrientation()?.addEventListener('change', onScreenChange)

  return {
    async enableFromGesture() {
      if (stopped) return
      if (!target.isSecureContext) { report('security'); return }
      if (doc.visibilityState === 'hidden') { report('degraded'); return }
      report('acquiring')
      const requestPermission = win.DeviceOrientationEvent?.requestPermission
      if (requestPermission && !permissionGranted) {
        try {
          const permission = await requestPermission.call(win.DeviceOrientationEvent, true)
          if (permission !== 'granted') { report('denied'); return }
          permissionGranted = true
        } catch (error) {
          report(error instanceof DOMException && error.name === 'SecurityError' ? 'security'
            : error instanceof DOMException && error.name === 'NotAllowedError' ? 'restricted' : 'denied')
          return
        }
      }
      enabled = true
      startSource()
    },
    stop() {
      stopped = true
      enabled = false
      clearSource()
      doc.removeEventListener('visibilitychange', onVisibility)
      target.removeEventListener('pagehide', onBlur)
      target.removeEventListener('blur', onBlur)
      target.removeEventListener('focus', onFocus)
      getScreenOrientation()?.removeEventListener('change', onScreenChange)
      report('idle')
    },
  }
}
