export function canUseNavigationTransitions(): boolean {
  return typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function'
    && !(typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
}

const animations = new WeakMap<Element, Animation>()

export function runNavigationTransition(update: () => void): void {
  update()
  if (!canUseNavigationTransitions()) return
  const content = document.querySelector('.screen-content')
  if (!content) return
  animations.get(content)?.cancel()
  try {
    const animation = content.animate(
      [{ opacity: 0.72 }, { opacity: 1 }],
      { duration: 140, easing: 'ease-out' },
    )
    animations.set(content, animation)
    void animation.finished.catch(() => undefined).then(() => {
      if (animations.get(content) === animation) animations.delete(content)
    })
  } catch {
    // Навигация уже обновлена; анимация остаётся необязательной.
  }
}
