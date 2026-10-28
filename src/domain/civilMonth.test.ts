import { describe, expect, it } from 'vitest'

import { civilMonthDates, localCivilMonth, shiftCivilMonth } from './civilMonth'

describe('civil month helpers', () => {
  it('returns every zero-padded day of the month, including leap February', () => {
    expect(civilMonthDates('2028-02-12')).toHaveLength(29)
    expect(civilMonthDates('2028-02-12')[0]).toBe('2028-02-01')
    expect(civilMonthDates('2028-02-12').at(-1)).toBe('2028-02-29')
    expect(civilMonthDates('2026-10-28')).toHaveLength(31)
  })

  it('shifts month boundaries across years without carrying the selected day', () => {
    expect(shiftCivilMonth('2026-01-31', -1)).toBe('2025-12-01')
    expect(shiftCivilMonth('2026-12-01', 1)).toBe('2027-01-01')
  })

  it('chooses the month using the place time zone', () => {
    const instant = new Date('2026-10-01T00:30:00.000Z')
    expect(localCivilMonth(instant, 'Pacific/Kiritimati')[0]).toBe('2026-10-01')
    expect(localCivilMonth(instant, 'America/Los_Angeles')[0]).toBe('2026-09-01')
  })
})
