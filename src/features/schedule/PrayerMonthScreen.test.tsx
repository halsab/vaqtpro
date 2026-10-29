import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'

import { automaticPreferences } from '../../domain/sourcePreferences'
import { createCityPlace } from '../../domain/place'
import { calculatePrayerSchedule } from '../../domain/prayerCalculation'
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

it('keeps the monthly screen usable when a location has a skipped civil date', () => {
  const apiaPlace = createCityPlace({ id: 4035715, name: 'Апиа', countryCode: 'WS', admin1Code: '00', admin1Name: 'Apia',
    latitude: -13.8333, longitude: -171.7667, population: 0, timeZone: 'Pacific/Apia' }, 0)
  const apiaContext: ScheduleContext = { ...context,
    location: { id: apiaPlace.id, latitude: apiaPlace.latitude, longitude: apiaPlace.longitude },
    date: '2011-12-15', timeZone: 'Pacific/Apia' }

  expect(() => render(<PrayerMonthScreen place={apiaPlace} context={apiaContext} scheduleError={{ code: 'load-failed' }} selectedDate="2011-12-30"
    onBack={() => {}} onOpenLocation={() => {}} />)).not.toThrow()
  expect(screen.getByRole('region', { name: 'Расписание намаза за месяц' })).toBeVisible()
  const skippedDate = screen.getByRole('row', { name: /30\.12\.2011/ })
  expect(within(skippedDate).getAllByRole('cell')).toHaveLength(6)
  expect(within(skippedDate).getAllByLabelText('Время недоступно')).toHaveLength(6)
  expect(within(screen.getByRole('row', { name: /29\.12\.2011/ })).queryByLabelText('Время недоступно')).not.toBeInTheDocument()
  expect(within(screen.getByRole('row', { name: /31\.12\.2011/ })).queryByLabelText('Время недоступно')).not.toBeInTheDocument()
})

it('recalculates every month row from the current place, profile, and timezone', async () => {
  const { rerender } = render(<PrayerMonthScreen place={place} context={context} scheduleError={null} selectedDate="2026-10-28"
    onBack={() => {}} onOpenLocation={() => {}} />)
  await userEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' }))
  expect(screen.getByRole('heading', { name: 'сентябрь 2026' })).toBeVisible()

  const kazan = createCityPlace({ id: 551487, name: 'Казань', countryCode: 'RU', admin1Code: '73', admin1Name: 'Татарстан',
    latitude: 55.7961, longitude: 49.1064, population: 1_308_660, timeZone: 'Europe/Moscow' }, 0)
  const kazanResolution = resolvePrayerTimeSource(kazan, automaticPreferences())
  const kazanContext: ScheduleContext = { ...context,
    location: { id: kazan.id, latitude: kazan.latitude, longitude: kazan.longitude }, timeZone: kazanResolution.timeZone,
    settings: kazanResolution.settings }
  rerender(<PrayerMonthScreen place={kazan} context={kazanContext} scheduleError={null} selectedDate="2026-10-28"
    onBack={() => {}} onOpenLocation={() => {}} />)
  expect(screen.getByRole('heading', { name: 'сентябрь 2026' })).toBeVisible()
  expect(screen.getByText(/Казань · Профиль расчёта/)).toBeVisible()

  const firstFajr = () => screen.getAllByRole('row')[1]?.querySelector('td time')
  const expectedKazanFajr = calculatePrayerSchedule(kazanContext.location, '2026-09-01', kazanContext.timeZone, kazanContext.settings).entries.fajr
  expect(firstFajr()?.getAttribute('dateTime')).toBe(new Date(expectedKazanFajr.instant).toISOString())

  const profileContext: ScheduleContext = { ...kazanContext,
    settings: { ...kazanContext.settings, profile: 'turkey', asrMethod: 'hanafi' } }
  rerender(<PrayerMonthScreen place={kazan} context={profileContext} scheduleError={null} selectedDate="2026-10-28"
    onBack={() => {}} onOpenLocation={() => {}} />)
  expect(screen.getByText(/Казань · Профиль расчёта · Турция/)).toBeVisible()
  const expectedTurkeyFajr = calculatePrayerSchedule(profileContext.location, '2026-09-01', profileContext.timeZone, profileContext.settings).entries.fajr
  expect(firstFajr()?.getAttribute('dateTime')).toBe(new Date(expectedTurkeyFajr.instant).toISOString())

  const auckland = createCityPlace({ id: 2193733, name: 'Окленд', countryCode: 'NZ', admin1Code: 'E7', admin1Name: 'Auckland',
    latitude: -36.8485, longitude: 174.7633, population: 1_463_000, timeZone: 'Pacific/Auckland' }, 0)
  const aucklandResolution = resolvePrayerTimeSource(auckland, automaticPreferences())
  const aucklandContext: ScheduleContext = { ...profileContext,
    location: { id: auckland.id, latitude: auckland.latitude, longitude: auckland.longitude },
    timeZone: aucklandResolution.timeZone, settings: aucklandResolution.settings }
  rerender(<PrayerMonthScreen place={auckland} context={aucklandContext} scheduleError={null} selectedDate="2026-10-28"
    onBack={() => {}} onOpenLocation={() => {}} />)
  expect(screen.getByText(/Окленд · Профиль расчёта/)).toBeVisible()
  const expectedAucklandFajr = calculatePrayerSchedule(aucklandContext.location, '2026-09-01', aucklandContext.timeZone, aucklandContext.settings).entries.fajr
  expect(firstFajr()?.getAttribute('dateTime')).toBe(new Date(expectedAucklandFajr.instant).toISOString())
  expect(firstFajr()).toHaveTextContent(expectedAucklandFajr.time)
  expect(screen.getByRole('heading', { name: 'сентябрь 2026' })).toBeVisible()
})
