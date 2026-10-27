import { useMemo } from 'react'

import {
  calendarDateFromCivil,
  civilDateFromCalendar,
  type DateCorrection,
} from '../../domain/calendar'
import {
  listReligiousEventOccurrences,
  type ReligiousEventId,
  type ReligiousEventOccurrence,
} from '../../domain/religiousEvents'
import { BackButton, Screen } from '../../ui/Screen'
import { ActionButton, ActionRow } from '../../ui/controls'
import { formatReligiousEventOccurrenceDate } from './religiousEventDate'
import { useLocalization } from '../../localization'
import { localizedEventTitle } from '../../localization/religiousEvents'

export function ReligiousEventOccurrenceRow({ occurrence, onOpenEvent }: {
  occurrence: ReligiousEventOccurrence
  onOpenEvent: (eventId: ReligiousEventId) => void
}) {
  const { locale } = useLocalization()
  const id = `religious-event-${occurrence.civilDate}-${occurrence.eventId}`
  const contentId = occurrence.contentId
  const date = <span className="action-row-secondary">{formatReligiousEventOccurrenceDate(occurrence, locale)}</span>
  return <li>
    {contentId
      ? <ActionRow id={id} className="religious-event-list-row" title={localizedEventTitle(occurrence.eventId, locale, true)} secondary={date} onClick={() => onOpenEvent(contentId)} />
      : <div id={id} className="pill pill-row pill-row--stacked religious-event-list-row"><span className="action-row-title">{localizedEventTitle(occurrence.eventId, locale, true)}</span>{date}</div>}
  </li>
}

export function ReligiousEventsScreen({ today, correction, hijriSupported, onOpenEvent, onBack, loadError, loadPending, onRetryLoad }: {
  today: string
  correction: DateCorrection
  hijriSupported: boolean
  onOpenEvent: (eventId: ReligiousEventId) => void
  onBack: () => void
  loadError?: string | null
  loadPending?: boolean
  onRetryLoad?: () => void
}) {
  const { t } = useLocalization()
  const occurrences = useMemo(() => {
    const start = calendarDateFromCivil(today, 'gregorian')
    const toDateExclusive = civilDateFromCalendar({ ...start, year: start.year + 1 }, 'gregorian')
    return listReligiousEventOccurrences({ fromDate: today, toDateExclusive, correction, hijriSupported })
  }, [today, correction, hijriSupported])

  return <Screen label={t('religiousEvents')} top={<BackButton onClick={onBack} />}>
    {loadPending ? <p role="status" aria-live="polite">{t('loading')}</p> : null}
    {loadError ? <div role="alert"><p>{loadError}</p>{onRetryLoad ? <ActionButton onClick={onRetryLoad}>{t('retry')}</ActionButton> : null}</div> : null}
    <ul className="religious-events-list">
      {occurrences.map(occurrence => <ReligiousEventOccurrenceRow
        key={`${occurrence.civilDate}:${occurrence.eventId}`}
        occurrence={occurrence}
        onOpenEvent={onOpenEvent}
      />)}
    </ul>
  </Screen>
}
