import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { automaticPreferences } from '../../domain/sourcePreferences'
import { createCityPlace } from '../../domain/place'
import * as prayerCalculation from '../../domain/prayerCalculation'
import { calculatePrayerSchedule } from '../../domain/prayerCalculation'
import { resolvePrayerTimeSource } from '../../domain/prayerSource'
import type { ScheduleContext } from '../../domain/scheduleContext'
import { PrayerMonthScreen } from './PrayerMonthScreen'
import { PRAYER_MONTH_KEYS } from './PrayerMonthTable'
import { buildScheduleEvents, SCHEDULE_EVENT_KEYS } from '../../domain/scheduleEvents'
import type { MonthlyExportView } from './monthlyExportModel'

const { prepareMonthlyPdf } = vi.hoisted(() => ({
  prepareMonthlyPdf: vi.fn<(view: MonthlyExportView) => Promise<File>>()
    .mockResolvedValue(new File(['pdf'], 'month.pdf', { type: 'application/pdf' })),
}))
vi.mock('./monthlyExportRenderer', () => ({ prepareMonthlyPdf }))

const place = createCityPlace({ id: 524901, name: 'Москва', countryCode: 'RU', admin1Code: '48', admin1Name: 'Москва',
  latitude: 55.7522, longitude: 37.6156, population: 10_381_222, timeZone: 'Europe/Moscow' }, 0)
const originalCalculatePrayerSchedule = calculatePrayerSchedule
const resolution = resolvePrayerTimeSource(place, automaticPreferences())
const context: ScheduleContext = {
  location: { id: place.id, latitude: place.latitude, longitude: place.longitude },
  date: '2026-10-28', timeZone: resolution.timeZone, mode: 'automatic', source: 'calculated', settings: resolution.settings,
}
const onRetrySchedule = vi.fn()

afterEach(() => {
  vi.restoreAllMocks()
  prepareMonthlyPdf.mockClear()
  onRetrySchedule.mockReset()
})

function renderMonth() {
  render(<PrayerMonthScreen place={place} context={context} scheduleError={null} selectedDate="2026-10-28"
    onBack={() => {}} onOpenLocation={() => {}} onRetrySchedule={onRetrySchedule} />)
}

it('shows one table row per date with all seven Home events in the same row', () => {
  renderMonth()
  const exportButton = screen.getByRole('button', { name: 'Экспортировать расписание на месяц' })
  expect(exportButton).toHaveClass('icon-button')
  expect(exportButton).toBeDisabled()
  expect(prepareMonthlyPdf).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Назад' })).toBeVisible()
  expect(screen.queryByRole('heading', { name: 'Расписание на месяц' })).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'октябрь 2026' })).toBeVisible()
  expect(document.querySelector('details, summary, .prayer-month-method')).toBeNull()
  expect(screen.queryByText(/Москва|Профиль расчёта|Метод расчёта Асра|Правило высоких широт/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Часовой пояс|Europe\/Moscow/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Слово «примерно»|Источник координат|сформировано|без интернета|официальное расписание мечети/i)).not.toBeInTheDocument()
  const rows = screen.getAllByRole('row')
  expect(rows).toHaveLength(32)
  const firstRow = rows[1]
  if (!firstRow) throw new Error('Monthly schedule must render the first date row')
  const firstDay = within(firstRow).getByRole('rowheader', { name: '01.10.2026' })
  expect(firstDay).toHaveTextContent(/^01 чт$/)
  expect(firstDay.querySelector('time')).toHaveAttribute('dateTime', '2026-10-01')
  expect(firstDay.querySelector('time')).toHaveAttribute('aria-label', '01.10.2026')
  expect(within(firstRow).getAllByRole('cell')).toHaveLength(7)
  expect(firstRow.querySelector('button, a')).toBeNull()
  expect(screen.getByRole('button', { name: 'Предыдущий месяц' })).toHaveClass('jelly-action')
  expect(screen.getByRole('button', { name: 'Следующий месяц' })).toHaveClass('jelly-action')
})


