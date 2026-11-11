import { useLocalization } from '../localization'

export interface RecitationContent {
  arabic: string
  transcription: string
  translation: string
}

/** Shared presentation for Ramadan dhikr and fasting duas, without a deferred module. */
export function RecitationArticle({ title, content, articleClassName, arabicClassName }: {
  title: string
  content: RecitationContent
  articleClassName?: string
  arabicClassName?: string
}) {
  const { locale, t } = useLocalization()
  const translation = selectTranslation(content.translation, locale)
  return <article className={`markdown-article recitation-article${articleClassName ? ` ${articleClassName}` : ''}`}>
    <h1>{title}</h1>
    <h2>{t('ramadanDhikrArabic')}</h2>
    <p className={`recitation-arabic${arabicClassName ? ` ${arabicClassName}` : ''}`} dir="rtl" lang="ar">{content.arabic}</p>
    <h2>{t('ramadanDhikrTranscription')}</h2>
    <p lang="tt-Cyrl" className="recitation-tatar">{content.transcription}</p>
    {translation ? <><h2 lang={translation.locale}>{t('ramadanDhikrTranslation')}</h2>
      <p lang={translation.locale}>{translation.text}</p></> : null}
  </article>
}

/** Present the source's Tatar and Russian sections without altering its wording. */
export function selectTranslation(source: string, locale: string): { locale: 'ru' | 'tt-Cyrl'; text: string } | null {
  const russianLabel = 'Перевод: '
  const tatarLabel = 'Мәгънәсе: '
  const tatarStart = source.indexOf(tatarLabel)
  const russianStart = source.indexOf(russianLabel)
  const tatar = tatarStart < 0 ? null : source.slice(tatarStart + tatarLabel.length, russianStart > tatarStart ? russianStart : undefined).trim()
  const russian = russianStart < 0 ? null : source.slice(russianStart + russianLabel.length).trim()
  if (locale === 'ru' && russian) return { locale: 'ru', text: russian }
  if (locale === 'tt' && tatar) return { locale: 'tt-Cyrl', text: tatar }
  return null
}
