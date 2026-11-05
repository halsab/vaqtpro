import suhur from '../../content/religious-events/dua-suhur.md?raw'
import iftar from '../../content/religious-events/dua-iftar.md?raw'

export const FASTING_DUA_IDS = ['suhur', 'iftar'] as const
export type FastingDuaId = typeof FASTING_DUA_IDS[number]

export const FASTING_DUA_TITLE_KEYS = Object.freeze({
  suhur: 'fastingDuaSuhur',
  iftar: 'fastingDuaIftar',
})

const SOURCES: Readonly<Record<FastingDuaId, string>> = Object.freeze({ suhur, iftar })

export function getFastingDuaContent(id: FastingDuaId): string {
  return SOURCES[id]
}