it('matches Home event labels, order, instants, values, and estimation for every date', () => {
  renderMonth()
  const expectedKeys = ['fajr', 'sunrise', 'zenith', 'dhuhr', 'asr', 'maghrib', 'isha']
  const expectedHeadings = ['Дата', 'Фаджр', 'Восход', 'Зенит', 'Зухр', 'Аср', 'Магриб', 'Иша']
  expect(SCHEDULE_EVENT_KEYS).toEqual(expectedKeys)
  expect(PRAYER_MONTH_KEYS).toEqual(expectedKeys)
  expect(screen.getAllByRole('columnheader').map(header => header.textContent)).toEqual(expectedHeadings)

  const rows = screen.getAllByRole('row').slice(1)
  expect(rows).toHaveLength(31)
  for (const [index, row] of rows.entries()) {
    const date = `2026-10-${String(index + 1).padStart(2, '0')}`
    const schedule = calculatePrayerSchedule(context.location, date, context.timeZone, context.settings)
    const events = buildScheduleEvents(schedule)
    expect(events.map(event => event.key)).toEqual(expectedKeys)
    const cells = within(row).getAllByRole('cell')
    expect(cells).toHaveLength(7)
    for (const [column, key] of PRAYER_MONTH_KEYS.entries()) {
      const event = events[column]
      if (!event) throw new Error('Missing schedule event for ' + key)
      const cell = cells[column]
      if (!cell) throw new Error('Missing month cell for ' + key)
      const time = cell.querySelector('time')
      expect(event.timeZone).toBe(context.timeZone)
      expect(time).toHaveAttribute('dateTime', new Date(event.instant).toISOString())
      expect(time).toHaveTextContent(event.time)
      const approx = cell.querySelector('.prayer-month-estimated')
      if (schedule.estimatedPrayers.includes(key)) {
        expect(approx).toHaveAccessibleName('Приблизительное время')
        expect(approx).toHaveTextContent('примерно')
      } else {
        expect(approx).toBeNull()
      }
    }
  }
})

it('preserves the Home estimated marker for Zenith without an alternate calculation', () => {
  vi.spyOn(prayerCalculation, 'calculatePrayerSchedule').mockImplementation((location, date, timeZone, settings) => {
    const schedule = originalCalculatePrayerSchedule(location, date, timeZone, settings)
    if (date !== '2026-10-10') return schedule
    return { ...schedule, estimatedPrayers: [...schedule.estimatedPrayers, 'zenith'] }
  })
  renderMonth()
  const row = screen.getByRole('row', { name: /10\.10\.2026/ })
  const zenith = within(row).getAllByRole('cell')[2]
  if (!zenith) throw new Error('Zenith column is missing')
  expect(zenith.querySelector('.prayer-month-estimated')).toHaveTextContent('примерно')
  expect(zenith.querySelector('time')).toHaveTextContent(
    originalCalculatePrayerSchedule(context.location, '2026-10-10', context.timeZone, context.settings).entries.zenith.time,
  )
})

it('renders all day numbers with full calendar dates for assistive technology', () => {
  renderMonth()
  const headers = screen.getAllByRole('rowheader')
  expect(headers.map(header => header.textContent)).toEqual([
    '01 чт', '02 пт', '03 сб', '04 вс', '05 пн', '06 вт', '07 ср', '08 чт', '09 пт', '10 сб',
    '11 вс', '12 пн', '13 вт', '14 ср', '15 чт', '16 пт', '17 сб', '18 вс', '19 пн', '20 вт',
    '21 ср', '22 чт', '23 пт', '24 сб', '25 вс', '26 пн', '27 вт', '28 ср', '29 чт', '30 пт', '31 сб',
  ])
  for (const [index, header] of headers.entries()) {
    const day = String(index + 1).padStart(2, '0')
    const time = header.querySelector('time')
    expect(header).toHaveAccessibleName(day + '.10.2026')
    expect(time).toHaveAttribute('dateTime', '2026-10-' + day)
    expect(time).toHaveAttribute('aria-label', day + '.10.2026')
    expect(header.querySelector('button, a')).toBeNull()
  }
})

