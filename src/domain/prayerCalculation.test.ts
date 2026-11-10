import { describe, expect, it } from 'vitest'
import { getZonedTime, zonedDateTimeToInstant } from './locationTime'
import { addDays } from './date'
import { CALCULATION_PROFILES, calculatePrayerSchedule, calculateSolarZenith, type CalculationSettings } from './prayerCalculation'

const KAZAN = { latitude: 55.7946485, longitude: 49.1115022 }
const MECCA = { latitude: 21.4225, longitude: 39.8262 }
const MINUTE = 60_000

function withSettings(
  settings: Partial<CalculationSettings>,
): CalculationSettings {
  return { profile: 'tatarstan', asrMethod: 'hanafi', highLatitudeRule: 'tatarstan', ...settings }
}

describe('calculatePrayerSchedule', () => {
  it('считает зимний день по профилю Татарстан без северной подстановки', () => {
    const schedule = calculatePrayerSchedule(
      KAZAN,
      '2026-01-15',
      'Europe/Moscow',
      withSettings({}),
    )

    expect(Object.keys(schedule.entries)).toEqual([
      'fajr',
      'sunrise',
      'zenith',
      'dhuhr',
      'asr',
      'maghrib',
      'isha',
    ])
    expect(schedule.estimatedPrayers).toEqual([])
    expect(schedule.polarResolutionApplied).toBe(false)
    expect(schedule.entries.fajr.instant).toBeLessThan(
      schedule.entries.sunrise.instant,
    )
    expect(schedule.entries.isha.instant).toBeGreaterThan(
      schedule.entries.maghrib.instant,
    )
  })

  it('летом применяет правило Татарстан 120/90 только к Фаджру и Иша', () => {
    const schedule = calculatePrayerSchedule(
      KAZAN,
      '2026-06-15',
      'Europe/Moscow',
      withSettings({}),
    )

    expect(schedule.estimatedPrayers).toEqual(['fajr', 'isha'])
    expect(schedule.entries.sunrise.instant - schedule.entries.fajr.instant).toBeGreaterThanOrEqual(
      120 * MINUTE,
    )
    expect(schedule.entries.sunrise.instant - schedule.entries.fajr.instant).toBeLessThanOrEqual(
      121 * MINUTE,
    )
    expect(schedule.entries.isha.instant - schedule.entries.maghrib.instant).toBe(
      90 * MINUTE,
    )
  })

  it('применяет сохранённую поправку Зухра после базовой проверки относительно зенита', () => {
    const agriz = { id: 'locality:agriz', selection: 'city' as const, latitude: 56.525516, longitude: 52.9971643,
      region: { code: 'RU-TA' }, coverage: 'inside' }
    const base = calculatePrayerSchedule(agriz, '2026-06-21', 'Europe/Moscow', withSettings({}))
    const adjusted = calculatePrayerSchedule(agriz, '2026-06-21', 'Europe/Moscow', withSettings({ adjustments: { dhuhr: -2 } }))

    expect(base.entries.dhuhr.instant).toBeGreaterThan(base.entries.zenith.instant)
    expect(adjusted.entries.dhuhr.instant).toBe(base.entries.dhuhr.instant - 2 * MINUTE)
  })

  it('сохраняет астрономические времена у границы летнего правила', () => {
    const direct = calculatePrayerSchedule(
      KAZAN,
      '2026-05-01',
      'Europe/Moscow',
      withSettings({}),
    )
    const firstEveningFallback = calculatePrayerSchedule(
      KAZAN,
      '2026-05-05',
      'Europe/Moscow',
      withSettings({}),
    )
    const adjusted = calculatePrayerSchedule(
      KAZAN,
      '2026-05-15',
      'Europe/Moscow',
      withSettings({}),
    )
    const lastMorningFallback = calculatePrayerSchedule(
      KAZAN,
      '2026-08-08',
      'Europe/Moscow',
      withSettings({}),
    )
    const restored = calculatePrayerSchedule(
      KAZAN,
      '2026-08-09',
      'Europe/Moscow',
      withSettings({}),
    )

    expect(direct.estimatedPrayers).not.toContain('fajr')
    expect(firstEveningFallback.estimatedPrayers).toEqual(['isha'])
    expect(adjusted.estimatedPrayers).toContain('fajr')
    expect(lastMorningFallback.estimatedPrayers).toEqual(['fajr'])
    expect(restored.estimatedPrayers).not.toContain('fajr')
  })


  it('делает стандартный Аср раньше ханафитского', () => {
    const hanafi = calculatePrayerSchedule(
      KAZAN,
      '2026-09-01',
      'Europe/Moscow',
      withSettings({}),
    )
    const standard = calculatePrayerSchedule(
      KAZAN,
      '2026-09-01',
      'Europe/Moscow',
      withSettings({ asrMethod: 'standard' }),
    )

    expect(standard.entries.asr.instant).toBeLessThan(hanafi.entries.asr.instant)
  })

  it('поддерживает все заявленные профили, включая Турцию · Diyanet', () => {
    for (const profile of CALCULATION_PROFILES) {
      const schedule = calculatePrayerSchedule(
        { latitude: 41.0082, longitude: 28.9784 },
        '2026-09-01',
        'Europe/Istanbul',
        withSettings({ profile: profile.id }),
      )

      expect(schedule.profile).toBe(profile.id)
      for (const entry of Object.values(schedule.entries)) {
        expect(Number.isFinite(entry.instant)).toBe(true)
      }
    }
  })



  it('использует для Qatar фиксированный интервал Иша 90 минут круглый год', () => {
    for (const date of ['2026-02-18', '2026-06-21']) {
      const schedule = calculatePrayerSchedule(
        { latitude: 25.2854, longitude: 51.531 }, date, 'Asia/Qatar',
        withSettings({ profile: 'qatar' }),
      )
      expect(schedule.entries.isha.instant - schedule.entries.maghrib.instant).toBe(90 * MINUTE)
    }
  })

  it('не переносит расчётное расписание на соседнюю гражданскую дату у линии перемены даты', () => {
    const place = { latitude: 1.87, longitude: -157.4 }
    const date = '2026-01-01'
    const timeZone = 'Pacific/Kiritimati'
    const schedule = calculatePrayerSchedule(place, date, timeZone)
    const civilDates = Object.values(schedule.entries).map(entry =>
      new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(entry.instant)),
    )

    expect(civilDates).toEqual(Array(7).fill(date))
    expect(schedule.entries.zenith.instant).toBe(Date.parse('2025-12-31T22:33:00.000Z'))
  })

  it('сравнивает профиль Turkey с опубликованной таблицей Diyanet для Стамбула', () => {
    const schedule = calculatePrayerSchedule(
      { latitude: 41.0082, longitude: 28.9784 }, '2026-09-11', 'Europe/Istanbul',
      { profile: 'turkey', asrMethod: 'standard', highLatitudeRule: 'twilightAngle' },
    )
    const published = { fajr: '05:06', sunrise: '06:33', dhuhr: '13:06', asr: '16:39', maghrib: '19:29', isha: '20:50' }
    const deviations = Object.fromEntries(Object.entries(published).map(([key, time]) => {
      const actual = schedule.entries[key as keyof typeof published].time.split(':').map(Number)
      const reference = time.split(':').map(Number)
      const actualHour = actual[0] ?? Number.NaN
      const actualMinute = actual[1] ?? Number.NaN
      const publishedHour = reference[0] ?? Number.NaN
      const publishedMinute = reference[1] ?? Number.NaN
      return [key, actualHour * 60 + actualMinute - publishedHour * 60 - publishedMinute]
    }))
    // Primary Diyanet monthly timetable: https://namazvakitleri.diyanet.gov.tr/tr-tr/9541/istanbul-icin-namaz-vakti
    expect(deviations).toEqual({ fajr: 0, sunrise: 0, dhuhr: 0, asr: -1, maghrib: -2, isha: -1 })
  })


  it('rejects non-canonical calculation dates', () => {
    expect(() => calculatePrayerSchedule(KAZAN, '2026-1-15', 'Europe/Moscow')).toThrow('invalid-calculation-date')
    expect(() => calculatePrayerSchedule(KAZAN, '2026-01-15-extra', 'Europe/Moscow')).toThrow('invalid-calculation-date')
  })


  it('восстанавливает полярный день и возвращает упорядоченное расписание', () => {
    const schedule = calculatePrayerSchedule(
      { latitude: 69.6492, longitude: 18.9553 },
      '2026-06-21',
      'Europe/Oslo',
    )
    const instants = [
      schedule.entries.fajr.instant,
      schedule.entries.sunrise.instant,
      schedule.entries.dhuhr.instant,
      schedule.entries.asr.instant,
      schedule.entries.maghrib.instant,
      schedule.entries.isha.instant,
    ]

    expect(schedule.polarResolutionApplied).toBe(true)
    expect(schedule.estimatedPrayers).toEqual([
      'fajr', 'sunrise', 'zenith', 'dhuhr', 'asr', 'maghrib', 'isha',
    ])
    expect(instants.every(Number.isFinite)).toBe(true)
    expect([...instants].sort((a, b) => a - b)).toEqual(instants)
  })



  it('форматирует те же рассчитанные моменты в выбранной таймзоне', () => {
    const moscow = calculatePrayerSchedule(KAZAN, '2026-01-15', 'Europe/Moscow')
    const tokyo = calculatePrayerSchedule(KAZAN, '2026-01-15', 'Asia/Tokyo')

    expect(tokyo.entries.fajr.instant).toBe(moscow.entries.fajr.instant)
    expect(moscow.entries.fajr.time).toBe(
      getZonedTime(new Date(moscow.entries.fajr.instant), 'Europe/Moscow'),
    )
    expect(tokyo.entries.fajr.time).toBe(
      getZonedTime(new Date(tokyo.entries.fajr.instant), 'Asia/Tokyo'),
    )
    expect(tokyo.entries.fajr.time).not.toBe(moscow.entries.fajr.time)
  })

  it('проверяет границы Рамадана и интервал Иша по локальному календарю Умм аль-Кура', () => {
    const settings = withSettings({ profile: 'ummAlQura' })
    for (const timeZone of ['Asia/Riyadh', 'Asia/Qatar']) {
      const hijriMonth = (date: string) => Number.parseInt(new Intl.DateTimeFormat(
        'en-u-ca-islamic-umalqura-nu-latn', { month: 'numeric', timeZone },
      ).format(zonedDateTimeToInstant(date, '12:00', timeZone)), 10)
      const dates = Array.from({ length: 80 }, (_, index) => addDays('2026-02-01', index))
      const firstRamadanIndex = dates.findIndex((date, index) =>
        hijriMonth(date) === 9 && (index === 0 || hijriMonth(dates[index - 1] ?? date) !== 9),
      )
      let lastRamadanIndex = -1
      for (let index = 0; index < dates.length; index += 1) {
        const date = dates[index]
        if (date && hijriMonth(date) === 9) lastRamadanIndex = index
      }
      expect(firstRamadanIndex).toBeGreaterThan(0)
      expect(lastRamadanIndex).toBeGreaterThanOrEqual(firstRamadanIndex)
      const boundaryDates = [
        dates[firstRamadanIndex - 1], dates[firstRamadanIndex],
        dates[lastRamadanIndex], dates[lastRamadanIndex + 1],
      ].filter((date): date is string => date !== undefined)

      for (const date of boundaryDates) {
        const schedule = calculatePrayerSchedule(MECCA, date, timeZone, settings)
        const interval = hijriMonth(date) === 9 ? 120 : 90
        expect(schedule.entries.isha.instant - schedule.entries.maghrib.instant).toBe(interval * MINUTE)
      }
    }
  })

})

