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

it('keeps Arabic-leading Markdown blocks RTL across nested formatting', async () => {
  const { container } = render(<MarkdownArticle content={'الْحَمْدُ **لِلَّهِ**.\n\nText á قَالَ اللَّهُ end.'} />)
  await screen.findByText('لِلَّهِ')
  const paragraphs = Array.from(container.querySelectorAll('p'))
  expect(paragraphs[0]?.getAttribute('dir')).toBe('rtl')
  expect(paragraphs[0]?.querySelector('strong .markdown-arabic')).not.toBeNull()
  expect(paragraphs[1]?.getAttribute('dir')).toBeNull()
  expect(paragraphs[1]?.textContent).toBe('Text á قَالَ اللَّهُ end.')
  expect(paragraphs[1]?.querySelectorAll('.markdown-arabic')).toHaveLength(1)
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