it.each([
  ['2023-02-01', 28, '01 ср'],
  ['2024-02-01', 29, '01 чт'],
  ['2026-09-01', 30, '01 вт'],
  ['2026-10-01', 31, '01 чт'],
] as const)('renders the complete Gregorian month for %s', (selectedDate, dayCount, firstDay) => {
  render(<PrayerMonthScreen place={place} context={context} scheduleError={null} selectedDate={selectedDate}
    onBack={() => {}} onOpenLocation={() => {}} onRetrySchedule={onRetrySchedule} />)

  expect(screen.getAllByRole('row')).toHaveLength(dayCount + 1)
  expect(screen.getAllByRole('columnheader')).toHaveLength(8)
  expect(screen.getAllByRole('rowheader')[0]).toHaveTextContent(firstDay)
})

it('switches between complete months without selecting dates in the table', async () => {
  renderMonth()
  await userEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' }))
  expect(screen.getByRole('heading', { name: 'сентябрь 2026' })).toBeVisible()
  expect(screen.getAllByRole('row')).toHaveLength(31)
  expect(screen.getByRole('rowheader', { name: '01.09.2026' })).toHaveTextContent(/^01 вт$/)
  expect(screen.queryByRole('rowheader', { name: '31.10.2026' })).not.toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Следующий месяц' }))
  expect(screen.getByRole('heading', { name: 'октябрь 2026' })).toBeVisible()
  expect(screen.getAllByRole('row')).toHaveLength(32)
})

it('keeps the current calculation context for export without showing it on the monthly screen', async () => {
  renderMonth()
  expect(prepareMonthlyPdf).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Экспортировать расписание на месяц' }))
  await waitFor(() => expect(prepareMonthlyPdf).toHaveBeenCalledOnce())

  expect(prepareMonthlyPdf).toHaveBeenCalledWith(expect.objectContaining({
    month: '2026-10',
    location: 'Москва',
  }))
  const exportView = prepareMonthlyPdf.mock.calls[0]?.[0]
  const expectedFajr = calculatePrayerSchedule(context.location, '2026-10-01', context.timeZone, context.settings).entries.fajr
  expect(exportView?.rows[0]?.times[0]?.value).toBe(expectedFajr.time)
  expect(screen.queryByText('Москва')).not.toBeInTheDocument()
  expect(document.querySelector('details, summary, .prayer-month-method')).toBeNull()
})

it('keeps the monthly screen usable when a location has a skipped civil date', () => {
  const apiaPlace = createCityPlace({ id: 4035715, name: 'Апиа', countryCode: 'WS', admin1Code: '00', admin1Name: 'Apia',
    latitude: -13.8333, longitude: -171.7667, population: 0, timeZone: 'Pacific/Apia' }, 0)
  const apiaContext: ScheduleContext = { ...context,
    location: { id: apiaPlace.id, latitude: apiaPlace.latitude, longitude: apiaPlace.longitude },
    date: '2011-12-15', timeZone: 'Pacific/Apia' }

  expect(() => render(<PrayerMonthScreen place={apiaPlace} context={apiaContext} scheduleError={{ code: 'load-failed' }} selectedDate="2011-12-30"
    onBack={() => {}} onOpenLocation={() => {}} onRetrySchedule={onRetrySchedule} />)).not.toThrow()
  expect(screen.getByRole('region', { name: 'Расписание намаза за месяц' })).toBeVisible()
  const skippedDate = screen.getByRole('row', { name: /30\.12\.2011/ })
  expect(within(skippedDate).getAllByRole('cell')).toHaveLength(7)
  expect(within(skippedDate).getAllByLabelText('Время недоступно')).toHaveLength(7)
  expect(within(skippedDate).getAllByRole('cell').map(cell => cell.textContent)).toEqual(Array(7).fill('—'))
  expect(within(screen.getByRole('row', { name: /29\.12\.2011/ })).queryByLabelText('Время недоступно')).not.toBeInTheDocument()
  expect(within(screen.getByRole('row', { name: /31\.12\.2011/ })).queryByLabelText('Время недоступно')).not.toBeInTheDocument()
})

