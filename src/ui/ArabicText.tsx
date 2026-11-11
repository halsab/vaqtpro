import type { ReactNode } from 'react'

const ARABIC_RUN = /(?=\p{Script=Arabic})\p{Letter}(?:[\p{Script=Arabic}\p{Mark}\u0640\u200C-\u200F\u060C\u061B\u061F\u06D4\u066A-\u066D]|[ \u00a0]+(?=(?=\p{Script=Arabic})\p{Letter}))*/gu

/** Wrap Arabic runs for their shared design-system typography and bidi isolation. */
export function markArabicText(text: string, extraClassName?: string): ReactNode {
  const output: ReactNode[] = []
  let offset = 0
  for (const match of text.matchAll(ARABIC_RUN)) {
    const index = match.index
    if (index > offset) output.push(text.slice(offset, index))
    output.push(<span className={extraClassName ? `arabic-run ${extraClassName}` : 'arabic-run'}
      dir="rtl" lang="ar" key={`ar-${index}`}>{match[0]}</span>)
    offset = index + match[0].length
  }
  if (!output.length) return text
  if (offset < text.length) output.push(text.slice(offset))
  return <>{output}</>
}
