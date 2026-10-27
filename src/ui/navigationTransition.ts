import { flushSync } from 'react-dom'

let animationGeneration = 0
let activeTransition: ViewTransition | null = null

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function skipActiveTransition(): void {
  const transition = activeTransition
  activeTransition = null
  try {
    transition?.skipTransition()
  } catch {
    // Завершившаяся анимация не должна блокировать следующую навигацию.
  }
}

export function runNavigationTransition(update: () => void): void {
  const generation = ++animationGeneration
  const startViewTransition = Reflect.get(document, 'startViewTransition') as
    | ((this: Document, update: () => void) => ViewTransition)
    | undefined

  if (prefersReducedMotion() || !startViewTransition) {
    skipActiveTransition()
    flushSync(update)
    return
  }

  if (activeTransition) {
    skipActiveTransition()
    flushSync(update)
    return
  }

  try {
    const transition = startViewTransition.call(document, () => {
      if (generation === animationGeneration) flushSync(update)
    })
    activeTransition = transition
    void transition.finished.then(
      () => { if (activeTransition === transition) activeTransition = null },
      () => { if (activeTransition === transition) activeTransition = null },
    )
  } catch {
    if (generation === animationGeneration) flushSync(update)
  }
}
