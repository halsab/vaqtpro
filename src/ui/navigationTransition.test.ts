import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { createElement, useState } from 'react'
import { runNavigationTransition } from './navigationTransition'

describe('navigation transitions', () => {
  afterEach(() => {
    document.body.replaceChildren()
    Reflect.deleteProperty(document, 'startViewTransition')
    vi.restoreAllMocks()
  })

  it('commits the destination immediately and animates only its content', () => {
    const startViewTransition = vi.fn()
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: startViewTransition })
    function Example() {
      const [screenName, setScreenName] = useState('home')
      return createElement('div', { className: 'screen-content', 'data-screen': screenName },
        createElement('span', null, screenName),
        createElement('button', { onClick: () => runNavigationTransition(() => setScreenName('settings')) }, 'Open'))
    }
    render(createElement(Example))

    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Open' })) })

    expect(startViewTransition).not.toHaveBeenCalled()
    expect(screen.getByText('settings')).toBeInTheDocument()
    expect(document.querySelector('.screen-content')).toHaveClass('screen-navigation-enter')
  })

  it('commits rapid navigation updates in order without deferred callbacks', () => {
    const startViewTransition = vi.fn(() => { throw new Error('must not be used') })
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: startViewTransition })
    document.body.innerHTML = '<div class="screen-content"></div>'
    const firstUpdate = vi.fn()
    const secondUpdate = vi.fn()

    runNavigationTransition(firstUpdate)
    runNavigationTransition(secondUpdate)

    expect(startViewTransition).not.toHaveBeenCalled()
    expect(firstUpdate).toHaveBeenCalledOnce()
    expect(secondUpdate).toHaveBeenCalledOnce()
    expect(document.querySelector('.screen-content')).toHaveClass('screen-navigation-enter')
  })

  it('cannot be overwritten by a delayed native callback or a skipped transition', () => {
    let delayedUpdate: (() => void) | undefined
    const skipTransition = vi.fn()
    const startViewTransition = vi.fn((callback: () => void) => {
      delayedUpdate = callback
      return { finished: Promise.resolve(), skipTransition }
    })
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: startViewTransition })
    function Example() {
      const [screenName, setScreenName] = useState('home')
      return createElement('div', { className: 'screen-content' },
        createElement('span', null, screenName),
        createElement('button', { onClick: () => runNavigationTransition(() => setScreenName('settings')) }, 'Settings'),
        createElement('button', { onClick: () => runNavigationTransition(() => setScreenName('share')) }, 'Share'))
    }
    render(createElement(Example))

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    delayedUpdate?.()

    expect(startViewTransition).not.toHaveBeenCalled()
    expect(skipTransition).not.toHaveBeenCalled()
    expect(delayedUpdate).toBeUndefined()
    expect(screen.getByText('share')).toBeInTheDocument()
    expect(screen.queryByText('settings')).not.toBeInTheDocument()
  })

  it('ignores an animation-end callback from a superseded content animation', () => {
    let firstAnimationEnd: EventListener | undefined
    function Example() {
      const [screenName, setScreenName] = useState('home')
      return createElement('div', { className: 'screen-content' },
        createElement('span', null, screenName),
        createElement('button', { onClick: () => runNavigationTransition(() => setScreenName('settings')) }, 'Settings'),
        createElement('button', { onClick: () => runNavigationTransition(() => setScreenName('share')) }, 'Share'))
    }
    render(createElement(Example))
    const content = document.querySelector<HTMLElement>('.screen-content')
    if (!content) throw new Error('Expected screen content')
    const addEventListener = content.addEventListener.bind(content)
    vi.spyOn(content, 'addEventListener').mockImplementation((type, listener, options) => {
      if (type === 'animationend' && !firstAnimationEnd && typeof listener === 'function') firstAnimationEnd = listener
      return addEventListener(type, listener, options)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    firstAnimationEnd?.call(content, new Event('animationend'))

    expect(screen.getByText('share')).toBeInTheDocument()
    expect(content).toHaveClass('screen-navigation-enter')
  })

  it('leaves controls interactive while the content animation is active', () => {
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
    expect(document.querySelector('.screen-content')).toHaveClass('screen-navigation-enter')
  })

  it('updates immediately when reduced motion is requested', () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) })
    document.body.innerHTML = '<div class="screen-content"></div>'
    const update = vi.fn()

    runNavigationTransition(update)

    expect(update).toHaveBeenCalledOnce()
    expect(document.querySelector('.screen-content')).not.toHaveClass('screen-navigation-enter')
  })

  it('does not depend on a working browser transition API', () => {
    const startViewTransition = vi.fn(() => { throw new Error('transition failed') })
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: startViewTransition })
    document.body.innerHTML = '<div class="screen-content"></div>'
    const update = vi.fn()

    runNavigationTransition(update)

    expect(startViewTransition).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledOnce()
  })
})
