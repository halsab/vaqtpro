import { choosePlace, expect, test } from './fixtures'

interface TransitionSnapshot {
  oldOpacity?: string[]
  newOpacity?: string[]
  oldAnimatedProperties: string[]
  newAnimatedProperties: string[]
  oldGeometry: string[]
  newGeometry: string[]
  oldDuration: string
  newDuration: string
  oldEasing: string
  newEasing: string
  groupAnimation: string
  groupGeometry: string[]
  groupTransform: string
  rootOldAnimation: string
  rootNewAnimation: string
  rootGroupAnimation: string
  shellBounds: number[][]
  snapshotBounds: number[][]
  contentSizes: string[][]
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
    const readBounds = () => ['.app-layout', '.app-screen', '.screen-content'].map(selector => {
      const rect = document.querySelector(selector)?.getBoundingClientRect()
      return rect ? [rect.x, rect.y, rect.width, rect.height].map(value => Math.round(value * 100) / 100) : []
    })
    const readContentSize = () => {
      const content = document.querySelector('.screen-content')
      if (!content) return []
      const style = getComputedStyle(content)
      return [style.width, style.height]
    }
    const startViewTransition = Reflect.get(document, 'startViewTransition') as
      | ((callback?: ViewTransitionUpdateCallback) => ViewTransition)
      | undefined
    if (typeof startViewTransition !== 'function') return
    const nativeStart = startViewTransition.bind(document)

    document.startViewTransition = (callback) => {
      probeWindow.__navigationTransitionCalls += 1
      const beforeBounds = readBounds()
      const beforeContentSize = readContentSize()
      let afterBounds: number[][] = []
      let afterContentSize: string[] = []
      let transitionSnapshot: TransitionSnapshot | null = null
      const transition = nativeStart(() => {
        callback?.()
        afterBounds = readBounds()
        afterContentSize = readContentSize()
      })
      void transition.finished.then(() => {
        if (probeWindow.__navigationTransitionSnapshot === transitionSnapshot && transitionSnapshot) {
          transitionSnapshot.snapshotBounds.push(...readBounds())
        }
      })
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
        const geometry = (style: CSSStyleDeclaration) => [style.top, style.left, style.width, style.height, style.getPropertyValue('inset')]
        const recordFrame = (remaining: number) => {
          if (probeWindow.__navigationTransitionSnapshot === transitionSnapshot && transitionSnapshot) {
            transitionSnapshot.snapshotBounds.push(...readBounds())
          }
          if (remaining > 1) requestAnimationFrame(() => recordFrame(remaining - 1))
        }
        const animatedProperties = (keyframes: Keyframe[] | undefined) => [...new Set((keyframes ?? []).flatMap((frame) =>
          Object.keys(frame).filter((property) => !['offset', 'computedOffset', 'easing', 'composite'].includes(property)),
        ))].sort()

        transitionSnapshot = {
          oldOpacity: oldContent?.keyframes.map((frame) => frame.opacity as string),
          newOpacity: newContent?.keyframes.map((frame) => frame.opacity as string),
          oldAnimatedProperties: animatedProperties(oldContent?.keyframes),
          newAnimatedProperties: animatedProperties(newContent?.keyframes),
          oldGeometry: geometry(oldStyle),
          newGeometry: geometry(newStyle),
          oldDuration: oldStyle.animationDuration,
          newDuration: newStyle.animationDuration,
          oldEasing: oldStyle.animationTimingFunction,
          newEasing: newStyle.animationTimingFunction,
          groupAnimation: group.animationName,
          groupGeometry: [group.top, group.left, group.width, group.height],
          groupTransform: group.transform,
          rootOldAnimation: rootOld.animationName,
          rootNewAnimation: rootNew.animationName,
          rootGroupAnimation: rootGroup.animationName,
          shellBounds: [beforeBounds[0] ?? [], afterBounds[0] ?? []],
          snapshotBounds: [beforeBounds[1] ?? [], beforeBounds[2] ?? [], afterBounds[1] ?? [], afterBounds[2] ?? []],
          contentSizes: [beforeContentSize, afterContentSize],
        }
        probeWindow.__navigationTransitionSnapshot = transitionSnapshot
        requestAnimationFrame(() => recordFrame(4))
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
    oldGeometry: expect.arrayContaining([expect.any(String)]),
    newGeometry: expect.arrayContaining([expect.any(String)]),
    oldDuration: '0.3s',
    newDuration: '0.3s',
    oldEasing: 'ease-in-out',
    newEasing: 'ease-in-out',
    groupAnimation: 'none',
    rootOldAnimation: 'none',
    rootNewAnimation: 'none',
    rootGroupAnimation: 'none',
    groupGeometry: expect.arrayContaining([expect.any(String)]),
    groupTransform: expect.any(String),
    shellBounds: expect.arrayContaining([expect.any(Array)]),
    snapshotBounds: expect.arrayContaining([expect.any(Array)]),
    contentSizes: expect.arrayContaining([expect.any(Array)]),
  })
  const snapshot = await page.evaluate(() => (window as unknown as TransitionProbeWindow).__navigationTransitionSnapshot)
  expect(snapshot?.oldGeometry.slice(0, 2)).toEqual(snapshot?.newGeometry.slice(0, 2))
  expect(snapshot?.newGeometry.slice(2, 4)).toEqual(snapshot?.contentSizes[1])
  expect(snapshot?.groupGeometry.slice(2, 4)).toEqual(snapshot?.contentSizes[1])
  expect(snapshot?.shellBounds[0]).toEqual(snapshot?.shellBounds[1])
  const groupOrigin = await page.evaluate((transform) => {
    const matrix = new DOMMatrixReadOnly(transform ?? undefined)
    return [matrix.m41, matrix.m42]
  }, snapshot?.groupTransform)
  expect(groupOrigin).toEqual([snapshot?.snapshotBounds[3]?.[0], snapshot?.snapshotBounds[3]?.[1]])
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as TransitionProbeWindow).__navigationTransitionSnapshot?.snapshotBounds.length ?? 0,
  )).toBeGreaterThanOrEqual(19)
  const finalSnapshot = await page.evaluate(() => (window as unknown as TransitionProbeWindow).__navigationTransitionSnapshot)
  expect(finalSnapshot?.snapshotBounds[0]).toEqual(finalSnapshot?.snapshotBounds[2])
  expect(finalSnapshot?.snapshotBounds.length).toBeGreaterThanOrEqual(19)
  for (const bounds of snapshot?.snapshotBounds ?? []) expect(bounds).toHaveLength(4)
  const frameBounds = finalSnapshot?.snapshotBounds.slice(4) ?? []
  for (let index = 0; index < frameBounds.length; index += 3) {
    expect(frameBounds[index]).toEqual(finalSnapshot?.shellBounds[0])
    expect(frameBounds[index + 1]).toEqual(finalSnapshot?.snapshotBounds[2])
    expect(frameBounds[index + 2]).toEqual(finalSnapshot?.snapshotBounds[3])
  }
}

