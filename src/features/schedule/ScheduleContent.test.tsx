import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { calculatePrayerSchedule } from '../../domain/prayerCalculation'
import type { CalculatedPrayerKey } from '../../domain/types'
import { ScheduleContent } from './ScheduleContent'
import { SCHEDULE_EVENT_KEYS } from '../../domain/scheduleEvents'

const date = '2026-05-05'
const day = calculatePrayerSchedule({ latitude: 55.79, longitude: 49.12 }, date, 'Europe/Moscow')
const base = {
  schedule: day, schedules: [day], scheduleLoading: false, scheduleError: null,
  selectedDate: date, today: date, currentTime: new Date('2026-05-05T09:00:00Z'), contextReady: true,
  now: () => new Date('2026-05-05T09:00:00Z'), onChangeDate: () => {}, onRetrySchedule: () => {},
}

describe('calculated schedule view', () => {
  it('hides old times and countdown while loading or after a calculation error', () => {
    const { rerender } = render(<ScheduleContent {...base} />)
    rerender(<ScheduleContent {...base} scheduleLoading />)
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeVisible()
    rerender(<ScheduleContent {...base} scheduleError={{ code: 'load-failed' }} />)
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeVisible()
  })

  it('does not show a current marker or live countdown for another date', () => {
    render(<ScheduleContent {...base} today="2026-05-06" />)
    const activeRows = screen.getAllByRole('listitem').filter(row => row.getAttribute('aria-current') === 'true')
    expect(activeRows).toHaveLength(0)
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сегодня' })).toBeVisible()
  })

  it('renders solar zenith without redundant calculated label while preserving its time and event semantics', () => {
    render(<ScheduleContent {...base} />)
    const zenith = screen.getByText('Зенит').closest('li')
    expect(zenith).not.toBeNull()
    expect(zenith).toHaveTextContent(day.entries.zenith.time)
    expect(zenith).not.toHaveTextContent('расчётное')
    expect(zenith?.querySelector('.event-provenance')).toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(7)
    expect(zenith?.querySelector('time')).toHaveAttribute('datetime', new Date(day.entries.zenith.instant).toISOString())
  })

  it('uses the same canonical seven-event set and localized labels as the month table', () => {
    render(<ScheduleContent {...base} />)
    expect(SCHEDULE_EVENT_KEYS).toEqual(['fajr', 'sunrise', 'zenith', 'dhuhr', 'asr', 'maghrib', 'isha'])
    expect(screen.getAllByRole('listitem').map(row => row.querySelector('.event-name > span')?.textContent))
      .toEqual(['Фаджр', 'Восход', 'Зенит', 'Зухр', 'Аср', 'Магриб', 'Иша'])
  })

  it('shows calculated prayers without obsolete congregation times', () => {
    render(<ScheduleContent {...base} />)
    expect(screen.getByRole('list')).toBeVisible()
    expect(screen.getByRole('timer')).toBeVisible()
    expect(screen.getAllByRole('listitem')).toHaveLength(7)
    expect(screen.queryByText(/в мечети/u)).not.toBeInTheDocument()
  })

  it('labels estimated times with a word instead of an approximation symbol', () => {
    const estimatedDay = { ...day, estimatedPrayers: ['fajr'] as CalculatedPrayerKey[] }
    render(<ScheduleContent {...base} schedule={estimatedDay} schedules={[estimatedDay]} />)

    expect(screen.getByText('примерно')).toBeVisible()
    expect(screen.queryByText('≈')).not.toBeInTheDocument()
  })
})
