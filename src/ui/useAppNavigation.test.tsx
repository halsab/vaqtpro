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
    {navigation.screen === 'share' ? <button id="reopen-settings" onClick={() => navigation.open('settings')}>Повторно открыть настройки</button> : null}
    {navigation.screen !== 'home' ? <><button onClick={navigation.back}>Назад</button><button onClick={navigation.home}>На главную</button></> : null}
  </>
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

function FastingNavigationExample() {
  const navigation = useAppNavigation()
  const [homeValue, setHomeValue] = useState(0)
  if (navigation.screen === 'home') return <>
    <p>home value: {homeValue}</p>
    <button onClick={() => setHomeValue(value => value + 1)}>Change Home</button>
    <button id="fasting-card" onClick={() => navigation.open('fasting')}>Пост</button>
  </>
  if (navigation.screen === 'fasting') return <>
    <button id="fasting-dua-suhur" onClick={() => navigation.open({ screen: 'fasting-dua', fastingDuaId: 'suhur' })}>Дуа сухура</button>
    <button onClick={navigation.back}>Назад</button>
  </>
  return <><p>{navigation.fastingDuaId}</p><button onClick={navigation.back}>Назад</button></>
}


describe('навигация экранов', () => {
  it('проходит Home → Пост → дуа и возвращает исходное состояние Home', async () => {
    const user = userEvent.setup()
    render(<FastingNavigationExample />)
    await user.click(screen.getByRole('button', { name: 'Change Home' }))
    const card = screen.getByRole('button', { name: 'Пост' })
    await user.click(card)
    await user.click(screen.getByRole('button', { name: 'Дуа сухура' }))
    expect(screen.getByText('suhur')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Назад' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Дуа сухура' })).toHaveFocus())
    await user.click(screen.getByRole('button', { name: 'Назад' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Пост' })).toHaveFocus())
    expect(screen.getByText('home value: 1')).toBeVisible()
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

      expect(screen.getByText('home')).toBeInTheDocument()
      expect(forward).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      back.mockRestore()
      forward.mockRestore()
    }
  })


})


