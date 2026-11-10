import { Children, cloneElement, isValidElement, type ReactNode } from 'react'
import Markdown, { defaultUrlTransform } from 'react-markdown'

const ALLOWED_ELEMENTS = ['h1', 'h2', 'p', 'strong', 'em', 'ul', 'ol', 'li', 'blockquote', 'a']
const ARABIC_RUN = /[\p{Script=Arabic}\p{Mark}\u0640\u200C-\u200F](?:[\p{Script=Arabic}\p{Mark}\u0640\u200C-\u200F\u060C\u061B\u061F\u06D4\u066A-\u066D]|[ \u00a0]+(?=[\p{Script=Arabic}\p{Mark}\u0640]))*/gu

function markArabicText(text: string): ReactNode {
  const output: ReactNode[] = []
  let offset = 0
  for (const match of text.matchAll(ARABIC_RUN)) {
    const index = match.index
    if (index > offset) output.push(text.slice(offset, index))
    output.push(<span className="markdown-arabic" dir="rtl" lang="ar" key={`ar-${index}`}>{match[0]}</span>)
    offset = index + match[0].length
  }
  if (!output.length) return text
  if (offset < text.length) output.push(text.slice(offset))
  return <>{output}</>
}

function markArabicChildren(children: ReactNode): ReactNode {
  return Children.map(children, child => {
    if (typeof child === 'string') return markArabicText(child)
    if (!isValidElement<{ children?: ReactNode }>(child) || child.props.children === undefined) return child
    return cloneElement(child, {}, markArabicChildren(child.props.children))
  })
}

export function MarkdownArticleContent({ content }: { content: string }) {
  return <div className="markdown-article">
    <Markdown allowedElements={ALLOWED_ELEMENTS} skipHtml urlTransform={defaultUrlTransform} components={{
      h1: ({ children, ...props }) => <h1 {...props}>{markArabicChildren(children)}</h1>,
      h2: ({ children, ...props }) => <h2 {...props}>{markArabicChildren(children)}</h2>,
      p: ({ children, ...props }) => <p {...props}>{markArabicChildren(children)}</p>,
      li: ({ children, ...props }) => <li {...props}>{markArabicChildren(children)}</li>,
      blockquote: ({ children, ...props }) => <blockquote {...props}>{markArabicChildren(children)}</blockquote>,
      a: ({ href, children }) => {
        const external = /^https?:\/\//i.test(href ?? '')
        return <a href={href} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined}>{markArabicChildren(children)}</a>
      },
    }}>{content}</Markdown>
  </div>
}
