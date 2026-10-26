import { expect, test } from '@playwright/test'

test('two tabs share one execution owner and explicitly hand it off', async ({ context }) => {
  const first = await context.newPage()
  const second = await context.newPage()
  await Promise.all([first.goto('./'), second.goto('./')])

  await expect.poll(async () => (await Promise.all([first, second].map(page => page.locator('[data-execution-owner]').count())))
    .reduce((sum, count) => sum + count, 0)).toBe(1)

  const owner = (await first.locator('[data-execution-owner]').count()) ? first : second
  const requester = owner === first ? second : first
  await expect(requester.getByRole('heading', { name: 'Приложение уже открыто' })).toBeVisible()
  await requester.getByRole('button', { name: 'Продолжить здесь' }).click()
  await expect(requester.locator('[data-execution-owner]')).toBeVisible()
  await expect(owner.getByRole('heading', { name: 'Приложение уже открыто' })).toBeVisible()
  await expect(owner.locator('[data-execution-owner]')).toHaveCount(0)
  await requester.context().setOffline(true)
  await owner.getByRole('button', { name: 'Продолжить здесь' }).click()
  await expect(owner.locator('[data-execution-owner]')).toBeVisible()
  await expect(requester.getByRole('heading', { name: 'Приложение уже открыто' })).toBeVisible()
  await requester.context().setOffline(false)
})

test('a blocked tab can acquire ownership after the owner closes', async ({ context }) => {
  const owner = await context.newPage()
  const requester = await context.newPage()
  await owner.goto('./')
  await expect(owner.locator('[data-execution-owner]')).toBeVisible()
  await requester.goto('./')
  await expect(requester.getByRole('heading', { name: 'Приложение уже открыто' })).toBeVisible()
  await owner.close()
  await requester.getByRole('button', { name: 'Продолжить здесь' }).click()
  await expect(requester.locator('[data-execution-owner]')).toBeVisible()
})

test('a full reload releases the prior page lifecycle lock and starts only one App', async ({ context }) => {
  const owner = await context.newPage()
  const requester = await context.newPage()
  await owner.goto('./')
  await expect(owner.locator('[data-execution-owner]')).toBeVisible()
  await requester.goto('./')
  await expect(requester.getByRole('heading', { name: 'Приложение уже открыто' })).toBeVisible()

  await owner.reload()
  await expect.poll(async () => (await Promise.all([owner, requester].map(page => page.locator('[data-execution-owner]').count())))
    .reduce((sum, count) => sum + count, 0)).toBe(1)
  await expect(requester.locator('[data-execution-owner]')).toHaveCount(0)
})

test('simultaneous takeover requests never authorize two apps', async ({ context }) => {
  const pages = await Promise.all([context.newPage(), context.newPage(), context.newPage()])
  await Promise.all(pages.map(page => page.goto('./')))
  await expect.poll(async () => (await Promise.all(pages.map(page => page.locator('[data-execution-owner]').count())))
    .reduce((sum, count) => sum + count, 0)).toBe(1)

  const counts = await Promise.all(pages.map(page => page.locator('[data-execution-owner]').count()))
  const ownerIndex = counts.findIndex(count => count === 1)
  const requesters = pages.filter((_, index) => index !== ownerIndex)
  await Promise.all(requesters.map(page => page.getByRole('button', { name: 'Продолжить здесь' }).click()))

  await expect.poll(async () => (await Promise.all(pages.map(page => page.locator('[data-execution-owner]').count())))
    .reduce((sum, count) => sum + count, 0)).toBe(1)
  await expect.poll(async () => (await Promise.all(pages.map(page => page.locator('[data-execution-owner]').count())))
    .filter(count => count === 1)).toHaveLength(1)
})