describe('расчёт солнечного транзита', () => {


  it('сохраняет явную недоступность для пропущенной гражданской даты', () => {
    expect(calculateSolarZenith({ latitude: -13.83, longitude: -171.76 }, '2011-12-30', 'Pacific/Apia')).toBeNull()
  })


  it('calculates consecutive dates and both calendar-year edges without shifting local dates', () => {
    for (const [timeZone, coordinates, firstDate] of [
      ['Pacific/Kiritimati', { latitude: 1.87, longitude: -157.4 }, '2026-12-30'],
      ['Pacific/Apia', { latitude: -13.83, longitude: -171.76 }, '2026-12-31'],
      ['Europe/Moscow', KAZAN, '2026-12-31'],
    ] as const) {
      for (let offset = 0; offset < 3; offset += 1) {
        const date = addDays(firstDate, offset)
        const schedule = calculatePrayerSchedule(coordinates, date, timeZone)
        expect(schedule.date).toBe(date)
        expect(Object.values(schedule.entries).every(entry => Number.isFinite(entry.instant))).toBe(true)
        expect(Object.values(schedule.entries).map(entry =>
          new Intl.DateTimeFormat('en-CA', {
            timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
          }).format(new Date(entry.instant)),
        )).toEqual(Array(7).fill(date))
      }
    }
  })
})


