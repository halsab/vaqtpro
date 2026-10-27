import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { isReligiousEventId, type ReligiousEventId } from '../domain/religiousEvents'
import { runNavigationTransition } from './navigationTransition'

const SCREENS = ['home', 'date', 'location', 'search', 'settings', 'source', 'source-choice', 'profiles', 'parameters', 'source-info', 'methodology', 'privacy', 'reset', 'about', 'share', 'religious-events', 'religious-event'] as const
export type AppScreen = typeof SCREENS[number]
interface Entry { screen: AppScreen; returnFocus: string | null; religiousEventId?: ReligiousEventId; scrollTop?: number }
type NavigationTarget = AppScreen | { screen: 'religious-event'; religiousEventId: ReligiousEventId }
const HOME: Entry[] = [{ screen: 'home', returnFocus: null }]

function readEntries(value: unknown, session: string): Entry[] | null {
  if (!value || typeof value !== 'object' || !('salahNavigation' in value)) return null
  const state = value.salahNavigation
  if (!state || typeof state !== 'object' || !('session' in state) || state.session !== session || !('entries' in state) || !Array.isArray(state.entries)) return null
  const entries: unknown[] = state.entries
  const valid = (entry: unknown): entry is Entry => Boolean(entry && typeof entry === 'object'
    && 'screen' in entry && SCREENS.some(screen => screen === entry.screen)
    && 'returnFocus' in entry && (entry.returnFocus === null || typeof entry.returnFocus === 'string')
    && (!('scrollTop' in entry) || typeof entry.scrollTop === 'number')
    && (entry.screen !== 'religious-event' || ('religiousEventId' in entry && isReligiousEventId(entry.religiousEventId))))
  return entries.length > 0 && entries.every(valid) ? entries : null
}

export function useAppNavigation() {
  const [session] = useState(() => String(Math.random()))
  const [entries, setEntries] = useState<Entry[]>(HOME)
  const current = useRef(HOME)
  const returnFocus = useRef<string | null>(null)
  const traversing = useRef(false)
  const traversalTimer = useRef<number | null>(null)
  const intentGeneration = useRef(0)

  useEffect(() => {
    const previousScrollRestoration = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    window.history.replaceState({ salahNavigation: { session, entries: HOME } }, '')
    const onPop = (event: PopStateEvent) => {
      if (traversalTimer.current !== null) window.clearTimeout(traversalTimer.current)
      traversalTimer.current = null
      const next = readEntries(event.state, session) ?? HOME
      intentGeneration.current += 1
      if (next.length < current.current.length) returnFocus.current = current.current[next.length]?.returnFocus ?? null
      traversing.current = false
      runNavigationTransition(() => {
        current.current = next
        setEntries(next)
      })
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      if (traversalTimer.current !== null) window.clearTimeout(traversalTimer.current)
      window.history.scrollRestoration = previousScrollRestoration
    }
  }, [session])

  useEffect(() => {
    const target = returnFocus.current
    const initialFocus = document.activeElement
    const frame = requestAnimationFrame(() => {
      const element = target ? document.getElementById(target) : document.querySelector<HTMLElement>('input[data-screen-focus]') ?? document.querySelector<HTMLElement>('[data-screen-focus]')
      const active = document.activeElement
      // Старая кнопка может остаться в DOM; фокус, изменённый после перехода, сохраняем.
      if (active === initialFocus || !active || active === document.body || active === document.documentElement) element?.focus({ preventScroll: true })
      returnFocus.current = null
    })
    return () => { cancelAnimationFrame(frame) }
  }, [entries])

  useLayoutEffect(() => {
    const entry = entries.at(-1)
    if (entry?.scrollTop === undefined) return
    const content = document.querySelector<HTMLElement>('.screen-content')
    if (content) content.scrollTop = entry.scrollTop
  }, [entries])

  const open = useCallback((target: NavigationTarget, returnFocusOverride?: string | null) => {
    intentGeneration.current += 1
    const screen = typeof target === 'string' ? target : target.screen
    if (traversing.current || current.current.at(-1)?.screen === screen) return
    const trigger = returnFocusOverride === undefined
      ? document.activeElement instanceof HTMLElement ? document.activeElement.id || null : null
      : returnFocusOverride
    const content = document.querySelector<HTMLElement>('.screen-content')
    const parent = current.current.at(-1) ?? HOME[0]
    if (!parent) return
    const currentEntries: Entry[] = [...current.current.slice(0, -1), {
      ...parent,
      ...(content ? { scrollTop: content.scrollTop } : {}),
    }]
    const next: Entry[] = [...currentEntries, {
      screen,
      returnFocus: trigger,
      ...(typeof target === 'string' ? {} : { religiousEventId: target.religiousEventId }),
    }]
    runNavigationTransition(() => {
      window.history.replaceState({ salahNavigation: { session, entries: currentEntries } }, '')
      window.history.pushState({ salahNavigation: { session, entries: next } }, '')
      current.current = next
      setEntries(next)
    })
  }, [session])
  const openPrepared = useCallback(async (target: NavigationTarget, prepare: () => Promise<void>) => {
    const generation = ++intentGeneration.current
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement.id || null : null
    try { await prepare() }
    catch (error) {
      if (intentGeneration.current !== generation) return
      throw error
    }
    if (intentGeneration.current !== generation) return
    open(target, returnFocus)
  }, [open])
  const back = useCallback(() => {
    if (traversing.current || current.current.length <= 1) return
    intentGeneration.current += 1
    returnFocus.current = current.current.at(-1)?.returnFocus ?? null
    traversing.current = true
    const traversal = intentGeneration.current
    window.history.back()
    traversalTimer.current = window.setTimeout(() => {
      // Если браузер не выпустил popstate, оставляем текущий экран рабочим.
      if (intentGeneration.current !== traversal) return
      traversing.current = false
      returnFocus.current = null
      traversalTimer.current = null
    }, 1_000)
  }, [])
  const home = useCallback(() => {
    const depth = current.current.length - 1
    if (traversing.current || depth <= 0) return
    intentGeneration.current += 1
    returnFocus.current = current.current[1]?.returnFocus ?? null
    traversing.current = true
    const traversal = intentGeneration.current
    window.history.go(-depth)
    traversalTimer.current = window.setTimeout(() => {
      if (intentGeneration.current !== traversal) return
      traversing.current = false
      returnFocus.current = null
      traversalTimer.current = null
    }, 1_000)
  }, [])

  const active = entries.at(-1) ?? { screen: 'home', returnFocus: null }
  return { screen: active.screen, religiousEventId: active.screen === 'religious-event' ? active.religiousEventId ?? null : null,
    open, openPrepared, back, home }
}
