import { BackButton, Screen } from '../../ui/Screen'
import { useLocalization } from '../../localization'
import { getFastingDuaContent, FASTING_DUA_TITLE_KEYS, type FastingDuaId } from './fastingDuaContent'

export function FastingDuaScreen({ duaId, onBack }: { duaId: FastingDuaId; onBack: () => void }) {
  const { t } = useLocalization()
  const title = t(FASTING_DUA_TITLE_KEYS[duaId])
  const content = getFastingDuaContent(duaId)

  return <Screen label={title} top={<BackButton onClick={onBack} />}>
    <article className="markdown-article ramadan-dhikr-article">
      <h1>{title}</h1>
      <h2>{t('fastingDuaArabic')}</h2>
      <p className="ramadan-dhikr-arabic" dir="rtl" lang="ar">{content.arabic}</p>
      <h2>{t('fastingDuaTranscription')}</h2>
      <p>{content.transcription}</p>
      <h2>{t('fastingDuaTranslation')}</h2>
      <p>{content.translation}</p>
    </article>
  </Screen>
}
