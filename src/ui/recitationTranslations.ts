/** Present the source's Tatar and Russian sections without altering their wording. */
export function selectTranslation(source: string, locale: string): { locale: 'ru' | 'tt-Cyrl'; text: string } | null {
  const russianLabel = 'Перевод: '
  const tatarLabel = 'Мәгънәсе: '
  const tatarStart = source.indexOf(tatarLabel)
  const russianStart = source.indexOf(russianLabel)
  const tatar = tatarStart < 0 ? null : source.slice(tatarStart + tatarLabel.length, russianStart > tatarStart ? russianStart : undefined).trim()
  const russian = russianStart < 0 ? null : source.slice(russianStart + russianLabel.length).trim()
  if (locale === 'ru' && russian) return { locale: 'ru', text: russian }
  if (locale === 'tt' && tatar) return { locale: 'tt-Cyrl', text: tatar }
  return null
}
