import { shortestAngleDelta, wrap360 } from '../domain/qibla'

export type OrientationStatus = 'idle' | 'acquiring' | 'live-unverified' | 'calibrating' | 'tilt' | 'tilt-unknown'
  | 'suspect' | 'degraded' | 'denied' | 'restricted' | 'unsupported' | 'security' | 'frame-unavailable'
  | 'null-reading' | 'timeout'
export interface OrientationReading {
  headingMagneticDegrees: number
  source: 'webkit-compass' | 'absolute-orientation-sensor'
  accuracyDegrees: number | null
  horizontalProjection: number
  screenAngle: number
  northReference: 'magnetic'
  sampleTimeMs: number
  motionRateDegreesPerSecond: number | null
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
  resumeFromRememberedGrant(): void
  stop(): void
}

const ORIENTATION_GRANT_KEY = 'vaqtpro.qibla.orientation-granted.v1'

export function hasRememberedOrientationGrant(target: Window): boolean {
  try { return target.sessionStorage.getItem(ORIENTATION_GRANT_KEY) === '1' }
  catch { return false }
}

function rememberOrientationGrant(target: Window): void {
  try { target.sessionStorage.setItem(ORIENTATION_GRANT_KEY, '1') }
  catch { /* Storage may be unavailable; the compass still works for this visit. */ }
}

function forgetOrientationGrant(target: Window): void {
  try { target.sessionStorage.removeItem(ORIENTATION_GRANT_KEY) }
  catch { /* Storage may be unavailable. */ }
}

