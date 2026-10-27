import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { DateScreen } from '../features/calendar/DateScreen'
import { DEFAULT_CALENDAR_PREFERENCES } from '../domain/calendar'
import { ReligiousEventsScreen } from '../features/religiousEvents/ReligiousEventsScreen'
import { useAppNavigation } from './useAppNavigation'

function NavigationExample() {
  const navigation = useAppNavigation()
  return <>
    <p>{navigation.screen}</p>
    {navigation.screen === 'home' ? <button id="open-settings" onClick={() => navigation.open('settings')}>Настройки</button> : null}
    {navigation.screen === 'settings' ? <button id="open-share" onClick={() => navigation.open('share')}>Поделиться</button> : null}
    {navigation.screen !== 'home' ? <><button onClick={navigation.back}>Назад</button><button onClick={navigation.home}>На главную</button></> : null}
  </>
}

function PreparedNavigationExample({ prepare, onFailure }: { prepare: () => Promise<void>; onFailure?: () => void }) {
  const navigation = useAppNavigation()
  if (navigation.screen === 'share') return <><p>share</p><button onClick={navigation.back}>Back</button></>
  return <>
    <p>{navigation.screen}</p>
    <button id="prepared-caller" onClick={() => { void navigation.openPrepared('share', prepare).catch(() => onFailure?.()) }}>Open when ready</button>
    <button id="other-focus">Other focus</button>
    <button onClick={() => navigation.open('settings')}>Settings</button>
  </>
}

function CalendarNavigationExample() {
  const navigation = useAppNavigation()
  const [date, setDate] = useState('2026-09-02')
  return navigation.screen === 'home'
    ? <button id="open-date" onClick={() => navigation.open('date')}>Выбрать дату</button>
    : <DateScreen selectedDate={date} today="2026-09-01" preferences={DEFAULT_CALENDAR_PREFERENCES} hijriSupported
        onDateChange={setDate} onPreferencesChange={() => {}} onOpenReligiousEvents={() => navigation.open('religious-events')} onBack={navigation.back} />
}

function ReligiousNavigationExample() {
  const navigation = useAppNavigation()
  return navigation.screen === 'home'
    ? <button id="religious-event-banner" onClick={() => navigation.open({ screen: 'religious-event', religiousEventId: 'arafa' })}>День Арафа</button>
    : <><p>{navigation.religiousEventId}</p><button onClick={navigation.back}>Назад</button></>
}

function NestedReligiousNavigationExample() {
  const navigation = useAppNavigation()
  if (navigation.screen === 'home') return <button id="open-date" onClick={() => navigation.open('date')}>Выбрать дату</button>
  if (navigation.screen === 'date') return <DateScreen selectedDate="2026-01-01" today="2026-01-01"
    preferences={DEFAULT_CALENDAR_PREFERENCES} hijriSupported onDateChange={() => {}} onPreferencesChange={() => {}}
    onOpenReligiousEvents={() => navigation.open('religious-events')} onBack={navigation.back} />
  if (navigation.screen === 'religious-events') return <ReligiousEventsScreen today="2026-01-01" correction={0} hijriSupported
    onOpenEvent={religiousEventId => navigation.open({ screen: 'religious-event', religiousEventId })} onBack={navigation.back} />
  return <><p>{navigation.religiousEventId}</p><button onClick={navigation.back}>Назад</button></>
}

function controlFrames() {
  const callbacks = new Map<number, FrameRequestCallback>()
  let id = 0
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callbacks.set(++id, callback); return id })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { callbacks.delete(id) })
  return () => act(() => {
    const pending = [...callbacks.values()]
    callbacks.clear()
    for (const callback of pending) callback(0)
  })
}

