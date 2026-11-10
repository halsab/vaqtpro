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








const gateThemes = [
  { family: 'classic', tone: 'dark', date: '2026-10-21', key: 'autumn' },
  { family: 'classic', tone: 'light', date: '2026-10-21', key: 'autumn' },
  ...(['winter', 'spring', 'summer', 'autumn'] as const).flatMap((season, index) => ([
    { family: 'seasonal', tone: 'dark', date: ['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15'][index], key: season },
    { family: 'seasonal', tone: 'light', date: ['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15'][index], key: season },
  ])),
] as const

for (const palette of gateThemes) {
}





