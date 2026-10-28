import { useRef, type ReactNode, type RefObject } from 'react'
import {
  calendarDateFromCivil, civilDateFromCalendar, daysInCalendarMonth,
  type CalendarDate, type CalendarPreferences,
} from '../../domain/calendar'
import { BackButton, Screen } from '../../ui/Screen'
import { ActionRow, ActionButton, ScreenFooter } from '../../ui/controls'
import { useLocalization } from '../../localization'
import { calendarMonthLabels } from '../../localization/calendar'

interface SelectOption { value: string; label: string; disabled?: boolean }

function SelectRow({ label, value, options, onChange, selectRef }: {
  label: string; value: string; options: SelectOption[]; onChange: (value: string) => void
  selectRef?: RefObject<HTMLSelectElement | null>
}) {
  return <label className="pill pill-row date-field">
    <span aria-hidden="true">{label}</span>
    <span className="note" aria-hidden="true">{options.find(option => option.value === value)?.label}</span>
    <select ref={selectRef} aria-label={label} value={value} onChange={event => onChange(event.target.value)}>
      {options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
    </select>
  </label>
}

function numbers(first: number, last: number): SelectOption[] {
  return Array.from({ length: last - first + 1 }, (_, index) => ({ value: String(first + index), label: String(first + index) }))
}

export function DateScreen({ selectedDate, today, preferences, hijriSupported, onDateChange, onPreferencesChange,
  onOpenReligiousEvents, onBack, onOpenMonthlySchedule = () => {}, hasPlace = true, notice }: {
  selectedDate: string; today: string; preferences: CalendarPreferences; hijriSupported: boolean
  onDateChange: (date: string) => void; onPreferencesChange: (preferences: CalendarPreferences) => void
  onOpenReligiousEvents: () => void; onBack: () => void; onOpenMonthlySchedule?: () => void; hasPlace?: boolean; notice?: ReactNode
}) {
  const { locale, t } = useLocalization()
  const dayRef = useRef<HTMLSelectElement>(null)
  const { calendar, correction } = preferences
  const date = calendarDateFromCivil(selectedDate, calendar, correction)
  const currentYear = calendarDateFromCivil(today, calendar, correction).year
  const months = calendarMonthLabels(t, calendar, locale)
  const updateDate = (patch: Partial<CalendarDate>) => onDateChange(civilDateFromCalendar({ ...date, ...patch }, calendar, correction))

  return <Screen label={t('dateSetup')} top={<BackButton onClick={onBack} />} contentClassName="screen-center"
    bottom={selectedDate !== today ? <ScreenFooter><ActionButton variant="primary" onClick={() => {
      onDateChange(today)
      dayRef.current?.focus()
    }}>{t('today')}</ActionButton></ScreenFooter> : null}>
    <div className="screen-stack">
      <SelectRow label={t('calendar')} value={calendar} options={[
        { value: 'gregorian', label: t('gregorian') },
        { value: 'hijri', label: t('hijri'), disabled: !hijriSupported },
      ]} onChange={value => {
        if (value === 'gregorian' || (value === 'hijri' && hijriSupported)) onPreferencesChange({ ...preferences, calendar: value })
      }} />
      <SelectRow label={t('day')} selectRef={dayRef} value={String(date.day)} options={numbers(1, daysInCalendarMonth(date.year, date.month, calendar))} onChange={value => updateDate({ day: Number(value) })} />
      <SelectRow label={t('month')} value={String(date.month)} options={months.map((label, index) => ({ value: String(index + 1), label }))} onChange={value => updateDate({ month: Number(value) })} />
      <SelectRow label={t('year')} value={String(date.year)} options={numbers(Math.max(1, Math.min(currentYear - 100, date.year)), Math.max(currentYear + 100, date.year))} onChange={value => updateDate({ year: Number(value) })} />
      {calendar === 'hijri' ? <SelectRow label={t('dateCorrection')} value={String(correction)} options={[
        { value: '-1', label: t('dateMinusOne') }, { value: '0', label: '0' }, { value: '1', label: t('datePlusOne') },
      ]} onChange={value => {
        const correction = Number(value)
        if (correction === -1 || correction === 0 || correction === 1) onPreferencesChange({ ...preferences, correction })
      }} /> : null}
      <ActionRow title={t('monthlySchedule')} disabled={!hasPlace} onClick={onOpenMonthlySchedule} />
      <ActionRow id="date-religious-events" title={t('religiousEvents')} disabled={!hijriSupported} onClick={onOpenReligiousEvents} />
      {!hijriSupported ? <p className="note" role="status">{t('hijriUnsupported')}</p> : null}
      {notice}
    </div>
  </Screen>
}