it('recalculates every month row from the current place, profile, and timezone', async () => {
  const { rerender } = render(<PrayerMonthScreen place={place} context={context} scheduleError={null} selectedDate="2026-10-28"
    onBack={() => {}} onOpenLocation={() => {}} onRetrySchedule={onRetrySchedule} />)
  await userEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' }))
  expect(screen.getByRole('heading', { name: 'сентябрь 2026' })).toBeVisible()

  const kazan = createCityPlace({ id: 551487, name: 'Казань', countryCode: 'RU', admin1Code: '73', admin1Name: 'Татарстан',
    latitude: 55.7961, longitude: 49.1064, population: 1_308_660, timeZone: 'Europe/Moscow' }, 0)
  const kazanResolution = resolvePrayerTimeSource(kazan, automaticPreferences())
  const kazanContext: ScheduleContext = { ...context,
    location: { id: kazan.id, latitude: kazan.latitude, longitude: kazan.longitude }, timeZone: kazanResolution.timeZone,
    settings: kazanResolution.settings }
  rerender(<PrayerMonthScreen place={kazan} context={kazanContext} scheduleError={null} selectedDate="2026-10-28"
    onBack={() => {}} onOpenLocation={() => {}} onRetrySchedule={onRetrySchedule} />)
  expect(screen.getByRole('heading', { name: 'сентябрь 2026' })).toBeVisible()
  expect(screen.queryByText(/Казань|Профиль расчёта/)).not.toBeInTheDocument()

  const firstFajr = () => screen.getAllByRole('row')[1]?.querySelector('td time')
  const expectedKazanFajr = calculatePrayerSchedule(kazanContext.location, '2026-09-01', kazanContext.timeZone, kazanContext.settings).entries.fajr
  expect(firstFajr()?.getAttribute('dateTime')).toBe(new Date(expectedKazanFajr.instant).toISOString())

  const profileContext: ScheduleContext = { ...kazanContext,
    settings: { ...kazanContext.settings, profile: 'turkey', asrMethod: 'hanafi' } }
  rerender(<PrayerMonthScreen place={kazan} context={profileContext} scheduleError={null} selectedDate="2026-10-28"
    onBack={() => {}} onOpenLocation={() => {}} onRetrySchedule={onRetrySchedule} />)
  expect(screen.queryByText(/Казань|Профиль расчёта|Турция/)).not.toBeInTheDocument()
  const expectedTurkeyFajr = calculatePrayerSchedule(profileContext.location, '2026-09-01', profileContext.timeZone, profileContext.settings).entries.fajr
  expect(firstFajr()?.getAttribute('dateTime')).toBe(new Date(expectedTurkeyFajr.instant).toISOString())

  const auckland = createCityPlace({ id: 2193733, name: 'Окленд', countryCode: 'NZ', admin1Code: 'E7', admin1Name: 'Auckland',
    latitude: -36.8485, longitude: 174.7633, population: 1_463_000, timeZone: 'Pacific/Auckland' }, 0)
  const aucklandResolution = resolvePrayerTimeSource(auckland, automaticPreferences())
  const aucklandContext: ScheduleContext = { ...profileContext,
    location: { id: auckland.id, latitude: auckland.latitude, longitude: auckland.longitude },
    timeZone: aucklandResolution.timeZone, settings: aucklandResolution.settings }
  rerender(<PrayerMonthScreen place={auckland} context={aucklandContext} scheduleError={null} selectedDate="2026-10-28"
    onBack={() => {}} onOpenLocation={() => {}} onRetrySchedule={onRetrySchedule} />)
  expect(screen.queryByText(/Окленд|Профиль расчёта/)).not.toBeInTheDocument()
  const expectedAucklandFajr = calculatePrayerSchedule(aucklandContext.location, '2026-09-01', aucklandContext.timeZone, aucklandContext.settings).entries.fajr
  expect(firstFajr()?.getAttribute('dateTime')).toBe(new Date(expectedAucklandFajr.instant).toISOString())
  expect(firstFajr()).toHaveTextContent(expectedAucklandFajr.time)
  expect(screen.getByRole('heading', { name: 'сентябрь 2026' })).toBeVisible()
})

