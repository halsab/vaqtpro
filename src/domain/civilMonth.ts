import { addDays } from './date'
import { getCivilDate, type CivilDate } from './locationTime'

function monthParts(date: string): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(date)
  if (!match) throw new RangeError(`Invalid civil date: ${date}`)
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) throw new RangeError(`Invalid civil date: ${date}`)
  return { year, month }
}

function utcDate(year: number, month: number, day: number): Date {
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(12, 0, 0, 0)
  return date
}

export function civilMonthDates(date: string): CivilDate[] {
  const { year, month } = monthParts(date)
  const firstDate = utcDate(year, month, 1).toISOString().slice(0, 10) as CivilDate
  const lastDay = utcDate(year, month + 1, 0).getUTCDate()
  return Array.from({ length: lastDay }, (_, index) => addDays(firstDate, index) as CivilDate)
}

export function shiftCivilMonth(date: string, amount: number): CivilDate {
  const { year, month } = monthParts(date)
  if (!Number.isInteger(amount)) throw new RangeError('Month offset must be an integer')
  return utcDate(year, month + amount, 1).toISOString().slice(0, 10) as CivilDate
}

export function localCivilMonth(referenceInstant: Date, timeZone: string): CivilDate[] {
  return civilMonthDates(getCivilDate(referenceInstant, timeZone))
}
