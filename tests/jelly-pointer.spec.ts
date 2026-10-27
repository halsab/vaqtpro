import { expect, test } from '@playwright/test'

test('mobile WebKit ignores a delayed synthetic click after an outside release', async ({ page }) => {
  await page.goto('./')
  const searchButton = page.getByRole('button', { name: 'Найти город' })
  await expect(searchButton).toBeVisible()

  await page.evaluate(async () => {
    const button = document.querySelector<HTMLButtonElement>('button')
    if (!button) throw new Error('Search action is missing')
    const rect = button.getBoundingClientRect()
    const pointer = (type: string, id: number, x: number) => new PointerEvent(type, {
      bubbles: true, pointerId: id, pointerType: 'touch', button: 0, clientX: x, clientY: rect.top + rect.height / 2,
    })
    button.dispatchEvent(pointer('pointerdown', 101, rect.left + rect.width / 2))
    window.dispatchEvent(pointer('pointerup', 101, rect.right + 40))
    await new Promise(resolve => setTimeout(resolve, 450))
    button.dispatchEvent(new MouseEvent('click', {
      bubbles: true, cancelable: true, detail: 1, clientX: rect.right + 40, clientY: rect.top + rect.height / 2,
    }))
  })

  await expect(page.getByRole('region', { name: 'Поиск города' })).toHaveCount(0)
  await searchButton.click()
  await expect(page.getByRole('region', { name: 'Поиск города' })).toBeVisible()
})

test('mobile WebKit ignores synthetic clicks after cancellation and lost capture', async ({ page }) => {
  await page.goto('./')
  const searchButton = page.getByRole('button', { name: 'Найти город' })
  await expect(searchButton).toBeVisible()

  await page.evaluate(async () => {
    const button = document.querySelector<HTMLButtonElement>('button')
    if (!button) throw new Error('Search action is missing')
    const rect = button.getBoundingClientRect()
    const makePointer = (type: string, id: number) => new PointerEvent(type, {
      bubbles: true, pointerId: id, pointerType: 'touch', button: 0,
      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
    })
    button.dispatchEvent(makePointer('pointerdown', 102))
    window.dispatchEvent(makePointer('pointercancel', 102))
    await new Promise(resolve => setTimeout(resolve, 250))
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
    button.dispatchEvent(makePointer('pointerdown', 103))
    button.dispatchEvent(new Event('lostpointercapture', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 250))
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
  })

  await expect(page.getByRole('region', { name: 'Поиск города' })).toHaveCount(0)
  await searchButton.click()
  await expect(page.getByRole('region', { name: 'Поиск города' })).toBeVisible()
})
