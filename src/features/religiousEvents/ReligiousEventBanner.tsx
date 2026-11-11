import { ActionButton } from '../../ui/controls'
import type { ReligiousBannerState, ReligiousEventId } from '../../domain/religiousEvents'
import { useLocalization } from '../../localization'
import { localizedEventTitle } from '../../localization/religiousEvents'
import { markArabicText } from '../../ui/ArabicText'

export function ReligiousEventBanner({ state, onOpen }: {
  state: ReligiousBannerState
  onOpen: (eventId: ReligiousEventId, origin: HTMLElement) => void
}) {
  const { locale, t } = useLocalization()
  const contentId = state.contentId
  const title = localizedEventTitle(state.eventId, locale)
  const secondaryText = state.secondary?.type === 'days'
    ? state.secondary.count === 1 ? t('tomorrow') : t('inDays', { count: state.secondary.count })
    : state.secondary?.type === 'event-days'
      ? state.secondary.count === 1
        ? t('eventCountdownTomorrow', { event: localizedEventTitle(state.secondary.eventId, locale) })
        : t('eventCountdown', { event: localizedEventTitle(state.secondary.eventId, locale), count: state.secondary.count })
      : null
  const content = <>
    <span className="religious-event-banner-title">{markArabicText(title)}</span>
    {secondaryText ? <span className="religious-event-banner-secondary">{markArabicText(secondaryText)}</span> : null}
  </>

  return contentId
    ? <ActionButton id="religious-event-banner" className="religious-event-banner"
        aria-label={[title, secondaryText].filter(Boolean).join(' ')} onClick={event => onOpen(contentId, event.currentTarget)}>{content}</ActionButton>
    : <div id="religious-event-banner" className="religious-event-banner">{content}</div>
}
