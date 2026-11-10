import { describe, expect, it } from 'vitest'

import {
  createLocationClock,
  getCivilDate,
  getDeviceTimeZone,
  getUtcOffset,
  getZonedTime,
  isValidTimeZone,
  zonedDateTimeToInstant,
} from './locationTime'

describe('location time', () => {

  it('определяет предыдущий календарный день выбранного места', () => {
    const instant = new Date('2026-09-01T06:30:00.000Z')

    expect(getCivilDate(instant, 'America/Los_Angeles')).toBe('2026-08-31')
    expect(getZonedTime(instant, 'America/Los_Angeles')).toBe('23:30')
  })


  it('возвращает текущий UTC offset с учётом DST', () => {
    expect(getUtcOffset(new Date('2026-03-08T06:59:59.999Z'), 'America/New_York'))
      .toBe('UTC−5')
    expect(getUtcOffset(new Date('2026-03-08T07:00:00.000Z'), 'America/New_York'))
      .toBe('UTC−4')
  })

  it('пропускает несуществующий час на европейской DST-границе', () => {
    expect(getZonedTime(new Date('2026-03-29T00:59:59.999Z'), 'Europe/Berlin'))
      .toBe('01:59')
    expect(getZonedTime(new Date('2026-03-29T01:00:00.000Z'), 'Europe/Berlin'))
      .toBe('03:00')
  })



  it('отклоняет несуществующее местное время при весеннем переходе DST', () => {
    expect(() =>
      zonedDateTimeToInstant(
        '2026-03-08',
        '02:30',
        'America/New_York',
      ),
    ).toThrow(
      'Local time does not exist in America/New_York: 2026-03-08 02:30',
    )
  })

  it('при осеннем повторе DST стабильно выбирает первое вхождение местного времени', () => {
    const instant = zonedDateTimeToInstant(
      '2026-11-01',
      '01:30',
      'America/New_York',
    )

    expect(instant.toISOString()).toBe('2026-11-01T05:30:00.000Z')
    expect(getZonedTime(instant, 'America/New_York')).toBe('01:30')
  })
})
