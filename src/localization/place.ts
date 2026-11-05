import type { City } from '../domain/cities'
import type { Translator } from './messages'
import type { SupportedLocale } from './locale'

export function localizedCityRegion(city: City, t: Translator): string {
  return city.admin1Name || (city.admin1Code && city.admin1Code !== '00'
    ? t('regionCode', { code: city.admin1Code })
    : t('unspecifiedRegion'))
}

export function localizedCityLabel(city: City, disambiguate: boolean, locale: SupportedLocale, t: Translator): string {
  const country = new Intl.DisplayNames([locale], { type: 'region' }).of(city.countryCode) ?? city.countryCode
  const context = [city.admin2Name?.trim(), localizedCityRegion(city, t)].filter(Boolean).join(', ')
  const label = `${city.name}, ${context}, ${country}`
  return disambiguate ? `${label} · GeoNames ${city.id}` : label
}
