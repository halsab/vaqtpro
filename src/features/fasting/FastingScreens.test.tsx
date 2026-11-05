import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { FASTING_DUA_IDS, getFastingDuaContent } from './fastingDuaContent'
import { FastingDuaScreen } from './FastingDuaScreen'
import { FastingScreen } from './FastingScreen'

const titles = { suhur: 'Дуа сухура', iftar: 'Дуа ифтара' } as const

it('shows exactly the two standard navigation rows and opens the selected dua', async () => {
  const user = userEvent.setup()
  const onOpenDua = vi.fn()
  render(<FastingScreen onBack={() => {}} onOpenDua={onOpenDua} />)

  expect(screen.getByRole('region', { name: 'Пост' })).toBeInTheDocument()
  expect(screen.getAllByRole('button')).toHaveLength(3)
  await user.click(screen.getByRole('button', { name: titles.suhur }))
  expect(onOpenDua).toHaveBeenCalledWith('suhur')
  await user.click(screen.getByRole('button', { name: titles.iftar }))
  expect(onOpenDua).toHaveBeenCalledWith('iftar')
})

it.each(FASTING_DUA_IDS)('renders %s in article order with Arabic RTL', id => {
  render(<FastingDuaScreen duaId={id} onBack={() => {}} />)
  const content = getFastingDuaContent(id)
  const article = document.querySelector('.ramadan-dhikr-article')
  expect(article).toBeInTheDocument()
  if (!article) throw new Error('Fasting dua article was not rendered')
  const headings = [...article.querySelectorAll('h1, h2')].map(heading => heading.textContent)
  expect(headings).toEqual([titles[id], 'Арабский текст', 'Транскрипция', 'Перевод'])
  const arabic = article.querySelector('.ramadan-dhikr-arabic')
  expect(arabic?.textContent).toBe(content.arabic)
  expect(arabic).toHaveAttribute('dir', 'rtl')
  expect(arabic).toHaveAttribute('lang', 'ar')
  expect(article.querySelectorAll('p')[1]?.textContent).toBe(content.transcription)
  expect(article.querySelectorAll('p')[2]?.textContent).toBe(content.translation)
  expect(document.querySelector('.screen-content')?.scrollWidth).toBeLessThanOrEqual(document.querySelector('.screen-content')?.clientWidth ?? 0)
})

it('keeps the article Back button keyboard accessible', async () => {
  const onBack = vi.fn()
  const user = userEvent.setup()
  render(<FastingDuaScreen duaId="suhur" onBack={onBack} />)
  const back = screen.getByRole('button', { name: 'Назад' })
  back.focus()
  expect(back).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(onBack).toHaveBeenCalledOnce()
})
