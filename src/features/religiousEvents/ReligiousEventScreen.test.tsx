import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { getReligiousEventContent } from './religiousEventContent'
import { ReligiousEventScreen } from './ReligiousEventScreen'

it('shows three Ramadan dhikr buttons above the unchanged article and opens the selected period', async () => {
  const onOpenRamadanDhikr = vi.fn()
  const user = userEvent.setup()
  render(<ReligiousEventScreen eventId="ramadan" onBack={() => {}} onOpenRamadanDhikr={onOpenRamadanDhikr} />)

  const first = screen.getByRole('button', { name: 'Зикр первых 10 дней' })
  const second = screen.getByRole('button', { name: 'Зикр вторых 10 дней' })
  const last = screen.getByRole('button', { name: 'Зикр последних 10 дней' })
  expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(second.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(first.closest('.ramadan-article-flow')?.querySelector('.markdown-article')).toBeInTheDocument()
  const article = await screen.findByRole('heading', { name: 'Рамадан' })
  expect(article).toBeVisible()
  expect(article.parentElement).toHaveTextContent('Рамадан — месяц обязательного поста, Корана, ночного поклонения, щедрости и покаяния.')
  expect(article.parentElement).toHaveTextContent('Хороший Рамадан узнаётся не только по тому, сколько человек сделал за месяц, но и по тому, что из этого осталось после него.')
  expect(getReligiousEventContent('ramadan', 'ru').status).toBe('resolved')

  await user.click(second)
  expect(onOpenRamadanDhikr).toHaveBeenCalledWith('second')
})

it('does not add dhikr buttons to other religious event articles', () => {
  render(<ReligiousEventScreen eventId="ashura" onBack={() => {}} onOpenRamadanDhikr={vi.fn()} />)
  expect(screen.queryByRole('button', { name: /Зикр/ })).not.toBeInTheDocument()
})
