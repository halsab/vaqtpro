import { afterEach, describe, expect, it, vi } from 'vitest'
import { runNavigationTransition } from './navigationTransition'

describe('navigation transitions', () => {
  afterEach(() => {
    document.body.replaceChildren()
    Reflect.deleteProperty(Element.prototype, 'animate')
    vi.restoreAllMocks()
  })

  it('updates navigation immediately without starting a document-wide transition', () => {
    const content = document.createElement('div')
    content.className = 'screen-content'
    document.body.append(content)
    const startViewTransition = vi.fn()
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: startViewTransition })
    const update = vi.fn()

    runNavigationTransition(update)

    expect(update).toHaveBeenCalledOnce()
    expect(startViewTransition).not.toHaveBeenCalled()
  })

  it('cancels only the previous content animation during rapid navigation', () => {
    const content = document.createElement('div')
    content.className = 'screen-content'
    document.body.append(content)
    const animations: Array<{ cancel: ReturnType<typeof vi.fn>; finished: Promise<void> }> = []
    Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: () => undefined })
    Object.defineProperty(content, 'animate', { configurable: true, value: () => {
      const animation = { cancel: vi.fn(), finished: new Promise<void>(() => {}) }
      animations.push(animation)
      return animation as unknown as Animation
    } })
    const update = vi.fn()

    runNavigationTransition(update)
    runNavigationTransition(update)

    expect(update).toHaveBeenCalledTimes(2)
    expect(animations).toHaveLength(2)
    expect(animations[0]?.cancel).toHaveBeenCalledOnce()
    expect(animations[1]?.cancel).not.toHaveBeenCalled()
  })
})
