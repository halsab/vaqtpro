import type { SupportedLocale } from './locale'

const VERIFIED_RUSSIAN_NAMES: Readonly<Record<number, string>> = Object.freeze({
  524901: 'Москва',
  551487: 'Казань',
  756135: 'Варшава',
  2643743: 'Лондон',
})

export function localizedGeographicName(id: number | undefined, originalName: string, locale: SupportedLocale): string {
  if (locale === 'ru' && id !== undefined) return VERIFIED_RUSSIAN_NAMES[id] ?? originalName
  return originalName
}
