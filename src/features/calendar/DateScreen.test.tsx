import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { DEFAULT_CALENDAR_PREFERENCES } from '../../domain/calendar'
import { DateScreen } from './DateScreen'

function renderDateScreen(hijriSupported = true) {
  const onDateChange = vi.fn()
  const onOpenReligiousEvents = vi.fn()
  const onOpenMonthlySchedule = vi.fn()
  const onPreferencesChange = vi.fn()
  render(<DateScreen
    selectedDate="2026-01-01"
    today="2026-01-01"
    preferences={DEFAULT_CALENDAR_PREFERENCES}
    hijriSupported={hijriSupported}
    onDateChange={onDateChange}
    onPreferencesChange={onPreferencesChange}
    onOpenReligiousEvents={onOpenReligiousEvents}
    onOpenMonthlySchedule={onOpenMonthlySchedule}
    onBack={() => {}}
  />)
  return { onDateChange, onOpenReligiousEvents, onOpenMonthlySchedule, onPreferencesChange }
}

it('opens the event list without changing the selected date or calendar', async () => {
  const { onDateChange, onOpenReligiousEvents, onPreferencesChange } = renderDateScreen()
  await userEvent.click(screen.getByRole('button', { name: 'Праздники и события' }))

  expect(onOpenReligiousEvents).toHaveBeenCalledOnce()
  expect(onDateChange).not.toHaveBeenCalled()
  expect(onPreferencesChange).not.toHaveBeenCalled()
})

it('opens the monthly timetable for the selected date without changing date preferences', async () => {
  const { onDateChange, onOpenMonthlySchedule, onPreferencesChange } = renderDateScreen()
  const monthlyScheduleButton = screen.getByRole('button', { name: 'Расписание на месяц' })
  expect(monthlyScheduleButton).toHaveTextContent(/^Расписание на месяц$/)
  expect(monthlyScheduleButton).toHaveAttribute('id', 'date-monthly-schedule')
  await userEvent.click(monthlyScheduleButton)

  expect(onOpenMonthlySchedule).toHaveBeenCalledOnce()
  expect(onDateChange).not.toHaveBeenCalled()
  expect(onPreferencesChange).not.toHaveBeenCalled()
})

it('does not open events when Hijri support is unavailable', async () => {
  const { onOpenReligiousEvents } = renderDateScreen(false)
  const button = screen.getByRole('button', { name: 'Праздники и события' })

  expect(button).toBeDisabled()
  await userEvent.click(button)
  expect(onOpenReligiousEvents).not.toHaveBeenCalled()
})
