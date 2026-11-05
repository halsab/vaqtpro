import { MarkdownArticle } from '../../ui/MarkdownArticle'
import { BackButton, Screen } from '../../ui/Screen'
import { useLocalization } from '../../localization'
import { getFastingDuaContent, FASTING_DUA_TITLE_KEYS, type FastingDuaId } from './fastingDuaContent'

export function FastingDuaScreen({ duaId, onBack }: { duaId: FastingDuaId; onBack: () => void }) {
  const { t } = useLocalization()
  const title = t(FASTING_DUA_TITLE_KEYS[duaId])
  return <Screen label={title} top={<BackButton onClick={onBack} />}>
    <MarkdownArticle content={getFastingDuaContent(duaId)} />
  </Screen>
}
