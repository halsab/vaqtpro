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
  const { tatar, russian } = splitTranslations(content.translation)
  return <article className={`markdown-article recitation-article${articleClassName ? ` ${articleClassName}` : ''}`}>
    <h1>{title}</h1>
    <h2>{t('ramadanDhikrArabic')}</h2>
    <p className={`recitation-arabic${arabicClassName ? ` ${arabicClassName}` : ''}`} dir="rtl" lang="ar">{content.arabic}</p>
    <h2>{t('ramadanDhikrTranscription')}</h2>
    <p lang="tt-Cyrl" className="recitation-tatar">{content.transcription}</p>
    {tatar === null ? null : <>
      <h2 lang="tt-Cyrl" className="recitation-tatar">Мәгънәсе</h2>
      <p lang="tt-Cyrl" className="recitation-tatar">{tatar}</p>
    </>}
    <h2>{t('ramadanDhikrTranslation')}</h2>
    <p lang="ru">{russian}</p>
  </article>
}

/** Present the source's Tatar and Russian sections without altering its wording. */
function splitTranslations(source: string): { tatar: string | null; russian: string } {
  const russianLabel = 'Перевод: '
  const tatarLabel = 'Мәгънәсе: '
  const separator = '\n\n' + russianLabel
  if (source.startsWith(tatarLabel)) {
    const boundary = source.indexOf(separator)
    if (boundary !== -1) {
      return {
        tatar: source.slice(tatarLabel.length, boundary),
        russian: source.slice(boundary + separator.length),
      }
    }
  }
  return {
    tatar: null,
    russian: source.startsWith(russianLabel) ? source.slice(russianLabel.length) : source,
  }
}
