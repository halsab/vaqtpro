import { choosePlace, expect, test } from './fixtures'

test('uses an opacity-only native crossfade for screen navigation', async ({ page }) => {
  await page.goto('./')
  await choosePlace(page)

  const supportsViewTransitions = await page.evaluate(() => typeof document.startViewTransition === 'function')
  test.skip(!supportsViewTransitions, 'Native View Transitions are unavailable in this browser')

  await page.getByRole('button', { name: 'Настройки' }).click()

  await expect.poll(() => page.evaluate(() => {
    const animations = document.getAnimations().flatMap(animation => {
      const effect = animation.effect
      if (!(effect instanceof KeyframeEffect) || !effect.pseudoElement) return []
      return [{ pseudoElement: effect.pseudoElement, keyframes: effect.getKeyframes() }]
    })
    const oldContent = animations.find(animation => animation.pseudoElement === '::view-transition-old(screen-content)')
    const newContent = animations.find(animation => animation.pseudoElement === '::view-transition-new(screen-content)')
    const group = getComputedStyle(document.documentElement, '::view-transition-group(screen-content)')
    const rootGroup = getComputedStyle(document.documentElement, '::view-transition-group(root)')
    return {
      oldOpacity: oldContent?.keyframes.map(frame => frame.opacity),
      newOpacity: newContent?.keyframes.map(frame => frame.opacity),
      oldTransform: oldContent?.keyframes.map(frame => frame.transform ?? null),
      newTransform: newContent?.keyframes.map(frame => frame.transform ?? null),
      groupTransform: group.transform,
      rootAnimation: rootGroup.animationName,
      destinationVisible: document.querySelector('[aria-label="Настройки"]') !== null,
    }
  })).toEqual({
    oldOpacity: ['1', '0'],
    newOpacity: ['0', '1'],
    oldTransform: [null, null],
    newTransform: [null, null],
    groupTransform: 'none',
    rootAnimation: 'none',
    destinationVisible: true,
  })
})
