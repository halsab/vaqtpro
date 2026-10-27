import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import type { ReligiousEventOccurrence } from '../../domain/religiousEvents'
import { ReligiousEventOccurrenceRow, ReligiousEventsScreen } from './ReligiousEventsScreen'

it('opens the selected event article from the event list', async () => {
  const onOpenEvent = vi.fn()
  render(<ReligiousEventsScreen
    today="2026-01-01"
    correction={0}
    hijriSupported
    onOpenEvent={onOpenEvent}
    onBack={() => {}}
  />)

  await userEvent.click(screen.getByRole('button', { name: /Начало Рамадана/ }))
  expect(onOpenEvent).toHaveBeenCalledWith('ramadan')
})

it('keeps an occurrence without an article noninteractive', () => {
  const occurrence: ReligiousEventOccurrence = {
    eventId: 'ashura',
    kind: 'day',
    civilDate: '2026-06-25',
    hijriDate: { year: 1448, month: 1, day: 10 },
    contentId: null,
  }
  render(<ul><ReligiousEventOccurrenceRow occurrence={occurrence} onOpenEvent={() => {}} /></ul>)

  expect(within(screen.getByRole('listitem')).queryByRole('button')).not.toBeInTheDocument()
})

it('shows deferred article progress and offers a retry after load failure', async () => {
  const retry = vi.fn()
  const reload = vi.fn()
  const view = render(<ReligiousEventsScreen today="2026-01-01" correction={0} hijriSupported
    onOpenEvent={() => {}} onBack={() => {}} loadPending />)
  expect(screen.getByRole('status')).toHaveTextContent('Загрузка')
  expect(screen.getByRole('status')).toHaveClass('screen-load-progress')

  view.rerender(<ReligiousEventsScreen today="2026-01-01" correction={0} hijriSupported
    onOpenEvent={() => {}} onBack={() => {}} loadError="Не удалось загрузить статью" onRetryLoad={retry} onReload={reload} />)
  await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
  await userEvent.click(screen.getByRole('button', { name: 'Перезапустить' }))
  expect(retry).toHaveBeenCalledOnce()
  expect(reload).toHaveBeenCalledOnce()
})
