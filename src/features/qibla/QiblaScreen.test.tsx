import { StrictMode, Profiler, act } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'

import { createCityPlace } from '../../domain/place'
import type { City } from '../../domain/cities'
import { createTranslator } from '../../localization/messages'
import { QiblaScreen } from './QiblaScreen'
import { formatRelativeGuidance } from './relativeGuidance'

const place = createCityPlace({
  id: 551487, name: 'Казань', countryCode: 'RU', admin1Code: '73', admin1Name: 'Татарстан',
  latitude: 55.7946, longitude: 49.1115, population: 1_308_660, timeZone: 'Europe/Moscow',
} satisfies City, Date.UTC(2026, 0, 1))
const london = createCityPlace({
  id: 2643743, name: 'Лондон', countryCode: 'GB', admin1Code: 'ENG', admin1Name: 'England',
  latitude: 51.5072, longitude: -0.1276, population: 8_982_000, timeZone: 'Europe/London',
} satisfies City, Date.UTC(2026, 0, 1))

describe('QiblaScreen orientation presentation', () => {
  let frameId: number
  let sampleTime: number
  let frames: Map<number, FrameRequestCallback>
  let requestFrame: ReturnType<typeof vi.fn>
  let cancelFrame: ReturnType<typeof vi.fn>
  let requestPermission: ReturnType<typeof vi.fn>

  beforeEach(() => {
    window.sessionStorage.clear()
    frameId = 0
    sampleTime = 1000
    frames = new Map()
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
    Object.defineProperty(window, 'orientation', { configurable: true, writable: true, value: 0 })
    Object.defineProperty(window, 'screen', { configurable: true, value: {} })
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    vi.spyOn(window.performance, 'now').mockImplementation(() => sampleTime)
    requestFrame = vi.fn((callback: FrameRequestCallback) => {
      const id = ++frameId
      frames.set(id, callback)
      return id
    })
    cancelFrame = vi.fn((id: number) => { frames.delete(id) })
    vi.stubGlobal('requestAnimationFrame', requestFrame)
    vi.stubGlobal('cancelAnimationFrame', cancelFrame)
    requestPermission = vi.fn().mockResolvedValue('granted')
    vi.stubGlobal('AbsoluteOrientationSensor', undefined)
    vi.stubGlobal('DeviceOrientationEvent', Object.assign(class extends Event {}, { requestPermission }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function dispatchHeading(heading: number, time: number, options: { accuracy?: number | null; beta?: number | null; gamma?: number | null } = {}) {
    sampleTime = time
    act(() => { window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
      alpha: 0, beta: options.beta === undefined ? 0 : options.beta,
      gamma: options.gamma === undefined ? 0 : options.gamma, absolute: false,
      webkitCompassHeading: heading, webkitCompassAccuracy: options.accuracy === undefined ? 6 : options.accuracy,
    })) })
  }

  function flushFrame() {
    const frame = [...frames.entries()][0]
    if (!frame) return
    frames.delete(frame[0])
    act(() => frame[1](sampleTime))
  }

  async function activateCompass(user = userEvent.setup()) {
    await user.click(screen.getByRole('button', { name: 'Включить компас' }))
    await waitFor(() => expect(requestPermission).toHaveBeenCalledOnce())
    return user
  }

  it('shows the offline bearing and Back control without visible title, location controls or direction copy', () => {
    render(<QiblaScreen place={place} onBack={() => {}} />)
    expect(screen.getByRole('region', { name: 'Направление на киблу' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Назад' })).toBeVisible()
    expect(screen.getByRole('img', { name: /Азимут 195 градусов от истинного севера/ })).toBeVisible()
    expect(screen.getByText('195°')).toBeVisible()
    expect(screen.queryAllByRole('heading')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Включить компас' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /место|локация|город/i })).toBeNull()
    expect(screen.queryByText(/Живое направление доступно/)).toBeNull()
    expect(document.querySelector('.qibla-forward-marker')).toBeInTheDocument()
    expect(document.querySelector('.qibla-cardinal')).toBeInTheDocument()
  })

  it('survives StrictMode reinitialization and coalesces fast sensor events into one dial frame without visible instructions', async () => {
    const user = userEvent.setup()
    let commits = 0
    const view = render(<StrictMode><Profiler id="qibla" onRender={() => { commits += 1 }}>
      <QiblaScreen place={place} onBack={() => {}} />
    </Profiler></StrictMode>)
    await activateCompass(user)
    dispatchHeading(359, sampleTime)
    flushFrame()

    const pointer = document.querySelector('.qibla-pointer')
    expect(pointer).toHaveAttribute('data-visible', 'true')
    expect(pointer?.getAttribute('style')).toMatch(/--qibla-angle:/)
    expect(document.querySelector('.qibla-forward-marker')).toBeInTheDocument()
    const rose = document.querySelector('.qibla-rose')
    expect(rose?.getAttribute('style')).toMatch(/--qibla-rose-angle: -?\d+(\.\d+)?deg/)
    expect(rose?.getAttribute('style')).not.toMatch(/--qibla-rose-angle: 0deg/)
    expect(rose).toHaveTextContent('СВЮЗ')
    const liveRegion = document.querySelector('.qibla-screen .sr-only[aria-live="polite"]')
    expect(liveRegion).toHaveTextContent(/Поверните телефон (налево|направо)|Кибла позади/)
    expect(liveRegion).toHaveClass('sr-only')
    expect(screen.queryByText(/Поверните телефон/)).toBeNull()

    const commitsBeforeBurst = commits
    const requestCountBeforeBurst = requestFrame.mock.calls.length
    for (let index = 0; index < 100; index += 1) dispatchHeading(359, sampleTime + 16)
    expect(requestFrame.mock.calls.length - requestCountBeforeBurst).toBe(1)
    expect(commits - commitsBeforeBurst).toBeLessThanOrEqual(1)
    const pendingFrame = [...frames.entries()][0]
    expect(pendingFrame).toBeDefined()
    view.unmount()
    if (!pendingFrame) throw new Error('Expected a pending frame before unmount')
    expect(cancelFrame).toHaveBeenCalledWith(pendingFrame[0])
    act(() => pendingFrame[1](sampleTime))
    expect(document.querySelector('.qibla-dial')).toBeNull()
  })

  it('automatically resumes after a successful sensor reading without showing the enable button again', async () => {
    const firstVisit = render(<QiblaScreen place={place} onBack={() => {}} />)
    await activateCompass()
    dispatchHeading(25, 1000)
    flushFrame()
    expect(window.sessionStorage.getItem('vaqtpro.qibla.orientation-granted.v1')).toBe('1')
    firstVisit.unmount()

    requestPermission.mockClear()
    render(<QiblaScreen place={place} onBack={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Включить компас' })).toBeNull()
    dispatchHeading(25, 2000)
    flushFrame()
    expect(document.querySelector('.qibla-pointer')).toHaveAttribute('data-visible', 'true')
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('recovers an accurate stationary heading after a bounded quarantine when motion evidence is unavailable', async () => {
    render(<QiblaScreen place={place} onBack={() => {}} />)
    await activateCompass()
    dispatchHeading(0, 1000)
    flushFrame()
    dispatchHeading(180, 1050)
    expect(screen.getByRole('status')).toHaveTextContent(/Компас мог сбиться/)
    expect(document.querySelector('.qibla-pointer')).not.toHaveAttribute('data-visible', 'true')

    dispatchHeading(180, 1200)
    sampleTime = 1650
    dispatchHeading(180, 1650)
    flushFrame()
    expect(document.querySelector('.qibla-pointer')).toHaveAttribute('data-visible', 'true')
    expect(screen.queryByText(/Компас мог сбиться/)).toBeNull()
  })

  it('automatically reacquires a stationary 180-degree turn with unavailable accuracy and keeps a caution visible', async () => {
    render(<QiblaScreen place={place} onBack={() => {}} />)
    await activateCompass()
    dispatchHeading(0, 1000, { accuracy: null })
    dispatchHeading(180, 1050, { accuracy: null })
    dispatchHeading(180, 1550, { accuracy: null })
    dispatchHeading(180, 2050, { accuracy: null })
    dispatchHeading(180, 2550, { accuracy: null })
    flushFrame()
    expect(document.querySelector('.qibla-pointer')).toHaveAttribute('data-visible', 'true')
    expect(screen.getByRole('status')).toHaveTextContent(/Направление восстановлено\. Сверьте компас/)
  })

  it('does not recover from a single stale candidate when sensor readings stop', async () => {
    render(<QiblaScreen place={place} onBack={() => {}} />)
    await activateCompass()
    dispatchHeading(0, 1000)
    dispatchHeading(180, 1050)
    expect(document.querySelector('.qibla-pointer')).not.toHaveAttribute('data-visible', 'true')
    expect(screen.getByRole('status')).toHaveTextContent(/Компас мог сбиться/)
  })

  it('shows a concise WMM caution while withholding any claim of physical accuracy', async () => {
    const cautionPlace = { ...place, latitude: 70, longitude: -100 }
    render(<QiblaScreen place={cautionPlace} onBack={() => {}} />)
    await activateCompass()
    dispatchHeading(0, 1000)
    expect(screen.getByRole('status')).toHaveTextContent(/Компас может ошибаться\. Сверьте направление с ориентиром/)
    expect(document.querySelector('.qibla-pointer')).toHaveAttribute('data-visible', 'true')
    expect(screen.queryByText(/точность подтверждена|точно направлен/i)).toBeNull()
  })

  it('hides the needle during an isolated discontinuity, recovers when the heading returns, and retries a sustained ambiguous jump explicitly', async () => {
    render(<QiblaScreen place={place} onBack={() => {}} />)
    const user = await activateCompass()
    dispatchHeading(0, 1000)
    flushFrame()
    expect(document.querySelector('.qibla-pointer')).toHaveAttribute('data-visible', 'true')

    dispatchHeading(180, 1050)
    expect(screen.getByRole('status')).toHaveTextContent(/Компас мог сбиться/)
    expect(document.querySelector('.qibla-pointer')).not.toHaveAttribute('data-visible', 'true')
    dispatchHeading(2, 1100)
    expect(document.querySelector('.qibla-pointer')).toHaveAttribute('data-visible', 'true')

    dispatchHeading(180, 1150)
    dispatchHeading(180, 1155)
    expect(screen.getByRole('button', { name: 'Проверить компас' })).toBeVisible()
    expect(document.querySelector('.qibla-pointer')).not.toHaveAttribute('data-visible', 'true')
    await user.click(screen.getByRole('button', { name: 'Проверить компас' }))
    dispatchHeading(180, 1300)
    expect(document.querySelector('.qibla-pointer')).toHaveAttribute('data-visible', 'true')
    expect(requestPermission).toHaveBeenCalledOnce()
  })

  it('accepts a fast turn when contemporaneous motion evidence corroborates it', async () => {
    render(<QiblaScreen place={place} onBack={() => {}} />)
    await activateCompass()
    dispatchHeading(0, 1000)
    flushFrame()
    sampleTime = 1050
    act(() => { window.dispatchEvent(Object.assign(new Event('devicemotion'), {
      rotationRate: { alpha: 0, beta: 0, gamma: -3600 }, interval: 50,
    })) })
    dispatchHeading(180, 1050)
    expect(screen.queryByText(/Компас мог сбиться/)).toBeNull()
    expect(document.querySelector('.qibla-pointer')).toHaveAttribute('data-visible', 'true')
  })

  it('does not treat sparse gyro intervals as continuous evidence for a magnetic jump', async () => {
    render(<QiblaScreen place={place} onBack={() => {}} />)
    await activateCompass()
    dispatchHeading(0, 1000)
    flushFrame()

    for (const timeMs of [1020, 1050]) {
      sampleTime = timeMs
      act(() => { window.dispatchEvent(Object.assign(new Event('devicemotion'), {
        rotationRate: { alpha: 0, beta: 0, gamma: -9000 }, interval: 10,
      })) })
    }
    dispatchHeading(180, 1050)
    expect(screen.getByRole('status')).toHaveTextContent(/Компас мог сбиться/)
    expect(document.querySelector('.qibla-pointer')).not.toHaveAttribute('data-visible', 'true')
  })

  it('does not treat pitch-only gyro magnitude as evidence for a horizontal magnetic heading jump', async () => {
    render(<QiblaScreen place={place} onBack={() => {}} />)
    await activateCompass()
    dispatchHeading(0, 1000)
    flushFrame()
    sampleTime = 1050
    act(() => { window.dispatchEvent(Object.assign(new Event('devicemotion'), {
      rotationRate: { alpha: 7200, beta: 0, gamma: 0 }, interval: 50,
    })) })
    dispatchHeading(180, 1050)
    expect(screen.getByRole('status')).toHaveTextContent(/Компас мог сбиться/)
    expect(document.querySelector('.qibla-pointer')).not.toHaveAttribute('data-visible', 'true')
  })

  it('withholds a WebKit reading with unknown tilt and allows a valid calibrated sample to recover automatically', async () => {
    render(<QiblaScreen place={place} onBack={() => {}} />)
    await activateCompass()
    dispatchHeading(359, 1000, { accuracy: -1 })
    expect(screen.getByRole('status')).toHaveTextContent(/Уберите телефон от металла/)
    expect(document.querySelector('.qibla-pointer')).not.toHaveAttribute('data-visible', 'true')

    dispatchHeading(359, 1016, { beta: null })
    expect(screen.getByRole('status')).toHaveTextContent(/Держите телефон ровнее/)
    dispatchHeading(359, 1032, { accuracy: 8 })
    expect(document.querySelector('.qibla-pointer')).toHaveAttribute('data-visible', 'true')
    expect(screen.queryByText(/Проверьте компас/)).toBeNull()
  })

  it('never shows a live pointer from a first sample with extremely poor reported accuracy', async () => {
    render(<QiblaScreen place={place} onBack={() => {}} />)
    await activateCompass()
    dispatchHeading(42, 1000, { accuracy: 90 })
    expect(document.querySelector('.qibla-pointer')).not.toHaveAttribute('data-visible', 'true')
    expect(screen.getByRole('status')).toHaveTextContent(/Показано расчётное направление/)
  })

  it('recomputes the pointer after a Place change without waiting for another sensor event', async () => {
    const view = render(<QiblaScreen place={place} onBack={() => {}} />)
    await activateCompass()
    dispatchHeading(0, 1000)
    flushFrame()
    const kazaanAngle = document.querySelector('.qibla-pointer')?.getAttribute('style')
    view.rerender(<QiblaScreen place={london} onBack={() => {}} />)
    await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 0)) })
    flushFrame()
    const londonAngle = document.querySelector('.qibla-pointer')?.getAttribute('style')
    expect(londonAngle).not.toBe(kazaanAngle)
    expect(document.querySelectorAll('.qibla-pointer')).toHaveLength(1)
  })

  it('refreshes the local WMM validity date at UTC midnight without network access', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2029, 11, 31, 23, 59, 59, 500))
    render(<QiblaScreen place={place} onBack={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Включить компас' }))
    await act(async () => { await Promise.resolve() })
    dispatchHeading(0, 1000)
    flushFrame()
    expect(document.querySelector('.qibla-pointer')).toHaveAttribute('data-visible', 'true')

    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    dispatchHeading(0, 2000)
    expect(screen.getByRole('status')).toHaveTextContent(/Живой компас недоступен\. Показано расчётное направление/)
    expect(document.querySelector('.qibla-pointer')).not.toHaveAttribute('data-visible', 'true')
  })

  it('drops a live pointer while sensor lifecycle restarts after resume', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2029, 11, 31, 23, 59, 59, 500))
    render(<QiblaScreen place={place} onBack={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Включить компас' }))
    await act(async () => { await Promise.resolve() })
    dispatchHeading(0, 1000)
    flushFrame()
    expect(document.querySelector('.qibla-pointer')).toHaveAttribute('data-visible', 'true')
    act(() => { window.dispatchEvent(new Event('pageshow')) })
    expect(screen.getByRole('status')).toHaveTextContent(/Подключаем компас/)
    expect(document.querySelector('.qibla-pointer')).not.toHaveAttribute('data-visible', 'true')
  })

  it('keeps signed clockwise accessibility guidance without visible turn text', () => {
    const t = createTranslator('ru')
    expect(formatRelativeGuidance(27, t)).toContain('направо примерно на 25°')
    expect(formatRelativeGuidance(-27, t)).toContain('налево примерно на 25°')
    expect(formatRelativeGuidance(1, t)).toBe('Кибла прямо перед вами.')
    expect(formatRelativeGuidance(-180, t)).toBe('Кибла позади: повернитесь на 180° в любую сторону.')
  })
})
