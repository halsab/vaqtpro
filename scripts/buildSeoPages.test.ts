import { webcrypto } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { addDays } from '../src/domain/date'
import { calculatePrayerSchedule } from '../src/domain/prayerCalculation'
import { resolvePrayerTimeSource } from '../src/domain/prayerSource'
import { createLocationClock } from '../src/domain/locationTime'
import { SEO_CITY_CANDIDATES, SEO_PUBLICATION_APPROVAL } from './seo/cities'
import { escapeHtml, localCalendarMonth, renderCityPage, validateCityCandidates } from './buildSeoPages'

describe('статические страницы расписаний', () => {
  beforeEach(() => vi.stubGlobal('crypto', webcrypto))

  it('проверяет ID, написание, административную область, координаты и зону для всех кандидатов', async () => {
    const cities = await validateCityCandidates()

    expect(cities).toHaveLength(10)
    expect(cities.map(({ candidate }) => candidate.id)).toEqual(SEO_CITY_CANDIDATES.map(city => city.id))
    expect(new Set(cities.map(({ candidate }) => `${candidate.countryCode}/${candidate.slug}-${candidate.id}`)).size).toBe(10)
    expect(cities.every(({ profile }) => profile.status === 'ready')).toBe(true)
    expect(cities.find(({ city }) => city.id === 551487)?.profile.settings).toMatchObject({
      profile: 'tatarstan',
      asrMethod: 'hanafi',
      highLatitudeRule: 'tatarstan',
    })
    expect(cities.find(({ city }) => city.id === 292223)?.profile.settings.profile).toBe('dubai')
  })

  it('не публикует кандидатов без проверенного спроса и подтверждения владельца', () => {
    expect(SEO_PUBLICATION_APPROVAL.status).toBe('blocked')
    expect(SEO_PUBLICATION_APPROVAL.approvedCityIds).toEqual([])
    expect(SEO_CITY_CANDIDATES.every(city => !city.ownerApproved)).toBe(true)
    expect(SEO_CITY_CANDIDATES.every(city => city.demandEvidence.every(evidence => evidence.verification === 'unverified'))).toBe(true)
  })

  it('экранирует специальные HTML-символы в данных города и метаданных', () => {
    expect(escapeHtml(`<city name="A&B">'`)).toBe('&lt;city name=&quot;A&amp;B&quot;&gt;&#39;')
  })

  it('использует автоматическую методику приложения и даёт шесть времён каждому кандидату', async () => {
    const cities = await validateCityCandidates()
    for (const { city, place, profile } of cities) {
      const schedule = calculatePrayerSchedule(place, '2026-10-28', city.timeZone, profile.settings)
      expect(schedule.date).toBe('2026-10-28')
      expect(schedule.timeZone).toBe(city.timeZone)
      expect(Object.keys(schedule.entries)).toEqual(['fajr', 'sunrise', 'zenith', 'dhuhr', 'asr', 'maghrib', 'isha'])
      for (const key of ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'] as const) {
        expect(schedule.entries[key].time).toMatch(/^\d{2}:\d{2}$/)
        expect(Number.isFinite(schedule.entries[key].instant)).toBe(true)
      }
    }
  })

  it('сохраняет татарстанский фиксированный Зухр и автоматический профиль для Казани', async () => {
    const kazan = (await validateCityCandidates()).find(({ city }) => city.id === 551487)
    if (!kazan) throw new Error('Казань отсутствует в каталоге кандидатов')
    const { profile, place, city } = kazan
    const schedule = calculatePrayerSchedule(place, '2026-10-28', city.timeZone, profile.settings)
    expect(profile.settings.profile).toBe('tatarstan')
    expect(schedule.entries.dhuhr.time).toBe('12:00')
  })

  it('пересчитывает смещение зоны при переходе на летнее время', async () => {
    const berlin = (await validateCityCandidates()).find(({ city }) => city.id === 2950159)
    if (!berlin) throw new Error('Берлин отсутствует в каталоге кандидатов')
    const clock = createLocationClock(berlin.city.timeZone)
    const before = clock.getUtcOffset(clock.toInstant('2026-03-28', '12:00'))
    const after = clock.getUtcOffset(clock.toInstant('2026-03-29', '12:00'))
    expect(before).toBe('UTC+1')
    expect(after).toBe('UTC+2')

    for (const date of ['2026-03-28', '2026-03-29', '2026-03-30']) {
      const schedule = calculatePrayerSchedule(berlin.place, date, berlin.city.timeZone, berlin.profile.settings)
      expect(schedule.date).toBe(date)
      for (const entry of Object.values(schedule.entries)) {
        expect(clock.getCivilDate(new Date(entry.instant))).toBe(date)
      }
    }
  })

  it('переносит окно через месяцы, високосный день и границу года', () => {
    expect(addDays('2027-12-31', 1)).toBe('2028-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01')
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
  })

  it('строит полный календарный месяц по местному времени города', () => {
    expect(localCalendarMonth(new Date('2026-10-28T12:00:00.000Z'), 'Europe/Moscow')).toEqual([
      '2026-10-01', ...Array.from({ length: 29 }, (_, index) => addDays('2026-10-01', index + 1)), '2026-10-31',
    ])
    expect(localCalendarMonth(new Date('2028-02-29T12:00:00.000Z'), 'Europe/Moscow')).toHaveLength(29)
    expect(localCalendarMonth(new Date('2028-02-29T12:00:00.000Z'), 'Europe/Moscow').at(-1)).toBe('2028-02-29')
  })

  it('chooses month boundaries in each city timezone', () => {
    const instant = new Date('2026-10-01T00:30:00.000Z')
    expect(localCalendarMonth(instant, 'Pacific/Kiritimati')[0]).toBe('2026-10-01')
    expect(localCalendarMonth(instant, 'America/Los_Angeles')[0]).toBe('2026-09-01')
  })

  it('помечает высокоширотные расчёты как приближённые, когда правило применяется', () => {
    const place = {
      id: 'geonames:6453333',
      selection: 'city' as const,
      name: 'Тромсё, Норвегия',
      cityName: 'Тромсё',
      latitude: 69.6492,
      longitude: 18.9553,
      accuracy: null,
      timestamp: 0,
      timeZone: 'Europe/Oslo',
      automaticTimeZone: { id: 'Europe/Oslo', source: 'city' as const },
      region: { code: 'NO-19', name: 'Тромс' },
      coverage: 'outside' as const,
    }
    const profile = resolvePrayerTimeSource(place, { mode: 'automatic' })
    const schedule = calculatePrayerSchedule(place, '2026-12-21', place.timeZone, profile.settings)

    expect(profile.settings.highLatitudeRule).toBe('seventhOfNight')
    expect(schedule.estimatedPrayers.length).toBeGreaterThan(0)
    expect(schedule.estimatedPrayers).toEqual(expect.arrayContaining(['fajr', 'isha']))
  })

  it('показывает дату и шесть времён в одной строке и кратко сворачивает методику', async () => {
    const validated = (await validateCityCandidates()).find(({ city }) => city.id === 524901)
    if (!validated) throw new Error('Москва отсутствует в каталоге кандидатов')
    const dates = localCalendarMonth(new Date('2026-10-28T12:00:00.000Z'), 'Europe/Moscow')
    const html = renderCityPage(validated.city, validated.candidate, validated.profile, dates,
      new Date('2026-10-28T12:00:00.000Z'))

    expect(html).toContain('<time datetime="2026-10-01">01.10.2026</time>')
    expect(html).toContain('<time datetime="2026-10-31">31.10.2026</time>')
    expect(html).not.toContain('<time datetime="2026-11-01">')
    expect(html).toContain('<caption>Расписание намаза за месяц</caption>')
    expect(html.match(/<tr><th scope="row"><time datetime="\d{4}-\d{2}-\d{2}">/g) ?? []).toHaveLength(31)
    expect(html).toMatch(/<tr><th scope="row"><time datetime="2026-10-01">01\.10\.2026<\/time><\/th>(?:<td>[\s\S]*?<\/td>){6}<\/tr>/)
    expect(html).not.toContain('/prayer-times.css')
    expect(html).toContain('class="seo-app-page"')
    expect(html).toContain('class="prayer-month-method"')
    expect(html).toContain('<summary>Москва · Профиль расчёта · Россия</summary>')
    expect(html).toContain('<h1 class="sr-only">Время намаза в Москве</h1>')
    expect(html).not.toContain('Часовой пояс')
    expect(html).not.toContain('Europe/Moscow')
    expect(html).not.toMatch(/Слово «примерно» рядом|Источник координат: GeoNames|Сформировано \d{2}\.\d{2}\.\d{4}|без интернета|расписание мечети/i)
    expect(html).not.toContain('≈')
    expect(html).not.toMatch(/<details class="prayer-month-method"[^>]*\bopen\b/)
  })
})
