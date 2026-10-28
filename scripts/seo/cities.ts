export interface CityDemandEvidence {
  kind: 'third-party-keyword-estimate' | 'russian-language-search-result'
  sourceUrl: string
  query?: string
  observedAt: string
  verification: 'unverified' | 'verified'
}

export interface SeoCityCandidate {
  id: number
  name: string
  locativeName: string
  countryCode: string
  countryName: string
  admin1Code: string
  admin1Name: string
  regionName: string
  latitude: number
  longitude: number
  timeZone: string
  slug: string
  demandEvidence: readonly CityDemandEvidence[]
  ownerApproved: boolean
}

const ESTIMATE_AZAN = 'https://domain.goserp.ru/azan-today/'
const ESTIMATE_SHIA = 'https://domain.goserp.ru/shiatime/'
const SERP_VREMYA_BERLIN = 'https://vremyanamaza.org/berlin/'
const SERP_VREMYA_ISTANBUL = 'https://vremyanamaza.org/stambul/'
const SERP_NAMAZDAY_DUBAI = 'https://namazday.com/ru/ae/dubai/'
const OBSERVED_AT = '2026-10-28'

/**
 * These are catalog-verified research candidates. Demand signals have not been
 * independently verified, and none is approved for production publication.
 */
export const SEO_CITY_CANDIDATES: readonly SeoCityCandidate[] = [
  { id: 524901, name: 'Москва', locativeName: 'Москве', countryCode: 'RU', countryName: 'Россия', admin1Code: '48', admin1Name: 'Москва', regionName: 'Москва', latitude: 55.752, longitude: 37.6178, timeZone: 'Europe/Moscow', slug: 'moskva', ownerApproved: false, demandEvidence: [{ kind: 'third-party-keyword-estimate', sourceUrl: ESTIMATE_AZAN, query: 'время намаза в москве на сегодня', observedAt: OBSERVED_AT, verification: 'unverified' }] },
  { id: 498817, name: 'Санкт-Петербург', locativeName: 'Санкт-Петербурге', countryCode: 'RU', countryName: 'Россия', admin1Code: '66', admin1Name: 'Санкт-Петербург', regionName: 'Санкт-Петербург', latitude: 59.9386, longitude: 30.3141, timeZone: 'Europe/Moscow', slug: 'sankt-peterburg', ownerApproved: false, demandEvidence: [{ kind: 'third-party-keyword-estimate', sourceUrl: ESTIMATE_SHIA, query: 'время намаза в санкт петербурге', observedAt: OBSERVED_AT, verification: 'unverified' }] },
  { id: 551487, name: 'Казань', locativeName: 'Казани', countryCode: 'RU', countryName: 'Россия', admin1Code: '73', admin1Name: 'Татарстан', regionName: 'Татарстан', latitude: 55.7887, longitude: 49.1221, timeZone: 'Europe/Moscow', slug: 'kazan', ownerApproved: false, demandEvidence: [{ kind: 'third-party-keyword-estimate', sourceUrl: ESTIMATE_SHIA, query: 'время намаза казань', observedAt: OBSERVED_AT, verification: 'unverified' }] },
  { id: 479561, name: 'Уфа', locativeName: 'Уфе', countryCode: 'RU', countryName: 'Россия', admin1Code: '08', admin1Name: 'Башкортостан', regionName: 'Башкортостан', latitude: 54.7431, longitude: 55.9678, timeZone: 'Asia/Yekaterinburg', slug: 'ufa', ownerApproved: false, demandEvidence: [{ kind: 'third-party-keyword-estimate', sourceUrl: ESTIMATE_SHIA, query: 'время намаза в уфе', observedAt: OBSERVED_AT, verification: 'unverified' }] },
  { id: 532096, name: 'Махачкала', locativeName: 'Махачкале', countryCode: 'RU', countryName: 'Россия', admin1Code: '17', admin1Name: 'Дагестан', regionName: 'Дагестан', latitude: 42.9778, longitude: 47.5003, timeZone: 'Europe/Moscow', slug: 'makhachkala', ownerApproved: false, demandEvidence: [{ kind: 'third-party-keyword-estimate', sourceUrl: ESTIMATE_SHIA, query: 'время намаза в махачкале', observedAt: OBSERVED_AT, verification: 'unverified' }] },
  { id: 558418, name: 'Грозный', locativeName: 'Грозном', countryCode: 'RU', countryName: 'Россия', admin1Code: '12', admin1Name: 'Чечня', regionName: 'Чечня', latitude: 43.312, longitude: 45.6889, timeZone: 'Europe/Moscow', slug: 'groznyj', ownerApproved: false, demandEvidence: [{ kind: 'third-party-keyword-estimate', sourceUrl: ESTIMATE_SHIA, query: 'время намаза в грозном', observedAt: OBSERVED_AT, verification: 'unverified' }] },
  { id: 1486209, name: 'Екатеринбург', locativeName: 'Екатеринбурге', countryCode: 'RU', countryName: 'Россия', admin1Code: '71', admin1Name: 'Свердловская Область', regionName: 'Свердловская область', latitude: 56.8573, longitude: 60.6153, timeZone: 'Asia/Yekaterinburg', slug: 'ekaterinburg', ownerApproved: false, demandEvidence: [{ kind: 'third-party-keyword-estimate', sourceUrl: ESTIMATE_SHIA, query: 'время намаза в екатеринбурге', observedAt: OBSERVED_AT, verification: 'unverified' }] },
  { id: 745044, name: 'Стамбул', locativeName: 'Стамбуле', countryCode: 'TR', countryName: 'Турция', admin1Code: '34', admin1Name: 'Стамбул', regionName: 'Стамбул', latitude: 41.0138, longitude: 28.9497, timeZone: 'Europe/Istanbul', slug: 'stambul', ownerApproved: false, demandEvidence: [{ kind: 'russian-language-search-result', sourceUrl: SERP_VREMYA_ISTANBUL, observedAt: OBSERVED_AT, verification: 'unverified' }] },
  { id: 2950159, name: 'Берлин', locativeName: 'Берлине', countryCode: 'DE', countryName: 'Германия', admin1Code: '16', admin1Name: 'Берлин', regionName: 'Берлин', latitude: 52.5244, longitude: 13.4105, timeZone: 'Europe/Berlin', slug: 'berlin', ownerApproved: false, demandEvidence: [{ kind: 'russian-language-search-result', sourceUrl: SERP_VREMYA_BERLIN, observedAt: OBSERVED_AT, verification: 'unverified' }] },
  { id: 292223, name: 'Дубай', locativeName: 'Дубае', countryCode: 'AE', countryName: 'ОАЭ', admin1Code: '03', admin1Name: 'Dubai', regionName: 'эмират Дубай', latitude: 25.0772, longitude: 55.3093, timeZone: 'Asia/Dubai', slug: 'dubai', ownerApproved: false, demandEvidence: [{ kind: 'russian-language-search-result', sourceUrl: SERP_NAMAZDAY_DUBAI, observedAt: OBSERVED_AT, verification: 'unverified' }] },
]

export const SEO_PUBLICATION_APPROVAL = Object.freeze({
  status: 'blocked' as const,
  approvedCityIds: [] as readonly number[],
  reason: 'Нужны проверенные данные о поисковом спросе и подтверждение владельца для каждого города.',
})
