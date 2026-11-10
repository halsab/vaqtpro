import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { MarkdownArticle } from './MarkdownArticle'
import { markdownLink, markdownText } from './markdownContent'

it('оставляет runtime-значения текстом и принимает только http/https для внешней ссылки', async () => {
  const { container } = render(<MarkdownArticle content={`# Источник\n\n${markdownText('Казань [ссылка](https://example.com)')}\n\n${markdownLink('Поставщик', 'javascript:alert(1)')}`} />)
  expect(await screen.findByText('Казань [ссылка](https://example.com)')).toBeVisible()
  expect(container.querySelector('a')).toBeNull()
  expect(screen.getByText('Поставщик')).toBeVisible()
})

it('isolates Arabic runs in Markdown paragraphs, nested emphasis, and list items without changing surrounding text', async () => {
  const { container } = render(<MarkdownArticle content={'Text قَالَ اللَّهُ clearly.\n\n- Arabic: **سُبْحَانَ اللَّهِ**\n- English stays English'} />)
  const paragraphs = await screen.findAllByText(/Text|English stays English/)
  expect(paragraphs.length).toBeGreaterThan(0)
  const arabic = Array.from(container.querySelectorAll('.markdown-arabic'))
  expect(arabic.map(element => element.textContent)).toEqual(['قَالَ اللَّهُ', 'سُبْحَانَ اللَّهِ'])
  expect(arabic[1]?.closest('strong')).not.toBeNull()
  expect(arabic.every(element => element.getAttribute('lang') === 'ar' && element.getAttribute('dir') === 'rtl')).toBe(true)
  expect(container.querySelector('p')?.textContent).toBe('Text قَالَ اللَّهُ clearly.')
  expect(container.querySelectorAll('li')[1]?.textContent).toBe('English stays English')
})
