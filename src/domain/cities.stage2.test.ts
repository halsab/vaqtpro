import { describe, expect, it } from 'vitest'
import { formatCityLabel, materializeCity, searchCities, findNearestCity, type CompactCityRecord } from './cities'

function record(id: number, name: string, population = 5000, alternatives: string[] = []): CompactCityRecord {
  return [id, name, [name.toLowerCase(), ...alternatives], 'RU', '33', 58.6, 49.6, population, 'Europe/Moscow', 'Кировская область', 'россия кировская область', 'PPL']
}
const source = { name: 'GeoNames', url: 'https://www.geonames.org/', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', updatedAt: '2026-09-07' }
describe('каталог с регионами и ranking', () => {
  it('ранжирует до лимита независимо от порядка: основное имя, начало, альтернативы, население, ID', () => {
    const rows = [record(1, 'Другой', 900000, ['киров']), record(9, 'Кировск', 90000), record(3, 'Киров', 6000), record(2, 'Киров', 6000)]
    for (const cities of [rows, [...rows].reverse()]) {
      expect(searchCities({ source, cities }, 'киров', 3).map(c => c.id)).toEqual([2, 3, 9])
      expect(searchCities({ source, cities }, 'киров', 1).map(c => c.id)).toEqual([2])
    }
  })
  it('сохраняет ID, код admin1 и timezone, показывает регион и честный fallback', () => {
    const kirov = materializeCity(record(548408, 'Киров'))
    expect(kirov).toMatchObject({ id: 548408, admin1Code: '33', admin1Name: 'Кировская область', timeZone: 'Europe/Moscow' })
    expect(formatCityLabel(kirov)).toBe('Киров, Кировская область, Россия')
    expect(formatCityLabel({ ...kirov, admin1Name: '' })).toBe('Киров, регион 33, Россия')
    expect(formatCityLabel({ ...kirov, admin1Code: '', admin1Name: '' })).toContain('регион не указан')
    expect(formatCityLabel(kirov, true)).toContain('GeoNames 548408')
  })
  it('выбирает меньший устойчивый ID при равной дистанции и проверяет радиус', () => {
    expect(findNearestCity(58.6, 49.6, [record(2, 'Киров'), record(1, 'Киров')], 1)?.id).toBe(1)
    expect(findNearestCity(0, 0, [record(1, 'Киров')], 1)).toBeNull()
    expect(findNearestCity(58.6, 49.6, [record(1, 'Киров')], -1)).toBeNull()
  })
})
