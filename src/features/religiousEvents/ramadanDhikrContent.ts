import source from '../../content/religious-events/ramadan-decade-dhikr.md?raw'

export const RAMADAN_DHIKR_IDS = ['first', 'second', 'last'] as const
export type RamadanDhikrId = typeof RAMADAN_DHIKR_IDS[number]

export const RAMADAN_DHIKR_TITLES: Readonly<Record<RamadanDhikrId, string>> = Object.freeze({
  first: 'Зикр первых 10 дней',
  second: 'Зикр вторых 10 дней',
  last: 'Зикр последних 10 дней',
})

const SECTIONS: Readonly<Record<RamadanDhikrId, string>> = Object.freeze({
  first: 'Первые 10 дней',
  second: 'Вторые 10 дней',
  last: 'Последние 10 дней',
})

export interface RamadanDhikrContent {
  arabic: string
  transcription: string
  translation: string
}

function sectionText(content: string, heading: string, nextHeading?: string): string {
  const startMarker = `${heading}\n`
  const start = content.indexOf(startMarker)
  if (start < 0) throw new Error(`Missing dhikr heading: ${heading}`)
  const bodyStart = start + startMarker.length
  const end = nextHeading ? content.indexOf(`\n${nextHeading}`, bodyStart) : content.length
  if (end < 0) throw new Error(`Missing next dhikr heading: ${nextHeading}`)
  return content.slice(bodyStart, end).trim()
}

function decadeText(id: RamadanDhikrId): string {
  const heading = `## ${SECTIONS[id]}`
  const start = source.indexOf(`${heading}\n`)
  if (start < 0) throw new Error(`Missing dhikr section: ${heading}`)
  const bodyStart = start + heading.length + 1
  const nextId = RAMADAN_DHIKR_IDS[RAMADAN_DHIKR_IDS.indexOf(id) + 1]
  const end = nextId ? source.indexOf(`\n## ${SECTIONS[nextId]}`, bodyStart) : source.length
  if (end < 0) throw new Error(`Missing end of dhikr section: ${heading}`)
  return source.slice(bodyStart, end)
}

export function getRamadanDhikrContent(id: RamadanDhikrId): RamadanDhikrContent {
  const decade = decadeText(id)
  return {
    arabic: sectionText(decade, '### Арабский текст', '### Транскрипция'),
    transcription: sectionText(decade, '### Транскрипция', '### Перевод'),
    translation: sectionText(decade, '### Перевод'),
  }
}