it('keeps isolated calculation failures as unavailable placeholders without a broad error', () => {
  const calculate = vi.spyOn(prayerCalculation, 'calculatePrayerSchedule')
  calculate.mockImplementation((location, date, timeZone, settings) => {
    if (date === '2026-10-15') throw new RangeError('Skipped civil date')
    return originalCalculatePrayerSchedule(location, date, timeZone, settings)
  })

  renderMonth()

  const failedRow = screen.getByRole('row', { name: /15\.10\.2026/ })
  expect(within(failedRow).getAllByLabelText('Время недоступно')).toHaveLength(7)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(document.querySelector('details, summary, .prayer-month-method')).toBeNull()
  expect(within(screen.getByRole('row', { name: /14\.10\.2026/ })).queryAllByLabelText('Время недоступно')).toHaveLength(0)
  expect(within(screen.getByRole('row', { name: /16\.10\.2026/ })).queryAllByLabelText('Время недоступно')).toHaveLength(0)
})

it('shows an accessible retry when every date in the month fails', () => {
  vi.spyOn(prayerCalculation, 'calculatePrayerSchedule').mockImplementation(() => {
    throw new RangeError('Calculation unavailable')
  })

  renderMonth()

  expect(screen.queryByRole('table', { name: 'Расписание намаза за месяц' })).not.toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('Не удалось рассчитать расписание на месяц')
  expect(screen.getByRole('button', { name: 'Повторить' })).toBeVisible()
  expect(document.querySelector('details, summary, .prayer-month-method')).toBeNull()
})

it('recovers a fully failed month after retry without showing invented times', async () => {
  let shouldFail = true
  vi.spyOn(prayerCalculation, 'calculatePrayerSchedule').mockImplementation((location, date, timeZone, settings) => {
    if (shouldFail) throw new RangeError('Calculation unavailable')
    return originalCalculatePrayerSchedule(location, date, timeZone, settings)
  })
  renderMonth()
  expect(screen.getByRole('alert')).toBeVisible()

  shouldFail = false
  await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))

  await waitFor(() => expect(screen.getByRole('table', { name: 'Расписание намаза за месяц' })).toBeVisible())
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(document.querySelector('details, summary, .prayer-month-method')).toBeNull()
  expect(onRetrySchedule).toHaveBeenCalledOnce()
})

it('preserves unsupported-profile errors without rendering the removed summary', () => {
  render(<PrayerMonthScreen place={place} context={context} scheduleError={{ code: 'unsupported-profile', profile: 'turkey' }}
    selectedDate="2026-10-28" onBack={() => {}} onOpenLocation={() => {}} onRetrySchedule={onRetrySchedule} />)

  expect(screen.getByRole('alert')).toHaveTextContent('Турция')
  expect(document.querySelector('details, summary, .prayer-month-method')).toBeNull()
  expect(screen.getByRole('button', { name: 'Предыдущий месяц' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Следующий месяц' })).toBeVisible()
})

it('shows and retries an existing load-failed state when there is no calculation context', async () => {
  render(<PrayerMonthScreen place={place} context={null} scheduleError={{ code: 'load-failed' }} selectedDate="2026-10-28"
    onBack={() => {}} onOpenLocation={() => {}} onRetrySchedule={onRetrySchedule} />)

  expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить расписание')
  expect(document.querySelector('details, summary, .prayer-month-method')).toBeNull()
  expect(screen.queryByText('Сначала выберите место')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
  expect(onRetrySchedule).toHaveBeenCalledOnce()
})

it('keeps location recovery reachable without rendering the removed summary', () => {
  const onOpenLocation = vi.fn()
  render(<PrayerMonthScreen place={null} context={null} scheduleError={null} selectedDate="2026-10-28"
    onBack={() => {}} onOpenLocation={onOpenLocation} onRetrySchedule={onRetrySchedule} />)

  expect(screen.getByText('Сначала выберите место')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Локация' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Предыдущий месяц' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Следующий месяц' })).toBeVisible()
  expect(document.querySelector('details, summary, .prayer-month-method')).toBeNull()
})
