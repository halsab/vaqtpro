import { describe, expect, it } from 'vitest'

import { getRamadanDhikrContent, RAMADAN_DHIKR_IDS } from './ramadanDhikrContent'

describe('локальные зикры декад Рамадана', () => {
  it('сохраняет все три текста из Markdown-источника без изменения пробелов и символов', () => {
    expect(RAMADAN_DHIKR_IDS).toEqual(['first', 'second', 'last'])

    const first = getRamadanDhikrContent('first')
    expect(first.arabic).toContain('سُبْحانَ ذِي الْمُلْكِ وَالْمَلَكُوْتِ')
    expect(first.transcription).toContain('нааp»')
    expect(first.translation).toContain('Совершенному, Святому')

    const second = getRamadanDhikrContent('second')
    expect(second.arabic).toContain('سُبْحَانَ ذِي المُلْكِ والمَلَكُوتِ  سُبْحَانَ')
    expect(second.transcription).toContain('зил-мүльки')
    expect(second.translation).toContain('явного.  Пречист')

    const last = getRamadanDhikrContent('last')
    expect(last.arabic).toContain('الْحَنَّانِ الْمَنَّانِ')
    expect(last.transcription).toContain('Йя шахра рамадан.')
    expect(last.translation).toContain('Милостивейший из милостивых')
  })
})
