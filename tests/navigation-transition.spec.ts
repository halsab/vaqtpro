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
  oldDuration: string
  newDuration: string
  oldEasing: string
  newEasing: string
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
  __navigationTransitionCalls: number
}

async function installTransitionProbe(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const probeWindow = window as unknown as TransitionProbeWindow
    probeWindow.__navigationTransitionSnapshot = null
    probeWindow.__navigationTransitionCalls = 0
    const startViewTransition = Reflect.get(document, 'startViewTransition') as
      | ((callback?: ViewTransitionUpdateCallback) => ViewTransition)
      | undefined
    if (typeof startViewTransition !== 'function') return
    const nativeStart = startViewTransition.bind(document)

    document.startViewTransition = (callback) => {
      probeWindow.__navigationTransitionCalls += 1
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
          oldDuration: oldStyle.animationDuration,
          newDuration: newStyle.animationDuration,
          oldEasing: oldStyle.animationTimingFunction,
          newEasing: newStyle.animationTimingFunction,
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

async function transitionCallCount(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window as unknown as TransitionProbeWindow).__navigationTransitionCalls)
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
    oldDuration: '0.3s',
    newDuration: '0.3s',
    oldEasing: 'ease-in-out',
    newEasing: 'ease-in-out',
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

test('browser Back and Forward restore the route through opacity-only transitions', async ({ page }) => {
  await installTransitionProbe(page)
  await page.goto('./')
  await choosePlace(page)
  await waitForPreviousTransition(page)
  test.skip(await page.evaluate(() => typeof document.startViewTransition !== 'function'), 'Native View Transitions are unavailable in this browser')

  await page.locator('#home-date').click()
  await expect(page.getByRole('region', { name: 'Установка даты' })).toBeVisible()
  await page.goBack()
  await expectOpacityOnlyTransition(page)
  await expect(page.getByRole('region', { name: 'Главная', exact: true })).toBeVisible()
  await waitForPreviousTransition(page)

  await clearTransitionProbe(page)
  await page.goForward()
  await expectOpacityOnlyTransition(page)
  await expect(page.getByRole('region', { name: 'Установка даты' })).toBeVisible()
})

test('reduced motion performs functional navigation without starting a transition', async ({ page }) => {
  await installTransitionProbe(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('./')
  await choosePlace(page)
  await page.locator('#home-settings').click()
  await expect(page.getByRole('region', { name: 'Настройки' })).toBeVisible()
  await expect.poll(() => transitionCallCount(page)).toBe(0)
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Главная', exact: true })).toBeVisible()
  await expect.poll(() => transitionCallCount(page)).toBe(0)
})

test('rapid navigation intents remain interactive and finish on the latest screen', async ({ page }) => {
  await installTransitionProbe(page)
  await page.goto('./')
  await choosePlace(page)
  await waitForPreviousTransition(page)
  test.skip(await page.evaluate(() => typeof document.startViewTransition !== 'function'), 'Native View Transitions are unavailable in this browser')

  await page.locator('#home-settings').click()
  await expect(page.getByRole('region', { name: 'Настройки' })).toBeVisible()
  await page.getByRole('button', { name: 'Назад', exact: true }).click({ noWaitAfter: true })
  await expect(page.getByRole('region', { name: 'Главная', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => {
    const state: unknown = window.history.state
    if (!state || typeof state !== 'object' || !('salahNavigation' in state)) return null
    const navigation: unknown = state.salahNavigation
    if (!navigation || typeof navigation !== 'object' || !('entries' in navigation) || !Array.isArray(navigation.entries)) return null
    const entry: unknown = navigation.entries.at(-1)
    return entry && typeof entry === 'object' && 'screen' in entry && typeof entry.screen === 'string' ? entry.screen : null
  })).toBe('home')
})

test('Back restores the previous scroll position and trigger focus', async ({ page }) => {
  await page.goto('./')
  await choosePlace(page)
  const content = page.locator('.screen-content')
  await content.evaluate(element => { element.scrollTop = element.scrollHeight })
  const scrollBefore = await content.evaluate(element => element.scrollTop)
  await page.locator('#home-settings').focus()
  await page.locator('#home-settings').click()
  await expect(page.getByRole('region', { name: 'Настройки' })).toBeVisible()
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(page.locator('#home-settings')).toBeFocused()
  await expect.poll(() => content.evaluate(element => element.scrollTop)).toBe(scrollBefore)
})
