import { choosePlace, expect, test } from './fixtures'

interface TransitionSnapshot {
  oldOpacity?: string[]
  newOpacity?: string[]
  oldAnimatedProperties: string[]
  newAnimatedProperties: string[]
  oldTransform: string
  newTransform: string
  oldScale: string
  newScale: string
  oldTranslate: string
  newTranslate: string
  oldFilter: string
  newFilter: string
  groupAnimation: string
  groupTransform: string
  rootOldAnimation: string
  rootNewAnimation: string
  rootOldTransform: string
  rootNewTransform: string
  rootGroupAnimation: string
  rootGroupTransform: string
}

interface TransitionProbeWindow extends Window {
  __navigationTransitionSnapshot: TransitionSnapshot | null
}

async function installTransitionProbe(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const probeWindow = window as unknown as TransitionProbeWindow
    probeWindow.__navigationTransitionSnapshot = null
    const startViewTransition = Reflect.get(document, 'startViewTransition') as
      | ((callback?: ViewTransitionUpdateCallback) => ViewTransition)
      | undefined
    if (typeof startViewTransition !== 'function') return
    const nativeStart = startViewTransition.bind(document)

    document.startViewTransition = (callback) => {
      const transition = nativeStart(callback)
      void transition.ready.then(() => {
        const animations = document.getAnimations().flatMap((animation) => {
          const effect = animation.effect
          if (!(effect instanceof KeyframeEffect) || !effect.pseudoElement) return []
          return [{ pseudoElement: effect.pseudoElement, keyframes: effect.getKeyframes() }]
        })
        const oldContent = animations.find((animation) => animation.pseudoElement === '::view-transition-old(screen-content)')
        const newContent = animations.find((animation) => animation.pseudoElement === '::view-transition-new(screen-content)')
        const oldStyle = getComputedStyle(document.documentElement, '::view-transition-old(screen-content)')
        const newStyle = getComputedStyle(document.documentElement, '::view-transition-new(screen-content)')
        const group = getComputedStyle(document.documentElement, '::view-transition-group(screen-content)')
        const rootOld = getComputedStyle(document.documentElement, '::view-transition-old(root)')
        const rootNew = getComputedStyle(document.documentElement, '::view-transition-new(root)')
        const rootGroup = getComputedStyle(document.documentElement, '::view-transition-group(root)')
        const animatedProperties = (keyframes: Keyframe[] | undefined) => [...new Set((keyframes ?? []).flatMap((frame) =>
          Object.keys(frame).filter((property) => !['offset', 'computedOffset', 'easing', 'composite'].includes(property)),
        ))].sort()

        probeWindow.__navigationTransitionSnapshot = {
          oldOpacity: oldContent?.keyframes.map((frame) => frame.opacity as string),
          newOpacity: newContent?.keyframes.map((frame) => frame.opacity as string),
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
      })
      return transition
    }
  })
}

async function clearTransitionProbe(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    (window as unknown as TransitionProbeWindow).__navigationTransitionSnapshot = null
  })
}

async function waitForPreviousTransition(page: import('@playwright/test').Page) {
  // Быстрые повторные переходы намеренно завершаются без новой анимации.
  await page.waitForTimeout(350)
}

async function expectOpacityOnlyTransition(page: import('@playwright/test').Page) {
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as TransitionProbeWindow).__navigationTransitionSnapshot,
  )).toEqual({
    oldOpacity: ['1', '0'],
    newOpacity: ['0', '1'],
    oldAnimatedProperties: ['opacity'],
    newAnimatedProperties: ['opacity'],
    oldTransform: 'matrix(1, 0, 0, 1, 0, 0)',
    newTransform: 'matrix(1, 0, 0, 1, 0, 0)',
    oldScale: 'none',
    newScale: 'none',
    oldTranslate: 'none',
    newTranslate: 'none',
    oldFilter: 'none',
    newFilter: 'none',
    groupAnimation: 'none',
    groupTransform: 'matrix(1, 0, 0, 1, 0, 0)',
    rootOldAnimation: 'none',
    rootNewAnimation: 'none',
    rootOldTransform: 'matrix(1, 0, 0, 1, 0, 0)',
    rootNewTransform: 'matrix(1, 0, 0, 1, 0, 0)',
    rootGroupAnimation: 'none',
    rootGroupTransform: 'matrix(1, 0, 0, 1, 0, 0)',
  })
}

test('uses an opacity-only native crossfade for forward and Back navigation', async ({ page }) => {
  await installTransitionProbe(page)
  await page.goto('./')
  await choosePlace(page)
  await waitForPreviousTransition(page)

  const supportsViewTransitions = await page.evaluate(() => typeof document.startViewTransition === 'function')
  test.skip(!supportsViewTransitions, 'Native View Transitions are unavailable in this browser')

  await clearTransitionProbe(page)
  await page.getByRole('button', { name: 'Настройки' }).click()
  await expectOpacityOnlyTransition(page)
  await expect(page.getByRole('region', { name: 'Настройки' })).toBeVisible()
  await waitForPreviousTransition(page)

  await clearTransitionProbe(page)
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expectOpacityOnlyTransition(page)
  await expect(page.getByRole('region', { name: 'Главная', exact: true })).toBeVisible()
})

test('uses the same opacity-only crossfade for event detail and Back', async ({ page }) => {
  await installTransitionProbe(page)
  await page.goto('./')
  await choosePlace(page)
  await waitForPreviousTransition(page)

  const supportsViewTransitions = await page.evaluate(() => typeof document.startViewTransition === 'function')
  test.skip(!supportsViewTransitions, 'Native View Transitions are unavailable in this browser')

  await page.locator('#home-date').click()
  await waitForPreviousTransition(page)
  await page.getByRole('button', { name: 'Праздники и события' }).click()
  await expect(page.getByRole('region', { name: 'Праздники и события' })).toBeVisible()
  await waitForPreviousTransition(page)

  const firstEvent = page.locator('.religious-event-list-row').first()
  await expect(firstEvent).toBeVisible()
  await clearTransitionProbe(page)
  await firstEvent.click()
  await expectOpacityOnlyTransition(page)
  await expect(page.locator('.markdown-article h1')).toBeVisible()
  await waitForPreviousTransition(page)

  await clearTransitionProbe(page)
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expectOpacityOnlyTransition(page)
  await expect(page.getByRole('region', { name: 'Праздники и события' })).toBeVisible()
})
