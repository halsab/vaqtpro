import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'

import { automaticPreferences } from '../../domain/sourcePreferences'
import { createCityPlace } from '../../domain/place'
import { resolvePrayerTimeSource } from '../../domain/prayerSource'
import type { ScheduleContext } from '../../domain/scheduleContext'
import { PrayerMonthScreen } from './PrayerMonthScreen'

const place = createCityPlace({ id: 524901, name: 'Москва', countryCode: 'RU', admin1Code: '48', admin1Name: 'Москва',
  latitude: 55.7522, longitude: 37.6156, population: 10_381_222, timeZone: 'Europe/Moscow' }, 0)
const resolution = resolvePrayerTimeSource(place, automaticPreferences())
const context: ScheduleContext = {
  location: { id: place.id, latitude: place.latitude, longitude: place.longitude },
  date: '2026-10-28', timeZone: resolution.timeZone, mode: 'automatic', source: 'calculated', settings: resolution.settings,
}

function renderMonth() {
  render(<PrayerMonthScreen place={place} context={context} scheduleError={null} selectedDate="2026-10-28"
    onBack={() => {}} onOpenLocation={() => {}} />)
}

it('shows one table row per date with the date and six prayer times in the same row', () => {
  renderMonth()
  expect(screen.queryByRole('heading', { name: 'Расписание на месяц' })).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'октябрь 2026' })).toBeVisible()
  expect(screen.getByText('Москва · Профиль расчёта · Россия')).toBeVisible()
  expect(screen.queryByText(/Часовой пояс|Europe\/Moscow/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Слово «примерно»|Источник координат|сформировано|без интернета|официальное расписание мечети/i)).not.toBeInTheDocument()
  const rows = screen.getAllByRole('row')
  expect(rows).toHaveLength(32)
  const firstRow = rows[1]
  if (!firstRow) throw new Error('Monthly schedule must render the first date row')
  expect(within(firstRow).getByRole('rowheader')).toHaveTextContent('01.10.2026')
  expect(within(firstRow).getAllByRole('cell')).toHaveLength(6)
  expect(firstRow.querySelector('button, a')).toBeNull()
  expect(screen.getByText(/Профиль расчёта/).closest('details')).not.toHaveAttribute('open')
  expect(screen.getByRole('button', { name: 'Предыдущий месяц' })).toHaveClass('jelly-action')
  expect(screen.getByRole('button', { name: 'Следующий месяц' })).toHaveClass('jelly-action')
})

it('switches between complete months without selecting dates in the table', async () => {
  renderMonth()
  await userEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' }))
  expect(screen.getByRole('heading', { name: 'сентябрь 2026' })).toBeVisible()
  expect(screen.getAllByRole('row')).toHaveLength(31)
  expect(screen.getByText('01.09.2026')).toBeVisible()
  expect(screen.queryByText('31.10.2026')).not.toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Следующий месяц' }))
  expect(screen.getByRole('heading', { name: 'октябрь 2026' })).toBeVisible()
  expect(screen.getAllByRole('row')).toHaveLength(32)
})
