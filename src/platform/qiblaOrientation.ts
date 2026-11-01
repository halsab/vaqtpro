import { shortestAngleDelta, wrap360 } from '../domain/qibla'

export type OrientationStatus = 'idle' | 'acquiring' | 'live-unverified' | 'calibrating' | 'tilt' | 'degraded'
  | 'denied' | 'restricted' | 'unsupported' | 'security' | 'frame-unavailable' | 'null-reading' | 'timeout'
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
// Порог наклона и параметры фильтра/ожидания остаются предварительными до проверки на устройствах.

export function screenAngleDegrees(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value % 90 !== 0) return null
  return wrap360(value)
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
  let permissionGranted = false
  let permissionInFlight = false
  let lastStatus: OrientationStatus = 'idle'
  let activeSource: 'absolute' | 'webkit' | null = null
  let fallbackAttempted = false
  let sensor: AbsoluteOrientationLike | null = null
  let eventHandler: ((event: Event) => void) | null = null
  let probeTimer = 0
  let screenAngle: number | null = null
  let latestWebKit: { heading: number; accuracyDegrees: number | null } | null = null
  let latestQuaternion: number[] | null = null
  let hasCurrentReading = false
  const screenOrientation = (target.screen as unknown as { orientation?: ScreenOrientation }).orientation
  const emit: OrientationHandler = (status, reading) => {
    if (stopped) return
    lastStatus = status
    report(status, reading)
  }

  const readScreenAngle = (): number | null => {
    const apiAngle = screenOrientation?.angle
    const legacyAngle: unknown = Reflect.get(target, 'orientation')
    const angle = typeof apiAngle === 'number' ? apiAngle : typeof legacyAngle === 'number' ? legacyAngle : undefined
    return screenAngleDegrees(angle)
  }
  const cancelProbe = () => {
    if (probeTimer) target.clearTimeout(probeTimer)
    probeTimer = 0
  }
  const clearActiveSource = () => {
    cancelProbe()
    latestWebKit = null
    latestQuaternion = null
    hasCurrentReading = false
    if (eventHandler) target.removeEventListener('deviceorientation', eventHandler)
    eventHandler = null
    if (sensor) {
      sensor.onreading = null
      sensor.onerror = null
      try { sensor.stop() } catch { /* Sensor may already have stopped. */ }
      sensor = null
    }
    activeSource = null
  }
  const classifySensorError = (name?: string): OrientationStatus | null => {
    if (name === 'NotAllowedError') return 'restricted'
    if (name === 'SecurityError') return 'security'
    return null
  }
  const startProbe = (source: 'absolute' | 'webkit') => {
    cancelProbe()
    probeTimer = target.setTimeout(() => {
      probeTimer = 0
      if (stopped || activeSource !== source) return
      clearActiveSource()
      if (source === 'absolute') tryWebKitFallback()
      else emit('timeout')
    }, NO_READING_TIMEOUT_MS)
  }
  const startWebKitSource = () => {
    if (typeof win.DeviceOrientationEvent !== 'function') { emit('unsupported'); return }
    activeSource = 'webkit'
    latestWebKit = null
    hasCurrentReading = false
    eventHandler = event => {
      if (stopped || activeSource !== 'webkit') return
      const orientation = event as OrientationEventLike
      if (typeof orientation.webkitCompassHeading === 'number') {
        const rawHeading = orientation.webkitCompassHeading
        const accuracy = orientation.webkitCompassAccuracy
        const accuracyIsUnusable = typeof accuracy === 'number' && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy >= 180)
        if (!Number.isFinite(rawHeading) || rawHeading < 0 || accuracyIsUnusable) {
          latestWebKit = null
          hasCurrentReading = false
          cancelProbe()
          emit('calibrating')
          return
        }
        const currentScreenAngle = readScreenAngle()
        if (currentScreenAngle === null) {
          clearActiveSource()
          emit('frame-unavailable')
          return
        }
        screenAngle = currentScreenAngle
        const accuracyDegrees = typeof accuracy === 'number' && accuracy >= 0 ? accuracy : null
        latestWebKit = { heading: rawHeading, accuracyDegrees }
        hasCurrentReading = true
        cancelProbe()
        emit('live-unverified', {
          headingMagneticDegrees: wrap360(rawHeading + currentScreenAngle),
          source: 'webkit-compass', accuracyDegrees, horizontalProjection: 1,
          screenAngle: currentScreenAngle, northReference: 'magnetic',
        })
      } else if ((orientation.alpha === null || orientation.beta === null || orientation.gamma === null)
        && !hasCurrentReading && lastStatus !== 'calibrating') {
        emit('null-reading')
      } else if (orientation.absolute && !hasCurrentReading && lastStatus !== 'calibrating') {
        // Generic absolute DeviceOrientationEvent has no guaranteed north reference.
        emit('degraded')
      }
    }
    target.addEventListener('deviceorientation', eventHandler)
    startProbe('webkit')
  }
  const tryWebKitFallback = () => {
    if (stopped || fallbackAttempted) { emit('degraded'); return }
    fallbackAttempted = true
    clearActiveSource()
    const angle = readScreenAngle()
    if (angle === null) { emit('frame-unavailable'); return }
    screenAngle = angle
    emit('acquiring')
    startWebKitSource()
  }
  const startSource = () => {
    if (!enabled || stopped || doc.visibilityState === 'hidden') return
    if (!doc.hasFocus()) { emit('degraded'); return }
    clearActiveSource()
    fallbackAttempted = false
    const angle = readScreenAngle()
    if (angle === null) { emit('frame-unavailable'); return }
    screenAngle = angle
    emit('acquiring')
    if (!win.AbsoluteOrientationSensor) { startWebKitSource(); return }
    try {
      sensor = new win.AbsoluteOrientationSensor({ referenceFrame: 'device' })
      const currentSensor = sensor
      activeSource = 'absolute'
      currentSensor.onreading = () => {
        if (stopped || activeSource !== 'absolute' || sensor !== currentSensor) return
        if (!currentSensor.quaternion) {
          if (!hasCurrentReading) emit('null-reading')
          return
        }
        const quaternion = Array.from(currentSensor.quaternion)
        latestQuaternion = quaternion
        const currentScreenAngle = screenAngle
        if (currentScreenAngle === null) {
          clearActiveSource()
          emit('frame-unavailable')
          return
        }
        const geometry = quaternionScreenTopHeading(quaternion, currentScreenAngle)
        if (geometry.kind === 'tilt') { hasCurrentReading = false; cancelProbe(); emit('tilt'); return }
        if (geometry.kind !== 'heading') { if (!hasCurrentReading) emit('degraded'); return }
        hasCurrentReading = true
        cancelProbe()
        emit('live-unverified', {
          headingMagneticDegrees: geometry.heading,
          source: 'absolute-orientation-sensor', accuracyDegrees: null,
          horizontalProjection: geometry.horizontalProjection,
          screenAngle: currentScreenAngle, northReference: 'magnetic',
        })
      }
      currentSensor.onerror = event => {
        if (stopped || sensor !== currentSensor) return
        const status = classifySensorError(event.error?.name)
        clearActiveSource()
        if (status) emit(status)
        else tryWebKitFallback()
      }
      currentSensor.start()
      startProbe('absolute')
    } catch (error) {
      const name = error instanceof DOMException ? error.name : undefined
      clearActiveSource()
      const status = classifySensorError(name)
      if (status) emit(status)
      else tryWebKitFallback()
    }
  }
  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') { clearActiveSource(); if (enabled) emit('degraded') }
    else if (enabled) startSource()
  }
  const onBlur = () => { clearActiveSource(); if (enabled) emit('degraded') }
  const onResume = () => { if (enabled) startSource() }
  const onScreenChange = () => {
    const angle = readScreenAngle()
    if (angle === null) {
      clearActiveSource()
      if (enabled) emit('frame-unavailable')
      return
    }
    screenAngle = angle
    if (!enabled) return
    if (activeSource === 'webkit' && latestWebKit) {
      emit('live-unverified', {
        headingMagneticDegrees: wrap360(latestWebKit.heading + angle),
        source: 'webkit-compass', accuracyDegrees: latestWebKit.accuracyDegrees,
        horizontalProjection: 1, screenAngle: angle, northReference: 'magnetic',
      })
    } else if (activeSource === 'absolute' && latestQuaternion) {
      const geometry = quaternionScreenTopHeading(latestQuaternion, angle)
      if (geometry.kind === 'heading') {
        emit('live-unverified', {
          headingMagneticDegrees: geometry.heading, source: 'absolute-orientation-sensor',
          accuracyDegrees: null, horizontalProjection: geometry.horizontalProjection,
          screenAngle: angle, northReference: 'magnetic',
        })
      } else if (geometry.kind === 'tilt') { hasCurrentReading = false; emit('tilt') }
      else emit('degraded')
    } else if (!activeSource) startSource()
  }
  const onScreenOrientationChange = () => onScreenChange()
  doc.addEventListener('visibilitychange', onVisibility)
  target.addEventListener('pagehide', onBlur)
  target.addEventListener('pageshow', onResume)
  target.addEventListener('blur', onBlur)
  target.addEventListener('focus', onResume)
  target.addEventListener('orientationchange', onScreenOrientationChange)
  screenOrientation?.addEventListener('change', onScreenOrientationChange)

  return {
    async enableFromGesture() {
      if (stopped || permissionInFlight) return
      if (!target.isSecureContext) { emit('security'); return }
      if (doc.visibilityState === 'hidden') { emit('degraded'); return }
      if (enabled && (activeSource !== null || probeTimer !== 0) && lastStatus !== 'degraded') return
      permissionInFlight = true
      emit('acquiring')
      const requestPermission = win.DeviceOrientationEvent?.requestPermission
      if (requestPermission && !permissionGranted) {
        try {
          const permission = await requestPermission.call(win.DeviceOrientationEvent, true)
          if (permission !== 'granted') { emit('denied'); return }
          permissionGranted = true
        } catch (error) {
          const name = error instanceof DOMException ? error.name : undefined
          emit(name === 'SecurityError' ? 'security' : name === 'NotAllowedError' ? 'restricted' : 'denied')
          return
        } finally {
          permissionInFlight = false
        }
      } else permissionInFlight = false
      enabled = true
      startSource()
    },
    stop() {
      if (stopped) return
      stopped = true
      enabled = false
      clearActiveSource()
      doc.removeEventListener('visibilitychange', onVisibility)
      target.removeEventListener('pagehide', onBlur)
      target.removeEventListener('pageshow', onResume)
      target.removeEventListener('blur', onBlur)
      target.removeEventListener('focus', onResume)
      target.removeEventListener('orientationchange', onScreenOrientationChange)
      screenOrientation?.removeEventListener('change', onScreenOrientationChange)
    },
  }
}
