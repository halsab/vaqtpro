import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { failure, success } from '../../domain/result'
import { createCityPlace, createGpsPlace, createLocalityPlace, withNearbyCity } from '../../domain/place'
import { restoreRecentPlaces } from '../../domain/recentPlaces'
import type { CitySearchResult } from '../../data/cityCatalog'
import { LocationScreen, SearchScreen } from './LocationScreens'
const location = { id: 'kazan', name: 'Казань', latitude: 55.79, longitude: 49.11 }
const city = { id: 1, name: 'Москва', countryCode: 'RU', admin1Code: '48', admin1Name: 'Москва', latitude: 55.75, longitude: 37.61, population: 100, timeZone: 'Europe/Moscow' }
const searchProps = { locations: [location], catalogStatus: 'ready' as const, onLoadCities: vi.fn(), onBack: vi.fn(), onSelectLocality: vi.fn(), onSelectCity: vi.fn(), onSearchCities: vi.fn().mockResolvedValue(success({ cities: [city], status: 'complete', missingPackages: [] })) }
describe('экраны локации', () => {
  it('объясняет запрос разрешения на первом запуске без запуска GPS', () => {
    const onLocate = vi.fn()
    render(<LocationScreen initial place={null} recentPlaces={[]} onSelectRecent={vi.fn()} onBack={vi.fn()} onSearch={vi.fn()} onLocate={onLocate} />)
    expect(screen.getByText('Браузер запросит доступ к геопозиции. При необходимости город можно выбрать вручную.')).toBeVisible()
    expect(onLocate).not.toHaveBeenCalled()
  })
  it('показывает координаты и точность GPS в компактном формате', () => {
    const gps = createGpsPlace({ latitude: 55.79631, longitude: 49.10881, accuracy: 120, timestamp: 0 }, 'Europe/Moscow', null, 'gps:1')
    const { rerender } = render(<LocationScreen place={gps} recentPlaces={[]} onSelectRecent={vi.fn()} onBack={vi.fn()} onSearch={vi.fn()} onLocate={vi.fn()} />)
    expect(screen.getByText('55.7963, 49.1088')).toBeVisible()
    expect(screen.getByText('Точность ±120 м')).toBeVisible()
    rerender(<LocationScreen place={{ ...gps, accuracy: 2400 }} recentPlaces={[]} onSelectRecent={vi.fn()} onBack={vi.fn()} onSearch={vi.fn()} onLocate={vi.fn()} />)
    expect(screen.getByText('Точность ±2,4 км')).toBeVisible()
    rerender(<LocationScreen place={{ ...gps, accuracy: null }} recentPlaces={[]} onSelectRecent={vi.fn()} onBack={vi.fn()} onSearch={vi.fn()} onLocate={vi.fn()} />)
    expect(screen.getByText('Точность неизвестна')).toBeVisible()
  })
  it('показывает, что timezone GPS берётся с устройства', () => {
    const gps = createGpsPlace({ latitude: 48.85, longitude: 2.35, accuracy: 80, timestamp: 0 }, 'America/Los_Angeles', null, 'gps:paris')
    render(<LocationScreen place={gps} recentPlaces={[]} currentTime={new Date('2026-07-01T12:00:00Z')} onSelectRecent={vi.fn()} onBack={vi.fn()} onSearch={vi.fn()} onLocate={vi.fn()} />)
    expect(screen.getByText('America/Los_Angeles')).toBeVisible()
    expect(screen.getByText('(UTC−7)')).toBeVisible()
  })
  it('показывает timezone выбранного города из каталога', () => {
    const catalogPlace = createCityPlace(city, 0)
    render(<LocationScreen place={catalogPlace} recentPlaces={[]} onSelectRecent={vi.fn()} onBack={vi.fn()} onSearch={vi.fn()} onLocate={vi.fn()} />)
    expect(screen.getByText('Europe/Moscow')).toBeVisible()
  })
  it('отмечает полное название GPS как ближайший населённый пункт', () => {
    const gps = withNearbyCity(createGpsPlace({ latitude: 55.79631, longitude: 49.10881, accuracy: 120, timestamp: 0 }, 'Europe/Moscow', null, 'gps:1'), { ...city, name: 'Казань', admin1Code: '73', admin1Name: 'Татарстан', latitude: 55.79, longitude: 49.12 })
    render(<LocationScreen place={gps} recentPlaces={[]} onSelectRecent={vi.fn()} onBack={vi.fn()} onSearch={vi.fn()} onLocate={vi.fn()} />)
    expect(screen.getByText('Ближайший населённый пункт: Казань, Татарстан, РФ')).toBeVisible()
  })
  it.each([
    [{ status: 'locating' as const }, 'Определяем местоположение…'],
    [{ status: 'refining' as const }, 'Местоположение найдено. Уточняем…'],
    [{ status: 'ready' as const, lowAccuracy: true }, 'Местоположение определено с низкой точностью'],
  ])('показывает релевантный GPS status %#', (gpsState, message) => {
    const gps = createGpsPlace({ latitude: 55.79, longitude: 49.12, accuracy: 1200, timestamp: 0 }, 'Europe/Moscow', null, 'gps:1')
    render(<LocationScreen place={gps} recentPlaces={[]} gpsState={gpsState} onAcceptGps={vi.fn()} onSelectRecent={vi.fn()} onBack={vi.fn()} onSearch={vi.fn()} onLocate={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent(message)
  })
  it('позволяет принять provisional point и повторить low-accuracy поиск', async () => {
    const onAcceptGps = vi.fn()
    const onLocate = vi.fn()
    const gps = createGpsPlace({ latitude: 55.79, longitude: 49.12, accuracy: 1200, timestamp: 0 }, 'Europe/Moscow', null, 'gps:1')
    render(<LocationScreen place={gps} recentPlaces={[]} gpsState={{ status: 'ready', lowAccuracy: true }} onAcceptGps={onAcceptGps} onSelectRecent={vi.fn()} onBack={vi.fn()} onSearch={vi.fn()} onLocate={onLocate} />)
    await userEvent.click(screen.getByRole('button', { name: 'Использовать эту точку' }))
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(onAcceptGps).toHaveBeenCalledOnce()
    expect(onLocate).toHaveBeenCalledOnce()
  })
  it.each([
    ['offline', 'Нет интернета. Используем координаты.'],
    ['failed', 'Название места определить не удалось. Используем координаты.'],
    ['not-found', 'Ближайший населённый пункт не найден. Используем координаты.'],
  ] as const)('отделяет результат name lookup %s от GPS', (nameLookupState, message) => {
    const gps = createGpsPlace({ latitude: 55.79, longitude: 49.12, accuracy: 120, timestamp: 0 }, 'Europe/Moscow', null, 'gps:1')
    render(<LocationScreen place={gps} recentPlaces={[]} nameLookupState={nameLookupState} onSelectRecent={vi.fn()} onBack={vi.fn()} onSearch={vi.fn()} onLocate={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent(message)
  })
  it.each([
    ['denied', 'Доступ к геопозиции запрещён. Разрешите доступ в настройках браузера или выберите город вручную.'],
    ['unsupported', 'Этот браузер не поддерживает геопозицию. Выберите город вручную.'],
    ['timeout', 'Не удалось определить местоположение вовремя. Попробуйте ещё раз или выберите город вручную.'],
    ['unavailable', 'Устройство не смогло определить геопозицию. Проверьте службы геолокации и попробуйте снова.'],
  ] as const)('показывает конкретную GPS error %s и сохраняет ручной поиск', (reason, message) => {
    render(<LocationScreen place={null} recentPlaces={[]} gpsState={{ status: 'error', reason }} onSelectRecent={vi.fn()} onBack={vi.fn()} onSearch={vi.fn()} onLocate={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('button', { name: 'Найти город' })).toBeEnabled()
  })
  it('сокращает страну в поиске, сохраняя полное доступное название', async () => {
    render(<SearchScreen {...searchProps} />)
    await userEvent.type(screen.getByRole('searchbox'), 'Москва')
    const result = await screen.findByRole('button', { name: 'Москва, Москва, Россия' })
    expect(result).toHaveTextContent('Москва, РФ')
  })
  it('сокращает старые подписи текущего и недавнего места без изменения данных', () => {
    const place = createCityPlace(city, 0)
    const recent = createCityPlace({ ...city, id: 2, name: 'Киров', admin1Name: 'Кировская область' }, 0)
    render(<LocationScreen place={place} recentPlaces={[recent]} onSelectRecent={vi.fn()} onBack={vi.fn()} onSearch={vi.fn()} onLocate={vi.fn()} />)
    expect(screen.getByText('Москва, Москва, РФ')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Киров' })).toBeVisible()
    expect(place.name).toBe('Москва, Москва, Россия')
  })
  it('не теряет результаты при пробеле после уже найденного названия', async () => {
    const onSearchCities = vi.fn().mockResolvedValue(success({ cities: [city], status: 'complete', missingPackages: [] }))
    render(<SearchScreen {...searchProps} onSearchCities={onSearchCities} />)
    await userEvent.type(screen.getByRole('searchbox'), 'Москва')
    await screen.findByRole('button', { name: /Москва/ })
    await userEvent.type(screen.getByRole('searchbox'), ' ')
    expect(screen.getByRole('button', { name: /Москва/ })).toBeVisible()
    expect(onSearchCities).toHaveBeenCalledTimes(1)
  })
  it('выбирает недавний город одним тапом без подтверждения', async () => {
    const onSelectRecent = vi.fn()
    render(<LocationScreen place={createLocalityPlace(location, 0)} recentPlaces={[createLocalityPlace({ ...location, id: 'ufa', name: 'Уфа' }, 0)]} onSelectRecent={onSelectRecent} onBack={vi.fn()} onSearch={vi.fn()} onLocate={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Уфа' }))
    expect(onSelectRecent).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Выбрать' })).not.toBeInTheDocument()
  })
  it('показывает неназванную GPS-точку с локализованным названием и сохранёнными координатами', async () => {
    const saved = createGpsPlace({ latitude: 40.7128, longitude: -74.006, accuracy: 35, timestamp: 123 }, 'Europe/Moscow', null, 'gps:history:ny')
    const onSelectRecent = vi.fn()
    render(<LocationScreen place={createLocalityPlace(location, 0)} recentPlaces={[saved]} onSelectRecent={onSelectRecent} onBack={vi.fn()} onSearch={vi.fn()} onLocate={vi.fn()} />)
    const row = screen.getByRole('button', { name: 'Точка, 40.7128, -74.0060' })
    expect(row).toBeVisible()
    await userEvent.click(row)
    expect(onSelectRecent).toHaveBeenCalledWith(saved)
  })
  it('shows exactly the approved three recent-place display variants with matching accessible labels', async () => {
    const kazan = createCityPlace({ ...city, id: 10, name: 'Казань', admin1Name: 'Татарстан', admin1Code: '73' }, 100)
    const gpsFix = { latitude: 55.7231, longitude: 49.1742, accuracy: 20, timestamp: 200 }
    const namedGps = withNearbyCity(createGpsPlace(gpsFix, 'Europe/Moscow', null, 'gps:history:named'),
      { ...city, id: 10, name: 'Казань', admin1Code: '73', latitude: 55.79, longitude: 49.12 })
    // A stale legacy Place.name must not override the validated saved nearby-city label.
    const gpsWithLegacyName = { ...namedGps, name: 'Рядом: устаревшая подпись' }
    const unnamedGps = createGpsPlace({ ...gpsFix, latitude: 56.1231 }, 'Europe/Moscow', null, 'gps:history:unnamed')
    const onSelectRecent = vi.fn()
    render(<LocationScreen place={createLocalityPlace({ ...location, id: 'ufa', name: 'Уфа' }, 0)}
      recentPlaces={[kazan, gpsWithLegacyName, unnamedGps]} onSelectRecent={onSelectRecent}
      onBack={vi.fn()} onSearch={vi.fn()} onLocate={vi.fn()} />)
    const recent = screen.getByRole('region', { name: 'Недавние места' })
    const manual = screen.getByRole('button', { name: 'Казань' })
    const named = screen.getByRole('button', { name: 'Казань · GPS, 55.7231, 49.1742' })
    const point = screen.getByRole('button', { name: 'Точка, 56.1231, 49.1742' })
    expect(manual).toHaveTextContent('Казань')
    expect(manual).not.toHaveTextContent('GPS')
    expect(manual).not.toHaveTextContent('55.7231')
    expect(named).toHaveTextContent('Казань · GPS')
    expect(named).toHaveTextContent('55.7231, 49.1742')
    expect(point).toHaveTextContent('Точка')
    expect(point).toHaveTextContent('56.1231, 49.1742')
    expect(recent).not.toHaveTextContent('Сохранённая точка')
    expect(recent).not.toHaveTextContent('Рядом с')
    await userEvent.click(named)
    expect(onSelectRecent).toHaveBeenCalledWith(gpsWithLegacyName)
    expect(namedGps.latitude).toBe(55.7231)
    expect(namedGps.longitude).toBe(49.1742)
  })
  it('preserves comma-containing names for both restored manual and GPS history including keyboard access', async () => {
    const compoundName = 'Остров, Северный'
    const manual = createCityPlace({ ...city, id: 42, name: compoundName, admin1Name: 'Регион, Восток' }, 100)
    const gps = withNearbyCity(createGpsPlace({ latitude: 55.75, longitude: 37.61, accuracy: 40, timestamp: 200 },
      'Europe/Moscow', null, 'gps:history:compound'), { ...city, id: 42, name: compoundName, admin1Name: 'Регион, Восток' })
    const restored = restoreRecentPlaces([manual, gps])
    const onSelectRecent = vi.fn()
    render(<LocationScreen place={createLocalityPlace(location, 0)} recentPlaces={restored}
      onSelectRecent={onSelectRecent} onBack={vi.fn()} onSearch={vi.fn()} onLocate={vi.fn()} />)
    const history = screen.getByRole('region', { name: 'Недавние места' })
    const manualRow = within(history).getByRole('button', { name: compoundName })
    const gpsRow = within(history).getByRole('button', { name: 'Остров, Северный · GPS, 55.7500, 37.6100' })
    expect(manualRow).toHaveTextContent(compoundName)
    expect(manualRow).not.toHaveTextContent('Регион, Восток')
    expect(gpsRow).toHaveTextContent(compoundName + ' · GPS')
    expect(gpsRow).toHaveTextContent('55.7500, 37.6100')
    manualRow.focus()
    expect(manualRow).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(onSelectRecent).toHaveBeenCalledWith(restored[0])
    gpsRow.focus()
    await userEvent.keyboard(' ')
    expect(onSelectRecent).toHaveBeenCalledWith(restored[1])
    expect(restored[0]).toMatchObject({ cityName: compoundName, cityId: 42 })
    expect(restored[1]).toMatchObject({ nearbyCity: { cityName: compoundName }, latitude: 55.75, longitude: 37.61 })
  })
  it('preserves full legacy labels when structured metadata is absent rather than truncating at commas', () => {
    const original = createCityPlace({ ...city, id: 88, name: 'Порт, Старый' }, 10)
    const gps = withNearbyCity(createGpsPlace({ latitude: city.latitude, longitude: city.longitude, accuracy: 20, timestamp: 20 },
      'Europe/Moscow', null, 'gps:history:legacy'), { ...city, name: 'Порт, Старый' })
    const old = restoreRecentPlaces([{ ...original, cityName: undefined },
      { ...gps, nearbyCity: { ...gps.nearbyCity, cityName: undefined } }])
    render(<LocationScreen place={createLocalityPlace(location, 0)} recentPlaces={old}
      onSelectRecent={vi.fn()} onBack={vi.fn()} onSearch={vi.fn()} onLocate={vi.fn()} />)
    const rows = within(screen.getByRole('region', { name: 'Недавние места' })).getAllByRole('button')
    expect(rows[0]).toHaveTextContent('Порт, Старый, Москва, Россия')
    expect(rows[1]).toHaveTextContent('Порт, Старый, Москва, Россия · GPS')
  })
  it('keeps equal-name GeoNames rows as distinct selectable identities; visual disambiguation needs product approval', async () => {
    const a = createCityPlace({ ...city, id: 201, name: 'Киров', admin1Name: 'Регион А' }, 100)
    const b = createCityPlace({ ...city, id: 202, name: 'Киров', admin1Name: 'Регион Б', longitude: 48 }, 200)
    const restored = restoreRecentPlaces([a, b])
    const onSelectRecent = vi.fn()
    render(<LocationScreen place={createLocalityPlace(location, 0)} recentPlaces={restored}
      onSelectRecent={onSelectRecent} onBack={vi.fn()} onSearch={vi.fn()} onLocate={vi.fn()} />)
    const rows = within(screen.getByRole('region', { name: 'Недавние места' })).getAllByRole('button', { name: 'Киров' })
    expect(rows).toHaveLength(2)
    expect(restored.map(item => item.id)).toEqual(['geonames:201', 'geonames:202'])
    await userEvent.click(rows[1]!)
    expect(onSelectRecent).toHaveBeenCalledWith(restored[1])
  })
  it('не показывает текущую GPS history row дважды и не ограничивает список тремя строками', () => {
    const current = createGpsPlace({ latitude: 40, longitude: -73, accuracy: 20, timestamp: 100 }, 'Europe/Moscow', null, 'gps:runtime')
    const history = Array.from({ length: 10 }, (_, index) => createLocalityPlace({ ...location, id: `place-${index}`, name: `Место ${index}`, longitude: 49 + index }, index))
    render(<LocationScreen place={current} recentPlaces={[current, ...history]} onSelectRecent={vi.fn()} onBack={vi.fn()} onSearch={vi.fn()} onLocate={vi.fn()} />)
    expect(screen.getAllByRole('button', { name: /^Место / })).toHaveLength(10)
  })
  it('выбирает результат поиска одним тапом', async () => {
    const onSelectCity = vi.fn()
    render(<SearchScreen {...searchProps} onSelectCity={onSelectCity} />)
    await userEvent.type(screen.getByRole('searchbox'), 'Моск')
    await userEvent.click(await screen.findByRole('button', { name: /Москва/ }))
    expect(onSelectCity).toHaveBeenCalledWith(city)
    expect(screen.queryByRole('button', { name: 'По геопозиции' })).not.toBeInTheDocument()
  })
  it('не показывает запоздалый ответ предыдущего запроса', async () => {
    let resolve!: (value: ReturnType<typeof success<CitySearchResult>>) => void
    const onSearchCities = vi.fn().mockImplementationOnce(() => new Promise(r => { resolve = r })).mockResolvedValue(success({ cities: [], status: 'complete', missingPackages: [] }))
    render(<SearchScreen {...searchProps} onSearchCities={onSearchCities} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Моск' } })
    await waitFor(() => expect(onSearchCities).toHaveBeenCalledWith('Моск'))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Лондон' } })
    await act(async () => { resolve(success({ cities: [city], status: 'complete', missingPackages: [] })); await Promise.resolve() })
    expect(screen.queryByRole('button', { name: /Москва/ })).not.toBeInTheDocument()
    expect(await screen.findByText('Город не найден')).toBeVisible()
  })
  it('показывает найденный город с регионом без брендинга провайдера при офлайн-каталоге', async () => {
    render(<SearchScreen {...searchProps} catalogStatus="offline" />)
    await userEvent.type(screen.getByRole('searchbox'), 'Каз')
    expect(screen.getByRole('button', { name: /Казань.*Татарстан/ })).toBeEnabled()
    expect(screen.getByText('Для поиска городов нужен интернет')).toBeVisible()
  })
  it.each(['offline', 'unavailable', 'invalid'] as const)('обрабатывает ошибку %s и повторяет поиск', async reason => {
    const search = vi.fn().mockResolvedValueOnce(failure({ kind: 'data', reason })).mockResolvedValue(success({ cities: [city], status: 'complete', missingPackages: [] }))
    render(<SearchScreen {...searchProps} onSearchCities={search} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Москва' } })
    expect(await screen.findByText('Не удалось выполнить поиск')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByRole('button', { name: /Москва/ })).toBeVisible()
  })
  it('обрабатывает отклонение promise', async () => {
    render(<SearchScreen {...searchProps} onSearchCities={vi.fn().mockRejectedValue(new Error('unavailable'))} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Москва' } })
    expect(await screen.findByText('Не удалось выполнить поиск')).toBeVisible()
  })
  it('различает одинаковые города и повторяет неполный поиск', async () => {
    const cities = [1, 2].map(id => ({ ...city, id, name: 'Киров', admin1Name: 'Кировская область' }))
    const search = vi.fn().mockResolvedValueOnce(success({ cities, status: 'needs-download', missingPackages: ['RU-1'] })).mockResolvedValue(success({ cities, status: 'complete', missingPackages: [] }))
    render(<SearchScreen {...searchProps} onSearchCities={search} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Киров' } })
    expect(await screen.findByText('Для полного поиска нужен интернет')).toBeVisible()
    expect(screen.getByRole('button', { name: /Киров.*GeoNames 1/ })).toHaveTextContent('Кировская область')
    expect(screen.getByRole('button', { name: /Киров.*GeoNames 2/ })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('Для полного поиска нужен интернет')).not.toBeInTheDocument())
  })
  it('оформляет триггер поиска как field-like, а гео-действие полноширинным', () => {
    render(<LocationScreen initial place={null} recentPlaces={[]} onSelectRecent={vi.fn()} onBack={vi.fn()} onSearch={vi.fn()} onLocate={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Найти город' })).toHaveClass('pill--field')
    expect(screen.getByRole('button', { name: 'По геопозиции' })).toHaveClass('pill--primary')
  })
  it('выравнивает результаты поиска как двухстрочные строки слева', async () => {
    render(<SearchScreen {...searchProps} />)
    await userEvent.type(screen.getByRole('searchbox'), 'Москва')
    const result = await screen.findByRole('button', { name: 'Москва, Москва, Россия' })
    expect(result).toHaveClass('pill-row', 'pill-row--stacked')
  })

})
