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
  const { t } = useLocalization()
  return <article className={`markdown-article recitation-article${articleClassName ? ` ${articleClassName}` : ''}`}>
    <h1>{title}</h1>
    <h2>{t('ramadanDhikrArabic')}</h2>
    <p className={`recitation-arabic${arabicClassName ? ` ${arabicClassName}` : ''}`} dir="rtl" lang="ar">{content.arabic}</p>
    <h2>{t('ramadanDhikrTranscription')}</h2>
    <p>{content.transcription}</p>
    <h2>{t('ramadanDhikrTranslation')}</h2>
    <p>{content.translation}</p>
  </article>
}
