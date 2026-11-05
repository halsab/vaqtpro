import { BackButton, Screen } from '../../ui/Screen'
import { getRamadanDhikrContent, RAMADAN_DHIKR_TITLES, type RamadanDhikrId } from './ramadanDhikrContent'

export function RamadanDhikrScreen({ dhikrId, onBack }: { dhikrId: RamadanDhikrId; onBack: () => void }) {
  const title = RAMADAN_DHIKR_TITLES[dhikrId]
  const content = getRamadanDhikrContent(dhikrId)

  return <Screen label={title} top={<BackButton onClick={onBack} />}>
    <article className="markdown-article ramadan-dhikr-article">
      <h1>{title}</h1>
      <h2>Арабский текст</h2>
      <p className="ramadan-dhikr-arabic" dir="rtl" lang="ar">{content.arabic}</p>
      <h2>Транскрипция</h2>
      <p>{content.transcription}</p>
      <h2>Перевод</h2>
      <p>{content.translation}</p>
    </article>
  </Screen>
}
