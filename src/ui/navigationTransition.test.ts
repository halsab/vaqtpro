import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { createElement, useState } from 'react'
import { runNavigationTransition } from './navigationTransition'

interface MockViewTransition {
  finished: Promise<void>
  skipTransition: ReturnType<typeof vi.fn>
}

function mockTransition(update: () => void): MockViewTransition {
  update()
  return { finished: Promise.resolve(), skipTransition: vi.fn() }
}

describe('navigation transitions', () => {
  afterEach(async () => {
    document.body.replaceChildren()
    Reflect.deleteProperty(document, 'startViewTransition')
    Reflect.deleteProperty(window, 'matchMedia')
    await Promise.resolve()
    vi.restoreAllMocks()
  })

  it('commits the destination inside a native view transition', async () => {
    const startViewTransition = vi.fn(mockTransition)
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: startViewTransition })
    function Example() {
      const [screenName, setScreenName] = useState('home')
      return createElement('div', { className: 'screen-content', 'data-screen': screenName },
        createElement('span', null, screenName),
        createElement('button', { onClick: () => runNavigationTransition(() => setScreenName('settings')) }, 'Open'))
    }
    render(createElement(Example))

    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Open' })) })

    expect(startViewTransition).toHaveBeenCalledOnce()
    expect(screen.getByText('settings')).toBeInTheDocument()
    await Promise.resolve()
  })

  it('skips an active transition and ignores its stale callback on rapid navigation', () => {
    const callbacks: Array<() => void> = []
    const skipTransition = vi.fn()
    const startViewTransition = vi.fn((update: () => void) => {
      callbacks.push(update)
      return { finished: new Promise<void>(() => {}), skipTransition }
    })
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: startViewTransition })
    const firstUpdate = vi.fn()
    const latestUpdate = vi.fn()

    runNavigationTransition(firstUpdate)
    runNavigationTransition(latestUpdate)
    callbacks[0]?.()

    expect(startViewTransition).toHaveBeenCalledOnce()
    expect(skipTransition).toHaveBeenCalledOnce()
    expect(firstUpdate).not.toHaveBeenCalled()
    expect(latestUpdate).toHaveBeenCalledOnce()
  })

  it('keeps navigation working if an active transition cannot be skipped', () => {
    const startViewTransition = vi.fn(() => ({
      finished: new Promise<void>(() => {}),
      skipTransition: () => { throw new Error('transition already finished') },
    }))
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: startViewTransition })
    const firstUpdate = vi.fn()
    const latestUpdate = vi.fn()

    runNavigationTransition(firstUpdate)
    expect(() => runNavigationTransition(latestUpdate)).not.toThrow()

    expect(latestUpdate).toHaveBeenCalledOnce()
  })

  it('commits immediately and skips an active transition for reduced motion', () => {
    const callbacks: Array<() => void> = []
    const skipTransition = vi.fn()
    let reducedMotion = false
    const startViewTransition = vi.fn((update: () => void) => {
      callbacks.push(update)
      return { finished: new Promise<void>(() => {}), skipTransition }
    })
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: startViewTransition })
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: reducedMotion }) })
    const firstUpdate = vi.fn()
    const reducedMotionUpdate = vi.fn()

    runNavigationTransition(firstUpdate)
    reducedMotion = true
    runNavigationTransition(reducedMotionUpdate)
    callbacks[0]?.()

    expect(skipTransition).toHaveBeenCalledOnce()
    expect(firstUpdate).not.toHaveBeenCalled()
    expect(reducedMotionUpdate).toHaveBeenCalledOnce()
  })

  it('updates immediately when the native transition API is unavailable', () => {
    document.body.innerHTML = '<div class="screen-content"></div>'
    const update = vi.fn()

    runNavigationTransition(update)

    expect(update).toHaveBeenCalledOnce()
  })

  it('commits immediately if starting a native transition throws', () => {
    const startViewTransition = vi.fn(() => { throw new Error('transition unavailable') })
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: startViewTransition })
    const update = vi.fn()

    runNavigationTransition(update)

    expect(startViewTransition).toHaveBeenCalledOnce()
    expect(update).toHaveBeenCalledOnce()
  })

  it('leaves new controls interactive while the native crossfade runs', () => {
    const startViewTransition = vi.fn(mockTransition)
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: startViewTransition })
    function Example() {
      const [screenName, setScreenName] = useState('home')
      const [count, setCount] = useState(0)
      return createElement('div', { className: 'screen-content', 'data-screen': screenName },
        createElement('span', null, screenName),
        createElement('button', { onClick: () => runNavigationTransition(() => setScreenName('settings')) }, 'Open'),
        createElement('button', { onClick: () => setCount(value => value + 1) }, `Tap ${count}`))
    }
    render(createElement(Example))

    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    fireEvent.click(screen.getByRole('button', { name: 'Tap 0' }))

    expect(screen.getByText('settings')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tap 1' })).toBeInTheDocument()
  })

  it('commits immediately when reduced motion is requested', () => {
    const startViewTransition = vi.fn(mockTransition)
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: startViewTransition })
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) })
    const update = vi.fn()

    runNavigationTransition(update)

    expect(startViewTransition).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledOnce()
  })
})