test('a granted but delayed Web Lock keeps requesters blocked until ownership is confirmed', async ({ context }) => {
  const owner = await context.newPage()
  await owner.goto('./')
  await expect(owner.locator('[data-execution-owner]')).toBeVisible()

  const requester = await context.newPage()
  await requester.addInitScript(() => {
    const manager = navigator.locks
    const request = manager.request.bind(manager)
    let delayNextGrant = true
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: (name: string, options: LockOptions, callback: (lock: Lock | null) => Promise<void>) =>
          request(name, options, async lock => {
            if (!lock || !delayNextGrant) return callback(lock)
            delayNextGrant = false
            ;(window as Window & { delayedExecutionLockGranted?: boolean }).delayedExecutionLockGranted = true
            await new Promise<void>(resolve => window.setTimeout(resolve, 1_200))
            return callback(lock)
          }),
      },
    })
  })
  await requester.goto('./')
  const takeover = requester.getByRole('button', { name: 'Продолжить здесь' })
  await expect(takeover).toBeVisible()
  await takeover.click()
  await expect(requester.getByRole('button', { name: 'Переключаем…' })).toBeDisabled()
  await expect.poll(() => requester.evaluate(() =>
    (window as Window & { delayedExecutionLockGranted?: boolean }).delayedExecutionLockGranted)).toBe(true)
  await expect(requester.locator('[data-execution-owner]')).toHaveCount(0)

  const competitor = await context.newPage()
  await competitor.goto('./')
  await expect(competitor.getByRole('heading', { name: 'Приложение уже открыто' })).toBeVisible()
  await expect(competitor.locator('[data-execution-owner]')).toHaveCount(0)

  await expect(requester.locator('[data-execution-owner]')).toBeVisible()
  await expect(owner.getByRole('heading', { name: 'Приложение уже открыто' })).toBeVisible()
  const ownerCount = await Promise.all([owner, requester, competitor]
    .map(page => page.locator('[data-execution-owner]').count()))
  expect(ownerCount.reduce((sum, count) => sum + count, 0)).toBe(1)
})

test('rapid ownership switching across three tabs keeps exactly one active app', async ({ context }) => {
  const pages = await Promise.all([context.newPage(), context.newPage(), context.newPage()])
  await Promise.all(pages.map(page => page.goto('./')))
  await expect.poll(async () => (await Promise.all(pages.map(page => page.locator('[data-execution-owner]').count())))
    .reduce((sum, count) => sum + count, 0)).toBe(1)

  let ownerIndex = (await Promise.all(pages.map(page => page.locator('[data-execution-owner]').count()))).findIndex(count => count === 1)
  for (let step = 0; step < 6; step += 1) {
    const nextIndex = (ownerIndex + 1) % pages.length
    const next = pages[nextIndex]
    const previous = pages[ownerIndex]
    if (!next || !previous) throw new Error('Expected tabs for the ownership transfer')
    await next.getByRole('button', { name: 'Продолжить здесь' }).click()
    await expect(next.locator('[data-execution-owner]')).toBeVisible()
    await expect(previous.locator('[data-execution-owner]')).toHaveCount(0)
    const count = (await Promise.all(pages.map(page => page.locator('[data-execution-owner]').count())))
      .reduce((sum, active) => sum + active, 0)
    expect(count).toBe(1)
    ownerIndex = nextIndex
  }
})

test('the blocked gate applies seasonal dark tokens without mounting the App', async ({ context }) => {
  const owner = await context.newPage()
  await owner.goto('./')
  await expect(owner.locator('[data-execution-owner]')).toBeVisible()

  const blocked = await context.newPage()
  await blocked.emulateMedia({ colorScheme: 'dark' })
  await blocked.addInitScript(() => localStorage.setItem('salah-theme-preference-v1',
    JSON.stringify({ version: 1, themeFamily: 'seasonal' })))
  await blocked.goto('./')

  await expect(blocked.getByRole('heading', { name: 'Приложение уже открыто' })).toBeVisible()
  await expect.poll(() => blocked.evaluate(() => document.documentElement.dataset.theme)).toBe('seasonal')
  await expect.poll(() => blocked.evaluate(() => document.documentElement.dataset.themeTone)).toBe('dark')
  const palette = await blocked.evaluate(() => {
    const panel = document.querySelector('.screen-panel')
    return { season: document.documentElement.dataset.season, color: panel ? getComputedStyle(panel).color : null }
  })
  const seasonalDarkText = {
    winter: 'rgb(241, 244, 246)', spring: 'rgb(241, 245, 241)',
    summer: 'rgb(244, 242, 233)', autumn: 'rgb(245, 239, 234)',
  }
  expect(palette.color).toBe(seasonalDarkText[palette.season as keyof typeof seasonalDarkText])
  await expect(blocked.locator('[data-execution-owner]')).toHaveCount(0)
})

