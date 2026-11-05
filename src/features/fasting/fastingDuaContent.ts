import suhur from '../../content/religious-events/dua-suhur.md?raw'
import iftar from '../../content/religious-events/dua-iftar.md?raw'
import type { RecitationContent } from '../../ui/RecitationArticle'

export const FASTING_DUA_IDS = ['suhur', 'iftar'] as const
export type FastingDuaId = typeof FASTING_DUA_IDS[number]

export const FASTING_DUA_TITLE_KEYS = Object.freeze({
  suhur: 'fastingDuaSuhur',
  iftar: 'fastingDuaIftar',
})

const SOURCES: Readonly<Record<FastingDuaId, string>> = Object.freeze({ suhur, iftar })

export function getFastingDuaContent(id: FastingDuaId): RecitationContent {
  const sections = SOURCES[id].split(/^## [^\r\n]+\r?\n/gm).slice(1).map(section => section.trim())
  const [arabic, transcription, translation] = sections
  if (sections.length !== 3 || !arabic || !transcription || !translation) {
    throw new Error(`Invalid fasting dua article: ${id}`)
  }
  return { arabic, transcription, translation }
}
