import source from '../../content/religious-events/ramadan-decade-dhikr.md?raw'
import type { MessageKey } from '../../localization/messages'

export const RAMADAN_DHIKR_IDS = ['first', 'second', 'last'] as const
export type RamadanDhikrId = typeof RAMADAN_DHIKR_IDS[number]

export const RAMADAN_DHIKR_TITLE_KEYS = {
  first: 'ramadanDhikrFirst',
  second: 'ramadanDhikrSecond',
  last: 'ramadanDhikrLast',
} as const satisfies Readonly<Record<RamadanDhikrId, MessageKey>>

export interface RamadanDhikrContent {
  arabic: string
  transcription: string
  translation: string
}

// The attached Markdown file is the content authority. Parse its three
// decade sections and the three content fields in their documented order.
// UI strings belong to localization, not to the source-text parser.
const decadeBodies = source.split(/^## [^\r\n]+\r?\n/gm).slice(1)

export function getRamadanDhikrContent(id: RamadanDhikrId): RamadanDhikrContent {
  if (decadeBodies.length !== RAMADAN_DHIKR_IDS.length) {
    throw new Error('Unexpected Ramadan dhikr section count')
  }
  const index = RAMADAN_DHIKR_IDS.indexOf(id)
  const decade = decadeBodies[index]
  if (index < 0 || decade === undefined) throw new Error(`Missing Ramadan dhikr section: ${id}`)

  const parts = decade.split(/^### [^\r\n]+\r?\n/gm).slice(1).map(part => part.trim())
  if (parts.length !== 3 || parts.some(part => part.length === 0)) {
    throw new Error(`Invalid Ramadan dhikr structure: ${id}`)
  }

  return {
    arabic: parts[0]!,
    transcription: parts[1]!,
    translation: parts[2]!,
  }
}