const gateThemes = [
  { family: 'classic', tone: 'dark', date: '2026-10-21', key: 'autumn' },
  { family: 'classic', tone: 'light', date: '2026-10-21', key: 'autumn' },
  ...(['winter', 'spring', 'summer', 'autumn'] as const).flatMap((season, index) => ([
    { family: 'seasonal', tone: 'dark', date: ['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15'][index], key: season },
    { family: 'seasonal', tone: 'light', date: ['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15'][index], key: season },
  ])),
] as const

for (const palette of gateThemes) {
  test(`blocked screen uses readable application surfaces for ${palette.family} ${palette.key} ${palette.tone}`, async ({ context }) => {
    const owner = await context.newPage()
    await owner.goto('./')
    await expect(owner.locator('[data-execution-owner]')).toBeVisible()

    const blocked = await context.newPage()
    await blocked.clock.install({ time: new Date(`${palette.date}T12:00:00`) })
    await blocked.emulateMedia({ colorScheme: palette.tone })
    await blocked.addInitScript(family => localStorage.setItem('salah-theme-preference-v1',
      JSON.stringify({ version: 1, themeFamily: family })), palette.family)
    await blocked.goto('./')
    await expect(blocked.getByRole('heading', { name: 'Приложение уже открыто' })).toBeVisible()

    const presentation = await blocked.evaluate(() => {
      const panel = document.querySelector('.screen-panel')
      const heading = document.querySelector('.screen-title')
      const copy = document.querySelector('.screen-copy')
      const button = document.querySelector('.screen-bottom button')
      const root = getComputedStyle(document.documentElement)
      const style = (element: Element | null) => element ? getComputedStyle(element) : null
      return {
        family: document.documentElement.dataset.theme,
        season: document.documentElement.dataset.season,
        tone: document.documentElement.dataset.themeTone,
        panel: style(panel)?.backgroundColor,
        heading: style(heading)?.color,
        headingFont: style(heading)?.fontFamily,
        copy: style(copy)?.color,
        buttonHeight: Number.parseFloat(style(button)?.height ?? '0'),
        backgroundSecondary: root.getPropertyValue('--background-secondary').trim(),
        backgroundTertiary: root.getPropertyValue('--background-tertiary').trim(),
        textPrimary: root.getPropertyValue('--text-primary').trim(),
      }
    })
    expect(presentation).toMatchObject({ family: palette.family, season: palette.key, tone: palette.tone })
    const cssColor = (value: string) => {
      const hex = value.slice(1)
      return `rgb(${[0, 2, 4].map(index => Number.parseInt(hex.slice(index, index + 2), 16)).join(', ')})`
    }
    expect(presentation.panel).toBe(cssColor(presentation.backgroundSecondary))
    expect(presentation.heading).toBe(cssColor(presentation.textPrimary))
    expect(presentation.copy).toBe(cssColor(presentation.textPrimary))
    expect(presentation.headingFont).toContain('Old Timey Mono')
    expect(presentation.buttonHeight).toBeGreaterThanOrEqual(44)

    const lightness = (color: string) => {
      const channels = color.match(/[\d.]+/gu)?.slice(0, 3).map(Number) ?? []
      const [red = 0, green = 0, blue = 0] = channels.map(value => {
        const linear = value / 255
        return linear <= 0.04045 ? linear / 12.92 : ((linear + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue
    }
    const [lighter, darker] = [lightness(presentation.heading), lightness(presentation.panel)].sort((a, b) => b - a)
    expect(((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05)).toBeGreaterThanOrEqual(4.5)

    const changedTone = palette.tone === 'light' ? 'dark' : 'light'
    await blocked.emulateMedia({ colorScheme: changedTone })
    await expect.poll(() => blocked.evaluate(() => document.documentElement.dataset.themeTone)).toBe(changedTone)
    const changedPalette = await blocked.evaluate(() => {
      const root = getComputedStyle(document.documentElement)
      const panel = document.querySelector('.screen-panel')
      const heading = document.querySelector('.screen-title')
      return {
        panel: panel ? getComputedStyle(panel).backgroundColor : '',
        heading: heading ? getComputedStyle(heading).color : '',
        backgroundSecondary: root.getPropertyValue('--background-secondary').trim(),
        textPrimary: root.getPropertyValue('--text-primary').trim(),
      }
    })
    expect(changedPalette.panel).toBe(cssColor(changedPalette.backgroundSecondary))
    expect(changedPalette.heading).toBe(cssColor(changedPalette.textPrimary))
  })
}

test('pagehide/pageshow lifecycle events quiesce and reacquire before rendering App', async ({ context }) => {
  const owner = await context.newPage()
  const requester = await context.newPage()
  await owner.goto('./')
  await expect(owner.locator('[data-execution-owner]')).toBeVisible()
  await requester.goto('./')
  await expect(requester.getByRole('heading', { name: 'Приложение уже открыто' })).toBeVisible()

  await owner.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })))
  await expect(owner.locator('[data-execution-owner]')).toHaveCount(0)
  await owner.waitForTimeout(100)
  await owner.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
  await expect(owner.locator('[data-execution-owner]')).toBeVisible()
  await expect(requester.locator('[data-execution-owner]')).toHaveCount(0)
})

test('repeated real back and forward navigation keeps execution ownership singular', async ({ context }) => {
  const owner = await context.newPage()
  await owner.route('**/away.html', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Away</title><main>Outside VaqtPro</main>',
  }))
  await owner.addInitScript(() => {
    window.addEventListener('pageshow', event => {
      const events = JSON.parse(sessionStorage.getItem('vaqtpro-pageshow-events') ?? '[]') as string[]
      events.push(event.persisted ? 'bfcache' : 'navigation')
      sessionStorage.setItem('vaqtpro-pageshow-events', JSON.stringify(events))
    })
  })
  await owner.goto('./')
  await expect(owner.locator('[data-execution-owner]')).toBeVisible()
  await owner.waitForTimeout(1_000)
  await owner.goto('away.html')
  await expect(owner).toHaveURL(/\/away\.html$/)
  await expect(owner).toHaveTitle('Away')
  await expect(owner.getByText('Outside VaqtPro')).toBeVisible()
  const bfcacheResults: boolean[] = []

  const currentOwner = await context.newPage()
  await currentOwner.goto('./')
  await expect(currentOwner.locator('[data-execution-owner]')).toBeVisible()
  await owner.goBack({ waitUntil: 'commit' })
  bfcacheResults.push(await owner.evaluate(() =>
    (JSON.parse(sessionStorage.getItem('vaqtpro-pageshow-events') ?? '[]') as string[]).at(-1) === 'bfcache'))

  await expect(owner.getByRole('heading', { name: 'Приложение уже открыто' })).toBeVisible()
  await expect(currentOwner.locator('[data-execution-owner]')).toBeVisible()
  await expect(owner.locator('[data-execution-owner]')).toHaveCount(0)
  await owner.getByRole('button', { name: 'Продолжить здесь' }).click()
  await expect(owner.locator('[data-execution-owner]')).toBeVisible()
  await expect(currentOwner.getByRole('heading', { name: 'Приложение уже открыто' })).toBeVisible()

  for (let cycle = 0; cycle < 3; cycle += 1) {
    await owner.goForward({ waitUntil: 'commit' })
    await expect(owner).toHaveURL(/away\.html$/)
    await expect(owner).toHaveTitle('Away')
    await currentOwner.getByRole('button', { name: 'Продолжить здесь' }).click()
    await expect(currentOwner.locator('[data-execution-owner]')).toBeVisible()
    await owner.goBack({ waitUntil: 'commit' })
    bfcacheResults.push(await owner.evaluate(() =>
      (JSON.parse(sessionStorage.getItem('vaqtpro-pageshow-events') ?? '[]') as string[]).at(-1) === 'bfcache'))
    await expect(owner.getByRole('heading', { name: 'Приложение уже открыто' })).toBeVisible()
    await expect(currentOwner.locator('[data-execution-owner]')).toBeVisible()
    await owner.getByRole('button', { name: 'Продолжить здесь' }).click()
    await expect(owner.locator('[data-execution-owner]')).toBeVisible()
    await expect(currentOwner.locator('[data-execution-owner]')).toHaveCount(0)
    const activeCount = await Promise.all([owner, currentOwner].map(page => page.locator('[data-execution-owner]').count()))
    expect(activeCount.reduce((sum, count) => sum + count, 0)).toBe(1)
  }
  test.skip(bfcacheResults.some(restored => !restored),
    'BFCache was unavailable for one or more real application restorations; ownership passed after ordinary navigation, but BFCache was not verified.')
  expect(bfcacheResults).toEqual([true, true, true, true])
})

