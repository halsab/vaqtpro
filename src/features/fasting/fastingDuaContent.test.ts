import { describe, expect, it } from 'vitest'

import { FASTING_DUA_IDS, FASTING_DUA_TITLE_KEYS, getFastingDuaContent } from './fastingDuaContent'
import suhur from '../../content/religious-events/dua-suhur.md?raw'
import iftar from '../../content/religious-events/dua-iftar.md?raw'

describe('локальные дуа поста', () => {
  it('содержит ровно две статьи в порядке сухур → ифтар', () => {
    expect(FASTING_DUA_IDS).toEqual(['suhur', 'iftar'])
    expect(FASTING_DUA_TITLE_KEYS).toEqual({ suhur: 'fastingDuaSuhur', iftar: 'fastingDuaIftar' })
  })

  it.each([
    ['suhur', {
      arabic: 'نَوَيْتُ أَنْ أَصُومَ صَوْمَ شَهْرِ رَمَضَانَ مِنَ الْفَجْرِ إِلَى الْمَغْرِبِ خَالِصًا لِلَّهِ تَعَالَى',
      transcription: 'Навайту ан асуума саума шахри Рамадана миналь-фаджри иляль-магриби хаалисан лилляхи тааля.',
      translation: '«Я намереваюсь соблюдать пост месяца Рамадан от рассвета до заката искренне ради Всевышнего Аллаха».',
    }],
    ['iftar', {
      arabic: 'اللَّهُمَّ لَكَ صُمْتُ وَبِكَ آمَنْتُ وَعَلَيْكَ تَوَكَّلْتُ وَعَلَى رِزْقِكَ أَفْطَرْتُ فَاغْفِرْ لِي يَا غَفَّارُ مَا قَدَّمْتُ وَمَا أَخَّرْتُ',
      transcription: 'Аллахумма ляка сумту, ва бика аманту, ва аляйка таваккальту, ва аля ризкика афтарту. Фагфир ли, я Гаффару, ма каддамту ва ма аххарту.',
      translation: '«О Аллах, ради Тебя я постился, в Тебя уверовал, на Тебя положился и Твоими дарами разговелся. О Всепрощающий, прости мои прежние и последующие прегрешения».',
    }],
  ] as const)('сохраняет текст статьи %s посимвольно', (id, expected) => {
    const content = id === 'suhur' ? suhur : iftar
    const title = id === 'suhur' ? 'Дуа сухура' : 'Дуа ифтара'
    expect(getFastingDuaContent(id)).toEqual(expected)
    expect(content.trim()).toBe(`# ${title}

## Арабский текст

${expected.arabic}

## Транскрипция

${expected.transcription}

## Перевод

${expected.translation}`)
  })
})
