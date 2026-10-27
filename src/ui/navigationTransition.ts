import { flushSync } from 'react-dom'

const CONTENT_CLASS = 'screen-navigation-enter'
let animationGeneration = 0
let activeAnimationCleanup: (() => void) | null = null

export function canUseNavigationTransitions(): boolean {
  return !(typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
}

export function runNavigationTransition(update: () => void): void {
  const generation = ++animationGeneration
  activeAnimationCleanup?.()
  activeAnimationCleanup = null
  const previousContent = document.querySelector<HTMLElement>('.screen-content')
  previousContent?.classList.remove(CONTENT_CLASS)
  if (previousContent && typeof previousContent.getAnimations === 'function') {
    previousContent.getAnimations().forEach(animation => animation.cancel())
  }
  if (!canUseNavigationTransitions()) {
    update()
    return
  }

  flushSync(update)

  const content = document.querySelector<HTMLElement>('.screen-content')
  if (!content) return
  content.classList.remove(CONTENT_CLASS)
  const finish = () => {
    if (generation !== animationGeneration) return
    content.classList.remove(CONTENT_CLASS)
    activeAnimationCleanup?.()
    activeAnimationCleanup = null
  }
  const cleanup = () => {
    content.removeEventListener('animationend', finish)
    content.removeEventListener('animationcancel', finish)
  }
  content.addEventListener('animationend', finish, { once: true })
  content.addEventListener('animationcancel', finish, { once: true })
  activeAnimationCleanup = cleanup
  content.classList.add(CONTENT_CLASS)
}