describe('навигация экранов', () => {
  it('отменяет подготовленную навигацию, если пользователь выбрал другой экран', async () => {
    let resolvePreparation: (() => void) | undefined
    const prepare = () => new Promise<void>(resolve => { resolvePreparation = resolve })
    render(<PreparedNavigationExample prepare={prepare} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open when ready' }))
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    await act(() => {
      resolvePreparation?.()
      return Promise.resolve()
    })
    expect(screen.getByText('settings')).toBeInTheDocument()
  })

  it('возвращает фокус к исходной кнопке после ожидания подготовки', async () => {
    let resolvePreparation: (() => void) | undefined
    const prepare = () => new Promise<void>(resolve => { resolvePreparation = resolve })
    render(<PreparedNavigationExample prepare={prepare} />)
    const caller = screen.getByRole('button', { name: 'Open when ready' })
    caller.focus()
    fireEvent.click(caller)
    screen.getByRole('button', { name: 'Other focus' }).focus()
    await act(() => {
      resolvePreparation?.()
      return Promise.resolve()
    })
    expect(screen.getByText('share')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(caller).toHaveFocus())
  })

  it('сохраняет вложенную цепочку DateScreen → список → статья и восстанавливает focus', async () => {
    const user = userEvent.setup()
    render(<NestedReligiousNavigationExample />)
    await user.click(screen.getByRole('button', { name: 'Выбрать дату' }))
    const listButton = screen.getByRole('button', { name: 'Праздники и события' })
    await user.click(listButton)
    const occurrence = screen.getByRole('button', { name: /Начало Рамадана/ })
    await user.click(occurrence)
    expect(screen.getByText('ramadan')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Назад' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Начало Рамадана/ })).toHaveFocus())
    await user.click(screen.getByRole('button', { name: 'Назад' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Праздники и события' })).toHaveFocus())

    act(() => { window.history.forward() })
    await waitFor(() => expect(screen.getByRole('region', { name: 'Праздники и события' })).toBeVisible())
    act(() => { window.history.forward() })
    await waitFor(() => expect(screen.getByText('ramadan')).toBeVisible())
  })

  it('сохраняет snapshot статьи при Browser Back/Forward и возвращает фокус баннеру', async () => {
    const user = userEvent.setup()
    render(<ReligiousNavigationExample />)
    await user.click(screen.getByRole('button', { name: 'День Арафа' }))
    expect(screen.getByText('arafa')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Назад' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'День Арафа' })).toHaveFocus())
    act(() => { window.history.forward() })
    await waitFor(() => expect(screen.getByText('arafa')).toBeVisible())
  })

  it.each(['Сегодня', 'Месяц'])('отложенный автофокус не перехватывает фокус после действия «%s»', action => {
    const paint = controlFrames()
    render(<CalendarNavigationExample />)
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать дату' }))
    if (action === 'Сегодня') fireEvent.click(screen.getByRole('button', { name: action }))
    else screen.getByRole('combobox', { name: action }).focus()
    const field = screen.getByRole('combobox', { name: action === 'Сегодня' ? 'День' : 'Месяц' })
    expect(field).toHaveFocus()
    paint()
    expect(field).toHaveFocus()
  })

  it('фокусирует Назад после открытия экрана, если пользователь ещё не выбрал поле', () => {
    const paint = controlFrames()
    render(<CalendarNavigationExample />)
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать дату' }))
    paint()
    expect(screen.getByRole('button', { name: 'Назад' })).toHaveFocus()
  })

  it('возвращается по шагам и восстанавливает фокус у вызвавшей кнопки', async () => {
    const user = userEvent.setup()
    render(<NavigationExample />)
    await user.click(screen.getByRole('button', { name: 'Настройки' }))
    await user.click(screen.getByRole('button', { name: 'Поделиться' }))
    await user.click(screen.getByRole('button', { name: 'Назад' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Поделиться' })).toHaveFocus())
    act(() => { window.history.back() })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Настройки' })).toHaveFocus())
  })

  it('разблокирует внутреннюю навигацию, если history traversal не выпускает popstate', () => {
    vi.useFakeTimers()
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    try {
      render(<NavigationExample />)
      fireEvent.click(screen.getByRole('button', { name: 'Настройки' }))
      fireEvent.click(screen.getByRole('button', { name: 'Назад' }))
      act(() => { vi.advanceTimersByTime(1_000) })
      fireEvent.click(screen.getByRole('button', { name: 'Назад' }))
      expect(back).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
      back.mockRestore()
    }
  })

  it('keeps a newer screen when a timed-out history traversal delivers popstate late', () => {
    vi.useFakeTimers()
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    const forward = vi.spyOn(window.history, 'forward').mockImplementation(() => {})
    try {
      render(<NavigationExample />)
      fireEvent.click(screen.getByRole('button', { name: 'Настройки' }))
      fireEvent.click(screen.getByRole('button', { name: 'Назад' }))
      act(() => { vi.advanceTimersByTime(1_000) })
      fireEvent.click(screen.getByRole('button', { name: 'Поделиться' }))
      expect(screen.getByText('share')).toBeInTheDocument()

      act(() => { window.dispatchEvent(new PopStateEvent('popstate', { state: null })) })

      expect(screen.getByText('share')).toBeInTheDocument()
      expect(forward).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
      back.mockRestore()
      forward.mockRestore()
    }
  })

  it('завершает вложенный сценарий возвращением на главную', async () => {
    const user = userEvent.setup()
    render(<NavigationExample />)
    await user.click(screen.getByRole('button', { name: 'Настройки' }))
    await user.click(screen.getByRole('button', { name: 'Поделиться' }))
    await user.click(screen.getByRole('button', { name: 'На главную' }))
    await waitFor(() => expect(screen.getByText('home')).toBeInTheDocument())
  })
})


it('does not surface a late preparation failure after navigation to another screen', async () => {
  let rejectPreparation: ((reason: Error) => void) | undefined
  const onFailure = vi.fn()
  render(<PreparedNavigationExample prepare={() => new Promise((_resolve, reject) => { rejectPreparation = reject })} onFailure={onFailure} />)
  fireEvent.click(screen.getByRole('button', { name: 'Open when ready' }))
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  await act(async () => { rejectPreparation?.(new Error('chunk unavailable')); await Promise.resolve() })
  expect(onFailure).not.toHaveBeenCalled()
  expect(screen.getByText('settings')).toBeVisible()
})
