import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { FASTING_DUA_IDS, getFastingDuaContent } from './fastingDuaContent'
import { FastingDuaScreen } from './FastingDuaScreen'
import { FastingScreen } from './FastingScreen'

const titles = { suhur: 'Дуа сухура', iftar: 'Дуа ифтара' } as const

it('shows the title and exactly two standard navigation rows', async () => {
  const user = userEvent.setup()
  const onOpenDua = vi.fn()
  render(<FastingScreen onBack={() => {}} onOpenDua={onOpenDua} />)

  const region = screen.getByRole('region', { name: 'Пост' })
  expect(region).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Пост', level: 1 })).toBeVisible()
  expect(screen.getAllByRole('button')).toHaveLength(3)
  await user.click(screen.getByRole('button', { name: titles.suhur }))
  expect(onOpenDua).toHaveBeenCalledWith('suhur')
  await user.click(screen.getByRole('button', { name: titles.iftar }))
  expect(onOpenDua).toHaveBeenCalledWith('iftar')
})

it.each(FASTING_DUA_IDS)('renders %s via shared Markdown article in order with Arabic RTL', async id => {
  render(<FastingDuaScreen duaId={id} onBack={() => {}} />)
  const heading = await screen.findByRole('heading', { name: titles[id], level: 1 })
  const article = heading.closest('.markdown-article')
  expect(article).not.toBeNull()
  if (!article) throw new Error('Fasting dua Markdown article was not rendered')
  expect([...article.querySelectorAll('h1, h2')].map(item => item.textContent))
    .toEqual([titles[id], 'Арабский текст', 'Транскрипция', 'Перевод'])

  const sections = getFastingDuaContent(id).split(/^## [^\r\n]+\r?\n/gmu).slice(1).map(section => section.trim())
  const [arabic, transcription, translation] = sections
  const arabicParagraph = article.querySelector('.markdown-article-arabic')
  expect(arabicParagraph).toHaveTextContent(arabic)
  expect(arabicParagraph).toHaveAttribute('dir', 'rtl')
  expect(arabicParagraph).toHaveAttribute('lang', 'ar')
  expect(article.querySelectorAll('p')[1]?.textContent).toBe(transcription)
  expect(article.querySelectorAll('p')[2]?.textContent).toBe(translation)
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
