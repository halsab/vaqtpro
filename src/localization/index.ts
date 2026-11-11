export * from './locale'
export * from './formatters'
export * from './countdown'
export * from './messages'

import { useMemo } from 'react'
import { createTranslator } from './messages'
import { useLocalizationSnapshot } from './locale'

export function useLocalization() {
  const { locale, preference } = useLocalizationSnapshot()
  const t = useMemo(() => createTranslator(locale), [locale])
  return { locale, preference, t }
}
