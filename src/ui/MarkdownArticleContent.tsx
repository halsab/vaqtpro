import Markdown, { defaultUrlTransform } from 'react-markdown'

const ALLOWED_ELEMENTS = ['h1', 'h2', 'p', 'strong', 'em', 'ul', 'ol', 'li', 'blockquote', 'a']

export function MarkdownArticleContent({ content }: { content: string }) {
  return <div className="markdown-article">
    <Markdown allowedElements={ALLOWED_ELEMENTS} skipHtml urlTransform={defaultUrlTransform} components={{
      p: ({ children }) => typeof children === 'string' && /^\s*\p{Script=Arabic}/u.test(children)
        ? <p className="markdown-article-arabic" dir="rtl" lang="ar">{children}</p>
        : <p>{children}</p>,
      a: ({ href, children }) => {
        const external = /^https?:\/\//i.test(href ?? '')
        return <a href={href} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined}>{children}</a>
      },
    }}>{content}</Markdown>
  </div>
}