interface OrientationEventLike extends Event {
  alpha: number | null
  beta: number | null
  gamma: number | null
  absolute: boolean
  webkitCompassHeading?: number
  webkitCompassAccuracy?: number
}
interface MotionEventLike extends Event {
  rotationRate?: { alpha: number | null; beta: number | null; gamma: number | null } | null
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
  let motionHandler: ((event: Event) => void) | null = null
  let probeTimer = 0
  let screenAngle: number | null = null
  let latestWebKit: { heading: number; accuracyDegrees: number | null; beta: number | null; gamma: number | null } | null = null
  let latestQuaternion: number[] | null = null
  let latestMotion: { rate: number; timeMs: number } | null = null
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
    clearMotionEvidence()
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
  const clearMotionEvidence = () => {
    if (motionHandler) target.removeEventListener('devicemotion', motionHandler)
    motionHandler = null
    latestMotion = null
  }
  const startMotionEvidence = () => {
    if (motionHandler) return
    motionHandler = event => {
      if (stopped || !enabled) return
      const rate = (event as MotionEventLike).rotationRate
      const components = [rate?.alpha, rate?.beta, rate?.gamma]
      if (!components.every(value => typeof value === 'number' && Number.isFinite(value))) return
      latestMotion = { rate: Math.hypot(components[0] as number, components[1] as number, components[2] as number), timeMs: target.performance.now() }
    }
    target.addEventListener('devicemotion', motionHandler)
  }
  const currentMotionRate = (now: number): number | null => latestMotion && now - latestMotion.timeMs <= 250
    ? latestMotion.rate : null
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
    if (typeof win.DeviceOrientationEvent !== 'function') {
      clearMotionEvidence()
      emit('unsupported')
      return
    }
    activeSource = 'webkit'
    startMotionEvidence()
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
          if (!probeTimer) startProbe('webkit')
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
        if (typeof orientation.beta !== 'number' || !Number.isFinite(orientation.beta)
          || typeof orientation.gamma !== 'number' || !Number.isFinite(orientation.gamma)) {
          latestWebKit = null
          hasCurrentReading = false
          if (!probeTimer) startProbe('webkit')
          emit('tilt-unknown')
          return
        }
        // Для проекции важны наклон и текущий экранный вектор; alpha не меняет длину проекции.
        const tilt = eulerScreenTopHeading({ alpha: 0, beta: orientation.beta, gamma: orientation.gamma, screenAngle: currentScreenAngle })
        if (tilt.kind === 'tilt') {
          latestWebKit = null
          hasCurrentReading = false
          if (!probeTimer) startProbe('webkit')
          emit('tilt')
          return
        }
        if (tilt.kind !== 'heading') {
          latestWebKit = null
          hasCurrentReading = false
          if (!probeTimer) startProbe('webkit')
          emit('tilt-unknown')
          return
        }
        const accuracyDegrees = typeof accuracy === 'number' && accuracy >= 0 ? accuracy : null
        latestWebKit = { heading: rawHeading, accuracyDegrees, beta: orientation.beta, gamma: orientation.gamma }
        hasCurrentReading = true
        permissionGranted = true
        rememberOrientationGrant(target)
        const sampleTimeMs = target.performance.now()
        cancelProbe()
        emit('live-unverified', {
          headingMagneticDegrees: wrap360(rawHeading + currentScreenAngle),
          source: 'webkit-compass', accuracyDegrees, horizontalProjection: tilt.horizontalProjection,
          screenAngle: currentScreenAngle, northReference: 'magnetic', sampleTimeMs,
          motionRateDegreesPerSecond: currentMotionRate(sampleTimeMs),
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
          hasCurrentReading = false
          if (!probeTimer) startProbe('absolute')
          emit('null-reading')
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
        if (geometry.kind !== 'heading') {
          hasCurrentReading = false
          if (!probeTimer) startProbe('absolute')
          emit(geometry.kind === 'tilt' ? 'tilt' : 'degraded')
          return
        }
        hasCurrentReading = true
        permissionGranted = true
        rememberOrientationGrant(target)
        const sampleTimeMs = target.performance.now()
        cancelProbe()
        emit('live-unverified', {
          headingMagneticDegrees: geometry.heading,
          source: 'absolute-orientation-sensor', accuracyDegrees: null,
          horizontalProjection: geometry.horizontalProjection,
          screenAngle: currentScreenAngle, northReference: 'magnetic', sampleTimeMs,
          motionRateDegreesPerSecond: currentMotionRate(sampleTimeMs),
        })
      }
      currentSensor.onerror = event => {
        if (stopped || sensor !== currentSensor) return
        const status = classifySensorError(event.error?.name)
        clearActiveSource()
        if (status) {
          if (status === 'restricted') permissionGranted = false
          emit(status)
        }
        else tryWebKitFallback()
      }
      currentSensor.start()
      startMotionEvidence()
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
    if (doc.visibilityState === 'hidden') { clearActiveSource(); clearMotionEvidence(); if (enabled) emit('degraded') }
    else if (enabled) startSource()
  }
  const onBlur = () => { clearActiveSource(); clearMotionEvidence(); if (enabled) emit('degraded') }
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
      const tilt = eulerScreenTopHeading({ alpha: 0, beta: latestWebKit.beta ?? Number.NaN,
        gamma: latestWebKit.gamma ?? Number.NaN, screenAngle: angle })
      if (tilt.kind !== 'heading') {
        latestWebKit = null
        hasCurrentReading = false
        if (!probeTimer) startProbe('webkit')
        emit(tilt.kind === 'tilt' ? 'tilt' : 'tilt-unknown')
        return
      }
      const sampleTimeMs = target.performance.now()
      emit('live-unverified', {
        headingMagneticDegrees: wrap360(latestWebKit.heading + angle),
        source: 'webkit-compass', accuracyDegrees: latestWebKit.accuracyDegrees,
        horizontalProjection: tilt.horizontalProjection, screenAngle: angle, northReference: 'magnetic',
        sampleTimeMs, motionRateDegreesPerSecond: currentMotionRate(sampleTimeMs),
      })
    } else if (activeSource === 'absolute' && latestQuaternion) {
      const geometry = quaternionScreenTopHeading(latestQuaternion, angle)
      if (geometry.kind === 'heading') {
        const sampleTimeMs = target.performance.now()
        emit('live-unverified', {
          headingMagneticDegrees: geometry.heading, source: 'absolute-orientation-sensor',
          accuracyDegrees: null, horizontalProjection: geometry.horizontalProjection,
          screenAngle: angle, northReference: 'magnetic', sampleTimeMs,
          motionRateDegreesPerSecond: currentMotionRate(sampleTimeMs),
        })
      } else if (geometry.kind === 'tilt') { hasCurrentReading = false; if (!probeTimer) startProbe('absolute'); emit('tilt') }
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
    resumeFromRememberedGrant() {
      if (stopped || enabled || !hasRememberedOrientationGrant(target)) return
      if (!target.isSecureContext) { emit('security'); return }
      if (doc.visibilityState === 'hidden') { emit('degraded'); return }
      enabled = true
      startSource()
    },
    async enableFromGesture() {
      if (stopped || permissionInFlight) return
      if (!target.isSecureContext) { emit('security'); return }
      if (doc.visibilityState === 'hidden') { emit('degraded'); return }
      const canRestart = ['degraded', 'suspect', 'calibrating', 'tilt', 'tilt-unknown', 'timeout', 'null-reading', 'frame-unavailable'].includes(lastStatus)
      if (enabled && (activeSource !== null || probeTimer !== 0) && !canRestart) return
      permissionInFlight = true
      emit('acquiring')
      const requestPermission = win.DeviceOrientationEvent?.requestPermission
      if (requestPermission && !permissionGranted) {
        try {
          const permission = await requestPermission.call(win.DeviceOrientationEvent, true)
          if (permission !== 'granted') { forgetOrientationGrant(target); emit('denied'); return }
          permissionGranted = true
        } catch (error) {
          const name = error instanceof DOMException ? error.name : undefined
          forgetOrientationGrant(target)
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
      clearMotionEvidence()
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
