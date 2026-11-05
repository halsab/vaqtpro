import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { translate } from '../../localization/messages'
import { getRamadanDhikrContent, RAMADAN_DHIKR_IDS, RAMADAN_DHIKR_TITLE_KEYS } from './ramadanDhikrContent'
import { RamadanDhikrScreen } from './RamadanDhikrScreen'

it.each(RAMADAN_DHIKR_IDS)('renders the %s dhikr with Arabic set to RTL', id => {
  render(<RamadanDhikrScreen dhikrId={id} onBack={() => {}} />)
  const content = getRamadanDhikrContent(id)
  const title = translate('ru', RAMADAN_DHIKR_TITLE_KEYS[id])

  expect(screen.getByRole('region', { name: title })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: title, level: 1 })).toBeInTheDocument()
  const arabic = document.querySelector('.ramadan-dhikr-arabic')
  expect(arabic?.textContent).toBe(content.arabic)
  if (!arabic) throw new Error('Arabic text was not rendered')
  expect(arabic).toHaveAttribute('dir', 'rtl')
  expect(arabic).toHaveAttribute('lang', 'ar')
  const paragraphs = document.querySelectorAll('.ramadan-dhikr-article p')
  expect(paragraphs[1]?.textContent).toBe(content.transcription)
  expect(paragraphs[2]?.textContent).toBe(content.translation)
  expect(document.querySelector('.screen-content')?.scrollWidth).toBeLessThanOrEqual(document.querySelector('.screen-content')?.clientWidth ?? 0)
})

it('keeps the Back button keyboard accessible', async () => {
  const onBack = vi.fn()
  const user = userEvent.setup()
  render(<RamadanDhikrScreen dhikrId="first" onBack={onBack} />)
  const back = screen.getByRole('button', { name: 'Назад' })

  back.focus()
  expect(back).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(onBack).toHaveBeenCalledOnce()
})
