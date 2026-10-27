import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { createElement, useState } from 'react'
import { runNavigationTransition } from './navigationTransition'

function transition() {
  let finish!: () => void
  const finished = new Promise<void>(resolve => { finish = resolve })
  return { finished, finish, skipTransition: vi.fn() }
}

describe('navigation transitions', () => {
  afterEach(() => {
    document.body.replaceChildren()
    Reflect.deleteProperty(document, 'startViewTransition')
    vi.restoreAllMocks()
  })

  it('commits destination DOM before the native transition captures it', () => {
    const viewTransition = transition()
    let contentDuringCapture = ''
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: (callback: () => void) => {
      callback()
      contentDuringCapture = document.querySelector('.screen-content')?.textContent ?? ''
      return viewTransition
    } })
    function Example() {
      const [screen, setScreen] = useState('home')
      return createElement('div', { className: 'screen-content', 'data-screen': screen },
        createElement('span', null, screen),
        createElement('button', { onClick: () => runNavigationTransition(() => setScreen('settings')) }, 'Open'))
    }
    render(createElement(Example))

    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Open' })) })

    expect(contentDuringCapture).toBe('settingsOpen')
    expect(screen.getByText('settings')).toBeInTheDocument()
    viewTransition.finish()
  })

  it('skips an active fade and commits rapid navigation immediately', () => {
    const viewTransition = transition()
    const startViewTransition = vi.fn((callback: () => void) => {
      callback()
      return viewTransition
    })
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: startViewTransition })
    const firstUpdate = vi.fn()
    const secondUpdate = vi.fn()

    runNavigationTransition(firstUpdate)
    runNavigationTransition(secondUpdate)

    expect(startViewTransition).toHaveBeenCalledOnce()
    expect(viewTransition.skipTransition).toHaveBeenCalledOnce()
    expect(firstUpdate).toHaveBeenCalledOnce()
    expect(secondUpdate).toHaveBeenCalledOnce()
    viewTransition.finish()
  })

  it('updates immediately when reduced motion is requested', () => {
    const startViewTransition = vi.fn()
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: startViewTransition })
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) })
    const update = vi.fn()

    runNavigationTransition(update)

    expect(update).toHaveBeenCalledOnce()
    expect(startViewTransition).not.toHaveBeenCalled()
  })

  it('falls back to an immediate update if transition setup throws', () => {
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: () => { throw new Error('unsupported') } })
    const update = vi.fn()

    runNavigationTransition(update)

    expect(update).toHaveBeenCalledOnce()
  })
})
