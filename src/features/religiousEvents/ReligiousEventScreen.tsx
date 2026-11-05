import { RELIGIOUS_EVENTS, type ReligiousEventId } from '../../domain/religiousEvents'
import { MarkdownArticle } from '../../ui/MarkdownArticle'
import { BackButton, Screen } from '../../ui/Screen'
import { getReligiousEventContent } from './religiousEventContent'
import { useLocalization } from '../../localization'
import { localizedEventTitle } from '../../localization/religiousEvents'
import { ActionRow } from '../../ui/controls'
import { RAMADAN_DHIKR_IDS, RAMADAN_DHIKR_TITLE_KEYS, type RamadanDhikrId } from './ramadanDhikrContent'

export function ReligiousEventScreen({ eventId, onBack, onOpenRamadanDhikr }: {
  eventId: ReligiousEventId
  onBack: () => void
  onOpenRamadanDhikr?: (id: RamadanDhikrId) => void
}) {
  const { locale, t } = useLocalization()
  const definition = RELIGIOUS_EVENTS.find(event => event.id === eventId)
  const resolved = getReligiousEventContent(eventId, locale)
  if (!definition) return null
  if (resolved.status !== 'resolved') return <Screen label={localizedEventTitle(eventId, locale)} top={<BackButton onClick={onBack} />}><p role="status">{t('contentUnavailable')}</p></Screen>

  return <Screen label={localizedEventTitle(eventId, locale)} top={<BackButton onClick={onBack} />}>
    {eventId === 'ramadan' && onOpenRamadanDhikr
      ? <div className="ramadan-article-flow">
        <div className="screen-stack">
          {RAMADAN_DHIKR_IDS.map(id => <ActionRow
            key={id}
            id={`ramadan-dhikr-${id}`}
            title={t(RAMADAN_DHIKR_TITLE_KEYS[id])}
            onClick={() => onOpenRamadanDhikr(id)}
          />)}
        </div>
        <MarkdownArticle content={resolved.content} />
      </div>
      : <MarkdownArticle content={resolved.content} />}
  </Screen>
}