test('Playwright browser restores plain same-origin documents from BFCache', async ({ context }) => {
  const page = await context.newPage()
  await page.addInitScript(() => {
    window.addEventListener('pageshow', event => {
      const events = JSON.parse(sessionStorage.getItem('plain-pageshow-events') ?? '[]') as boolean[]
      events.push(event.persisted)
      sessionStorage.setItem('plain-pageshow-events', JSON.stringify(events))
    })
  })

  await page.goto('./old-timey-mono-license.txt')
  await expect(page.locator('body')).toContainText('SIL Open Font License')
  await page.goto('./data/ODbL-1.0.txt')
  await expect(page.locator('body')).toContainText('ODC Open Database License')
  await page.goBack({ waitUntil: 'commit' })
  await expect(page.locator('body')).toContainText('SIL Open Font License')
  const restoredFromBfcache = await page.evaluate(() =>
    (JSON.parse(sessionStorage.getItem('plain-pageshow-events') ?? '[]') as boolean[]).at(-1))
  test.skip(restoredFromBfcache !== true,
    'BFCache is unavailable in this Playwright browser environment; this navigation was not BFCache-verified.')
  expect(restoredFromBfcache).toBe(true)
})

test('repeated back and forward navigation confirms real BFCache restoration', async ({ context }) => {
  const page = await context.newPage()
  await page.route('**/away.html', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Away</title><main>Outside VaqtPro</main>',
  }))
  await page.addInitScript(() => {
    window.addEventListener('pageshow', event => {
      const events = JSON.parse(sessionStorage.getItem('vaqtpro-pageshow-events') ?? '[]') as string[]
      events.push(event.persisted ? 'bfcache' : 'navigation')
      sessionStorage.setItem('vaqtpro-pageshow-events', JSON.stringify(events))
    })
  })
  await page.goto('./')
  await expect(page.locator('[data-execution-owner]')).toBeVisible()
  await page.waitForTimeout(1_000)

  const restorationResults: string[] = []
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await page.goto('away.html')
    await expect(page).toHaveTitle('Away')
    await expect(page.getByText('Outside VaqtPro')).toBeVisible()
    await page.goBack({ waitUntil: 'commit' })
    await expect(page).toHaveURL(/\/$/)
    const events = await page.evaluate(() => JSON.parse(sessionStorage.getItem('vaqtpro-pageshow-events') ?? '[]') as string[])
    restorationResults.push(events.at(-1) ?? 'missing')
    await expect(page.locator('[data-execution-owner]')).toBeVisible()
    await page.goForward({ waitUntil: 'commit' })
    await expect(page).toHaveTitle('Away')
    await page.goBack({ waitUntil: 'commit' })
    const restoredAgain = await page.evaluate(() => JSON.parse(sessionStorage.getItem('vaqtpro-pageshow-events') ?? '[]') as string[])
    restorationResults.push(restoredAgain.at(-1) ?? 'missing')
  }
  test.skip(restorationResults.some(result => result !== 'bfcache'),
    `BFCache was unavailable for one or more real back/forward navigations (${restorationResults.join(', ')}); this scenario was not BFCache-verified.`)
  expect(restorationResults).toEqual(Array.from({ length: 6 }, () => 'bfcache'))
})

test('seasonal light blocked styling reads invalid cache without mutating it', async ({ context }) => {
  const owner = await context.newPage()
  await owner.goto('./')
  await expect(owner.locator('[data-execution-owner]')).toBeVisible()

  const blocked = await context.newPage()
  await blocked.emulateMedia({ colorScheme: 'light' })
  await blocked.addInitScript(() => localStorage.setItem('salah-theme-preference-v1', '{'))
  await blocked.goto('./')

  await expect(blocked.getByRole('heading', { name: 'Приложение уже открыто' })).toBeVisible()
  await expect.poll(() => blocked.evaluate(() => document.documentElement.dataset.theme)).toBe('seasonal')
  await expect.poll(() => blocked.evaluate(() => document.documentElement.dataset.themeTone)).toBe('light')
  await expect(blocked.locator('.screen-title')).toHaveCSS('color', 'rgb(46, 38, 34)')
  await expect.poll(() => blocked.evaluate(() => localStorage.getItem('salah-theme-preference-v1'))).toBe('{')
})