it('applies adjustments to absolute instants across midnight and countdown chronology', async () => {
  const { buildScheduleEvents, selectEventPair } = await import('./scheduleEvents')
  const place = { latitude: 55.79, longitude: 49.12 }
  const baseline = calculatePrayerSchedule(place, '2026-06-21', 'Europe/Moscow', withSettings({}))
  const adjusted = calculatePrayerSchedule(place, '2026-06-21', 'Europe/Moscow', withSettings({ adjustments: { isha: 180, fajr: -180 } }))
  expect(adjusted.entries.isha.instant).toBe(baseline.entries.isha.instant + 180 * MINUTE)
  expect(adjusted.entries.fajr.instant).toBe(baseline.entries.fajr.instant - 180 * MINUTE)
  expect(adjusted.estimatedPrayers).toEqual(baseline.estimatedPrayers)
  const events = buildScheduleEvents(adjusted)
  expect(events.find(e => e.key === 'isha')).toMatchObject({ date: '2026-06-22', dayOffset: 1 })
  expect(events.find(e => e.key === 'fajr')).toMatchObject({ date: '2026-06-20', dayOffset: -1 })
  const instant = adjusted.entries.isha.instant
  expect(selectEventPair(new Date(instant - 1000), events).next?.instant).toBe(instant)
  expect(selectEventPair(new Date(instant), events).current?.key).toBe('isha')
})
it('applies explicit angles and Isha interval while retaining profile and polar rules', () => {
  const base = withSettings({ profile: 'turkey', highLatitudeRule: 'nearestDay' })
  const original = calculatePrayerSchedule(MECCA, '2026-01-15', 'Asia/Riyadh', base)
  const angles = calculatePrayerSchedule(MECCA, '2026-01-15', 'Asia/Riyadh', { ...base, fajrAngle: 20, isha: { kind: 'angle', angle: 20 } })
  expect(angles.entries.fajr.instant).toBeLessThan(original.entries.fajr.instant)
  expect(angles.entries.isha.instant).toBeGreaterThan(original.entries.isha.instant)
  for (const place of [MECCA, { latitude: 69.65, longitude: 18.96 }]) {
    const interval = calculatePrayerSchedule(place, '2026-06-21', 'Europe/Oslo', { ...base, isha: { kind: 'interval', minutes: 240 } })
    expect(interval.entries.isha.instant - interval.entries.maghrib.instant).toBe(240 * MINUTE)
    expect(Object.values(interval.entries).every(e => Number.isFinite(e.instant))).toBe(true)
  }
})
it('rejects non-finite custom settings before generating an invalid instant', () => {
  expect(() => calculatePrayerSchedule(KAZAN, '2026-01-01', 'Europe/Moscow', withSettings({ adjustments: { fajr: Infinity } }))).toThrow('invalid-calculation-settings')
})
