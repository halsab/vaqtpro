import { StrictMode, Profiler, act } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createCityPlace } from '../../domain/place'
import type { City } from '../../domain/cities'
import { createTranslator } from '../../localization/messages'
import { QiblaScreen } from './QiblaScreen'
import { formatRelativeGuidance } from './relativeGuidance'

const place = createCityPlace({
  id: 551487, name: 'Казань', countryCode: 'RU', admin1Code: '73', admin1Name: 'Татарстан',
  latitude: 55.7946, longitude: 49.1115, population: 1_308_660, timeZone: 'Europe/Moscow',
} satisfies City, Date.UTC(2026, 0, 1))

describe('QiblaScreen orientation presentation', () => {
  let frameId: number
  let frames: Map<number, FrameRequestCallback>
  let requestFrame: ReturnType<typeof vi.fn>
  let cancelFrame: ReturnType<typeof vi.fn>
  let requestPermission: ReturnType<typeof vi.fn>

  beforeEach(() => {
    frameId = 0
    frames = new Map()
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
    Object.defineProperty(window, 'orientation', { configurable: true, writable: true, value: 0 })
    Object.defineProperty(window, 'screen', { configurable: true, value: {} })
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
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
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('uses signed clockwise guidance for right, left, ahead and behind', () => {
    const t = createTranslator('ru')
    expect(formatRelativeGuidance(27, t)).toContain('направо примерно на 25°')
    expect(formatRelativeGuidance(-27, t)).toContain('налево примерно на 25°')
    expect(formatRelativeGuidance(1, t)).toBe('Кибла прямо перед вами.')
    expect(formatRelativeGuidance(-180, t)).toBe('Кибла позади: повернитесь на 180° в любую сторону.')
  })

  it('survives StrictMode effect reinitialization, coalesces dial writes and exposes throttled left/right guidance', async () => {
    const user = userEvent.setup()
    let commits = 0
    const onRender = () => { commits += 1 }
    const view = render(<StrictMode><Profiler id="qibla" onRender={onRender}>
      <QiblaScreen place={place} onBack={() => {}} onOpenLocation={() => {}} />
    </Profiler></StrictMode>)
    await user.click(screen.getByRole('button', { name: 'Включить компас' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/доступ к датчику компаса/))
    expect(requestPermission).toHaveBeenCalledOnce()

    const sensorEvent = (heading: number) => Object.assign(new Event('deviceorientation'), {
      alpha: 0, beta: 0, gamma: 0, absolute: false,
      webkitCompassHeading: heading, webkitCompassAccuracy: 6,
    })
    act(() => { window.dispatchEvent(sensorEvent(359)) })
    expect(screen.getByText(/(Поверните телефон (налево|направо) примерно на \d+° к кибле\.|Кибла позади: повернитесь на 180° в любую сторону\.)/)).toHaveAttribute('aria-live', 'polite')
    const firstFrame = [...frames.entries()][0]
    expect(firstFrame).toBeDefined()
    if (!firstFrame) throw new Error('Expected a scheduled dial frame')
    frames.delete(firstFrame[0])
    act(() => { firstFrame[1](performance.now()) })
    expect(document.querySelector('.qibla-dial')?.getAttribute('style')).toMatch(/transform:\s*rotate\(-?\d+(\.\d+)?deg\)/)

    const commitsBeforeBurst = commits
    const requestCountBeforeBurst = requestFrame.mock.calls.length
    const timeoutSpy = vi.spyOn(window, 'setTimeout')
    act(() => {
      for (let index = 0; index < 100; index += 1) window.dispatchEvent(sensorEvent(index % 2 ? 1 : 359))
    })
    expect(requestFrame.mock.calls.length - requestCountBeforeBurst).toBe(1)
    expect(commits - commitsBeforeBurst).toBeLessThanOrEqual(1)
    expect(timeoutSpy).toHaveBeenCalledOnce()

    const staleFrame = [...frames.entries()][0]
    expect(staleFrame).toBeDefined()
    view.unmount()
    if (!staleFrame) throw new Error('Expected a pending frame before unmount')
    expect(cancelFrame).toHaveBeenCalledWith(staleFrame[0])
    const oldDial = document.querySelector('.qibla-dial')
    act(() => { staleFrame[1](performance.now()) })
    expect(oldDial).toBeNull()
  })

  it('withholds live relative guidance for an uncalibrated compass and recovers on a valid sample', async () => {
    const user = userEvent.setup()
    render(<QiblaScreen place={place} onBack={() => {}} onOpenLocation={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Включить компас' }))
    await waitFor(() => expect(requestPermission).toHaveBeenCalledOnce())
    act(() => {
      window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
        alpha: 0, beta: 0, gamma: 0, absolute: false,
        webkitCompassHeading: 359, webkitCompassAccuracy: -1,
      }))
    })
    expect(screen.getByRole('status')).toHaveTextContent(/Компас не откалиброван/)
    expect(document.querySelector('.qibla-relative-guidance')).toBeEmptyDOMElement()

    act(() => {
      window.dispatchEvent(Object.assign(new Event('deviceorientation'), {
        alpha: 0, beta: 0, gamma: 0, absolute: false,
        webkitCompassHeading: 359, webkitCompassAccuracy: 8,
      }))
    })
    expect(await screen.findByRole('status')).toHaveTextContent(/Живое направление доступно/)
    expect(document.querySelector('.qibla-relative-guidance')).not.toBeEmptyDOMElement()
    expect(screen.getByText(/±8.0°/)).toBeVisible()
  })
})
