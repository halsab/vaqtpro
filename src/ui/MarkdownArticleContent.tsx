import { Children, cloneElement, isValidElement, type ReactNode } from 'react'
import Markdown, { defaultUrlTransform } from 'react-markdown'
import { markArabicText } from './ArabicText'

const ALLOWED_ELEMENTS = ['h1', 'h2', 'p', 'strong', 'em', 'ul', 'ol', 'li', 'blockquote', 'a']
function markArabicChildren(children: ReactNode): ReactNode {
  return Children.map(children, child => {
    if (typeof child === 'string') return markArabicText(child, 'markdown-arabic')
    if (!isValidElement<{ children?: ReactNode; className?: string }>(child)) return child
    if (child.type === 'span' && child.props.className?.split(/\s+/).includes('arabic-run')) return child
    if (child.props.children === undefined) return child
    return cloneElement(child, {}, markArabicChildren(child.props.children))
  })
}

function flatText(children: ReactNode): string {
  return Children.toArray(children).map(child => typeof child === 'string' ? child
    : isValidElement<{ children?: ReactNode }>(child) ? flatText(child.props.children) : '').join('')
}

const ARABIC_LEADING = /^\s*(?=\p{Script=Arabic})\p{Letter}/u
function blockDirection(children: ReactNode): 'rtl' | undefined {
  return ARABIC_LEADING.test(flatText(children)) ? 'rtl' : undefined
}

export function MarkdownArticleContent({ content }: { content: string }) {
  return <div className="markdown-article">
    <Markdown allowedElements={ALLOWED_ELEMENTS} skipHtml urlTransform={defaultUrlTransform} components={{
      h1: ({ children, ...props }) => <h1 {...props} dir={blockDirection(children)}>{markArabicChildren(children)}</h1>,
      h2: ({ children, ...props }) => <h2 {...props} dir={blockDirection(children)}>{markArabicChildren(children)}</h2>,
      p: ({ children, ...props }) => <p {...props} dir={blockDirection(children)}>{markArabicChildren(children)}</p>,
      li: ({ children, ...props }) => <li {...props} dir={blockDirection(children)}>{markArabicChildren(children)}</li>,
      blockquote: ({ children, ...props }) => <blockquote {...props} dir={blockDirection(children)}>{markArabicChildren(children)}</blockquote>,
      a: ({ href, children }) => {
        const external = /^https?:\/\//i.test(href ?? '')
        return <a href={href} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined}>{markArabicChildren(children)}</a>
      },
    }}>{content}</Markdown>
  </div>
}
