import { useLocalization } from '../../localization'
import { BackButton, Screen } from '../../ui/Screen'
import { getRamadanDhikrContent, RAMADAN_DHIKR_TITLE_KEYS, type RamadanDhikrId } from './ramadanDhikrContent'

export function RamadanDhikrScreen({ dhikrId, onBack }: { dhikrId: RamadanDhikrId; onBack: () => void }) {
  const { t } = useLocalization()
  const title = t(RAMADAN_DHIKR_TITLE_KEYS[dhikrId])
  const content = getRamadanDhikrContent(dhikrId)

  return <Screen label={title} top={<BackButton onClick={onBack} />}>
    <article className="markdown-article ramadan-dhikr-article">
      <h1>{title}</h1>
      <h2>{t('ramadanDhikrArabic')}</h2>
      <p className="ramadan-dhikr-arabic" dir="rtl" lang="ar">{content.arabic}</p>
      <h2>{t('ramadanDhikrTranscription')}</h2>
      <p>{content.transcription}</p>
      <h2>{t('ramadanDhikrTranslation')}</h2>
      <p>{content.translation}</p>
    </article>
  </Screen>
}
