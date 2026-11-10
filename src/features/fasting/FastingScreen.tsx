import { ActionRow } from '../../ui/controls'
import { BackButton, Screen } from '../../ui/Screen'
import { useLocalization } from '../../localization'
import { FASTING_DUA_IDS, FASTING_DUA_TITLE_KEYS, type FastingDuaId } from './fastingDuaContent'

export function FastingScreen({ onBack, onOpenDua }: { onBack: () => void; onOpenDua: (id: FastingDuaId) => void }) {
  const { t } = useLocalization()
  return <Screen label={t('fastingTitle')} top={<BackButton onClick={onBack} />} contentClassName="settings-menu">
    <div className="screen-stack">
      {FASTING_DUA_IDS.map(id => {
        const title = t(FASTING_DUA_TITLE_KEYS[id])
        return <ActionRow key={id} id={`fasting-dua-${id}`} title={title} aria-label={title} onClick={() => onOpenDua(id)} />
      })}
    </div>
  </Screen>
}