async function openMonthlyTimetableWithKeyboard(page: import('@playwright/test').Page) {
  await page.locator('#home-date').click()
  await expect(page.getByRole('region', { name: 'Установка даты' })).toBeVisible()
  await page.waitForTimeout(350)

  const content = page.locator('.screen-content')
  await content.evaluate(element => { element.scrollTop = element.scrollHeight })
  await page.locator('#date-religious-events').focus()
  await page.keyboard.press('Shift+Tab')
  const trigger = page.locator('#date-monthly-schedule')
  await expect(trigger).toBeFocused()
  const scrollTop = await content.evaluate(element => element.scrollTop)
  expect(scrollTop).toBeGreaterThan(0)

  await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: 'Расписание намаза за месяц' })).toBeVisible()
  return { content, scrollTop, trigger }
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
  await waitForPreviousTransition(page)
  await clearTransitionProbe(page)
  await page.goBack()
  await expectOpacityOnlyTransition(page)
  await expect(page.getByRole('region', { name: 'Главная', exact: true })).toBeVisible()
  await waitForPreviousTransition(page)

  await clearTransitionProbe(page)
  await page.goForward()
  await expectOpacityOnlyTransition(page)
  await expect(page.getByRole('region', { name: 'Установка даты' })).toBeVisible()
})

test('snapshot alignment holds in compact portrait and landscape viewports', async ({ page }) => {
  await installTransitionProbe(page)
  await page.goto('./')
  await choosePlace(page)
  await waitForPreviousTransition(page)
  test.skip(await page.evaluate(() => typeof document.startViewTransition !== 'function'), 'Native View Transitions are unavailable in this browser')

  for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport)
    await page.waitForTimeout(100)
    await clearTransitionProbe(page)
    await page.locator('#home-date').click()
    await expect(page.getByRole('region', { name: 'Установка даты' })).toBeVisible()
    await expectOpacityOnlyTransition(page)
    await waitForPreviousTransition(page)

    await clearTransitionProbe(page)
    await page.getByRole('button', { name: 'Назад', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Главная', exact: true })).toBeVisible()
    await expectOpacityOnlyTransition(page)
    await waitForPreviousTransition(page)
  }
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

test('keyboard entry and in-app Back restore monthly action focus and scroll through opacity transitions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 400 })
  await installTransitionProbe(page)
  await page.goto('./')
  await choosePlace(page)
  await waitForPreviousTransition(page)
  test.skip(await page.evaluate(() => typeof document.startViewTransition !== 'function'), 'Native View Transitions are unavailable in this browser')

  const { content, scrollTop, trigger } = await openMonthlyTimetableWithKeyboard(page)
  await expectOpacityOnlyTransition(page)
  await waitForPreviousTransition(page)
  await clearTransitionProbe(page)
  await page.getByRole('button', { name: 'Назад', exact: true }).click()

  await expectOpacityOnlyTransition(page)
  await expect(page.getByRole('region', { name: 'Установка даты' })).toBeVisible()
  await expect(trigger).toBeFocused()
  await expect.poll(() => content.evaluate(element => element.scrollTop)).toBe(scrollTop)
})

test('browser Back restores monthly action focus and scroll through the same transition', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 400 })
  await installTransitionProbe(page)
  await page.goto('./')
  await choosePlace(page)
  await waitForPreviousTransition(page)
  test.skip(await page.evaluate(() => typeof document.startViewTransition !== 'function'), 'Native View Transitions are unavailable in this browser')

  const { content, scrollTop, trigger } = await openMonthlyTimetableWithKeyboard(page)
  await expectOpacityOnlyTransition(page)
  await waitForPreviousTransition(page)
  await clearTransitionProbe(page)
  await page.goBack()

  await expectOpacityOnlyTransition(page)
  await expect(page.getByRole('region', { name: 'Установка даты' })).toBeVisible()
  await expect(trigger).toBeFocused()
  await expect.poll(() => content.evaluate(element => element.scrollTop)).toBe(scrollTop)
})
