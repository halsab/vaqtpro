import { flushSync } from 'react-dom'

interface NavigationViewTransition {
  finished: Promise<void>
  skipTransition: () => void
}

let activeTransition: NavigationViewTransition | null = null

export function canUseNavigationTransitions(): boolean {
  return typeof (document as Document & { startViewTransition?: unknown }).startViewTransition === 'function'
    && !(typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
}

export function runNavigationTransition(update: () => void): void {
  const startViewTransition = Reflect.get(document, 'startViewTransition') as
    ((callback: () => void) => NavigationViewTransition) | undefined
  if (!canUseNavigationTransitions() || !startViewTransition) {
    update()
    return
  }

  if (activeTransition) {
    const previous = activeTransition
    activeTransition = null
    previous.skipTransition()
    update()
    return
  }

  const commitState = { completed: false }
  try {
    const transition = Reflect.apply(startViewTransition, document, [() => {
      commitState.completed = true
      flushSync(update)
    }])
    activeTransition = transition
    void transition.finished.then(() => {
      if (activeTransition === transition) activeTransition = null
    }, () => {
      if (activeTransition === transition) activeTransition = null
    })
  } catch {
    if (!commitState.completed) update()
  }
}
