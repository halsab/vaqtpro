import { act } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'

import { createCityPlace } from '../../domain/place'
import type { City } from '../../domain/cities'
import { QiblaScreen } from './QiblaScreen'
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
    window.history.replaceState({}, '', '/')
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
    expect(screen.getByRole('note', { name: 'Оценка точности компаса: Неизвестна.' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /место|локация|город/i })).toBeNull()
    expect(screen.queryByText(/Живое направление доступно/)).toBeNull()
    expect(document.querySelector('.qibla-cardinal')).toBeInTheDocument()
  })



  it('shows a non-retryable unsupported state when no orientation API exists', async () => {
    vi.stubGlobal('DeviceOrientationEvent', undefined)
    render(<QiblaScreen place={place} onBack={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Включить компас' }))
    await act(async () => { await Promise.resolve() })

    expect(screen.getByRole('status')).toHaveTextContent(/Живой компас недоступен/)
    expect(screen.queryByRole('button', { name: 'Попробовать снова' })).toBeNull()
    expect(document.querySelector('.qibla-pointer')).not.toHaveAttribute('data-visible', 'true')
  })

  it('offers retry after a recoverable startup timeout and rechecks permission on the next tap', async () => {
    vi.useFakeTimers()
    render(<QiblaScreen place={place} onBack={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Включить компас' }))
    await act(async () => { await Promise.resolve() })
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })

    expect(screen.getByRole('status')).toHaveTextContent(/не ответил|недоступен/i)
    const retry = screen.getByRole('button', { name: 'Попробовать снова' })
    expect(retry).toBeVisible()
    fireEvent.click(retry)
    await act(async () => { await Promise.resolve() })
    expect(requestPermission).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('status')).toHaveTextContent(/Подключаем компас/)
  })



  it('updates the visible category from sensor accuracy and hides the live pointer above 60 degrees', async () => {
    render(<QiblaScreen place={place} onBack={() => {}} />)
    await activateCompass()
    dispatchHeading(0, 1000, { accuracy: 5 })
    expect(screen.getByText('Точность: Отличная', { selector: '.qibla-accuracy' })).toBeVisible()
    dispatchHeading(0, 1016, { accuracy: 5.001 })
    expect(screen.getByText('Точность: Хорошая', { selector: '.qibla-accuracy' })).toBeVisible()
    dispatchHeading(0, 1032, { accuracy: 10.001 })
    expect(screen.getByText('Точность: Средняя', { selector: '.qibla-accuracy' })).toBeVisible()
    dispatchHeading(0, 1048, { accuracy: 20.001 })
    expect(screen.getByText('Точность: Низкая', { selector: '.qibla-accuracy' })).toBeVisible()
    dispatchHeading(0, 1064, { accuracy: 40.001 })
    expect(screen.getByText('Точность: Очень низкая', { selector: '.qibla-accuracy' })).toBeVisible()
    expect(document.querySelector('.qibla-pointer')).toHaveAttribute('data-visible', 'true')

    dispatchHeading(0, 1080, { accuracy: 60.001 })
    expect(screen.getByText('Точность: Недоступна', { selector: '.qibla-accuracy' })).toBeVisible()
    expect(document.querySelector('.qibla-pointer')).not.toHaveAttribute('data-visible', 'true')
    dispatchHeading(0, 1096, { accuracy: 60 })
    expect(screen.getByText('Точность: Очень низкая', { selector: '.qibla-accuracy' })).toBeVisible()
    expect(document.querySelector('.qibla-pointer')).toHaveAttribute('data-visible', 'true')
    expect(document.querySelector('.qibla-accuracy')).not.toHaveTextContent(/\d|°/)
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



})
