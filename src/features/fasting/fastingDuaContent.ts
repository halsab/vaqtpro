import suhur from '../../content/religious-events/dua-suhur.md?raw'
import iftar from '../../content/religious-events/dua-iftar.md?raw'

export const FASTING_DUA_IDS = ['suhur', 'iftar'] as const
export type FastingDuaId = typeof FASTING_DUA_IDS[number]

export const FASTING_DUA_TITLE_KEYS = Object.freeze({
  suhur: 'fastingDuaSuhur',
  iftar: 'fastingDuaIftar',
})

const SOURCES: Readonly<Record<FastingDuaId, string>> = Object.freeze({ suhur, iftar })

export interface FastingDuaContent {
  arabic: string
  transcription: string
  translation: string
}

export function getFastingDuaContent(id: FastingDuaId): FastingDuaContent {
  const sections = SOURCES[id].split(/^## [^\r\n]+\r?\n/gmu).slice(1).map(section => section.trim())
  if (sections.length !== 3) throw new Error(`Invalid fasting dua article: ${id}`)
  const [arabic, transcription, translation] = sections
  if (!arabic || !transcription || !translation) throw new Error(`Incomplete fasting dua article: ${id}`)
  return {
    arabic,
    transcription,
    translation,
  }
}
