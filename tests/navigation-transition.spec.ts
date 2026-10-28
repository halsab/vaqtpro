import { choosePlace, expect, test } from './fixtures'

async function expectOpacityOnlyTransition(page: import('@playwright/test').Page) {
  await expect.poll(() => page.evaluate(() => {
    const animations = document.getAnimations().flatMap(animation => {
      const effect = animation.effect
      if (!(effect instanceof KeyframeEffect) || !effect.pseudoElement) return []
      return [{ pseudoElement: effect.pseudoElement, keyframes: effect.getKeyframes() }]
    })
    const oldContent = animations.find(animation => animation.pseudoElement === '::view-transition-old(screen-content)')
    const newContent = animations.find(animation => animation.pseudoElement === '::view-transition-new(screen-content)')
    const oldStyle = getComputedStyle(document.documentElement, '::view-transition-old(screen-content)')
    const newStyle = getComputedStyle(document.documentElement, '::view-transition-new(screen-content)')
    const group = getComputedStyle(document.documentElement, '::view-transition-group(screen-content)')
    const rootOld = getComputedStyle(document.documentElement, '::view-transition-old(root)')
    const rootNew = getComputedStyle(document.documentElement, '::view-transition-new(root)')
    const rootGroup = getComputedStyle(document.documentElement, '::view-transition-group(root)')
    const animatedProperties = (keyframes: Keyframe[] | undefined) => [...new Set((keyframes ?? []).flatMap(frame =>
      Object.keys(frame).filter(property => !['offset', 'computedOffset', 'easing', 'composite'].includes(property)),
    ))].sort()

    return {
      oldOpacity: oldContent?.keyframes.map(frame => frame.opacity),
      newOpacity: newContent?.keyframes.map(frame => frame.opacity),
      oldAnimatedProperties: animatedProperties(oldContent?.keyframes),
      newAnimatedProperties: animatedProperties(newContent?.keyframes),
      oldTransform: oldStyle.transform,
      newTransform: newStyle.transform,
      oldScale: oldStyle.getPropertyValue('scale'),
      newScale: newStyle.getPropertyValue('scale'),
      oldTranslate: oldStyle.getPropertyValue('translate'),
      newTranslate: newStyle.getPropertyValue('translate'),
      oldFilter: oldStyle.filter,
      newFilter: newStyle.filter,
      groupAnimation: group.animationName,
      groupTransform: group.transform,
      rootOldAnimation: rootOld.animationName,
      rootNewAnimation: rootNew.animationName,
      rootOldTransform: rootOld.transform,
      rootNewTransform: rootNew.transform,
      rootGroupAnimation: rootGroup.animationName,
      rootGroupTransform: rootGroup.transform,
    }
  })).toEqual({
    oldOpacity: ['1', '0'],
    newOpacity: ['0', '1'],
    oldAnimatedProperties: ['opacity'],
    newAnimatedProperties: ['opacity'],
    oldTransform: 'none',
    newTransform: 'none',
    oldScale: 'none',
    newScale: 'none',
    oldTranslate: 'none',
    newTranslate: 'none',
    oldFilter: 'none',
    newFilter: 'none',
    groupAnimation: 'none',
    groupTransform: 'none',
    rootOldAnimation: 'none',
    rootNewAnimation: 'none',
    rootOldTransform: 'none',
    rootNewTransform: 'none',
    rootGroupAnimation: 'none',
    rootGroupTransform: 'none',
  })
}

test('uses an opacity-only native crossfade for forward and Back navigation', async ({ page }) => {
  await page.goto('./')
  await choosePlace(page)

  const supportsViewTransitions = await page.evaluate(() => typeof document.startViewTransition === 'function')
  test.skip(!supportsViewTransitions, 'Native View Transitions are unavailable in this browser')

  await page.getByRole('button', { name: 'Настройки' }).click()
  await expectOpacityOnlyTransition(page)
  await expect(page.getByRole('region', { name: 'Настройки' })).toBeVisible()

  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expectOpacityOnlyTransition(page)
  await expect(page.getByRole('region', { name: 'Главная', exact: true })).toBeVisible()
})

test('uses the same opacity-only crossfade for event detail and Back', async ({ page }) => {
  await page.goto('./')
  await choosePlace(page)

  const supportsViewTransitions = await page.evaluate(() => typeof document.startViewTransition === 'function')
  test.skip(!supportsViewTransitions, 'Native View Transitions are unavailable in this browser')

  await page.locator('#home-date').click()
  await page.getByRole('button', { name: 'Праздники и события' }).click()
  await expect(page.getByRole('region', { name: 'Праздники и события' })).toBeVisible()

  const firstEvent = page.locator('.religious-event-list-row').first()
  await expect(firstEvent).toBeVisible()
  await firstEvent.click()
  await expectOpacityOnlyTransition(page)
  await expect(page.locator('.markdown-article h1')).toBeVisible()

  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expectOpacityOnlyTransition(page)
  await expect(page.getByRole('region', { name: 'Праздники и события' })).toBeVisible()
})
