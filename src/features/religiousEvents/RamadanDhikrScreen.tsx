import { useLocalization } from '../../localization'
import { BackButton, Screen } from '../../ui/Screen'
import { RecitationArticle } from '../../ui/RecitationArticle'
import { getRamadanDhikrContent, RAMADAN_DHIKR_TITLE_KEYS, type RamadanDhikrId } from './ramadanDhikrContent'

export function RamadanDhikrScreen({ dhikrId, onBack }: { dhikrId: RamadanDhikrId; onBack: () => void }) {
  const { t } = useLocalization()
  const title = t(RAMADAN_DHIKR_TITLE_KEYS[dhikrId])
  return <Screen label={title} top={<BackButton onClick={onBack} />}>
    <RecitationArticle title={title} content={getRamadanDhikrContent(dhikrId)}
      articleClassName="ramadan-dhikr-article" arabicClassName="ramadan-dhikr-arabic" />
  </Screen>
}
