import { getSeason, type ThemeFamily, type ThemeTone } from '../domain/theme'
import { notifyJellyThemeChange } from './jelly/surface'
import { themePalettes, type ThemePalette } from './themePalette'

export { themePalettes } from './themePalette'
export type { ThemePalette } from './themePalette'

export function resolveTheme(family: ThemeFamily, civilDate: string, tone: ThemeTone) {
  const season = getSeason(civilDate)
  const key = family === 'classic' ? `classic-${tone}` as const : `${season}-${tone}` as const
  return { family, season, tone, palette: themePalettes[key] }
}

const paletteProperties = {
  backgroundPrimary: '--background-primary',
  backgroundSecondary: '--background-secondary',
  backgroundTertiary: '--background-tertiary',
  textPrimary: '--text-primary',
  textSecondary: '--text-secondary',
  accentCountdown: '--accent-countdown',
} as const

let appliedJellySignature = ''

export function applyTheme(theme: ReturnType<typeof resolveTheme>): () => void {
  const root = document.documentElement
  for (const [key, property] of Object.entries(paletteProperties) as [keyof ThemePalette, string][]) {
    root.style.setProperty(property, theme.palette[key])
  }
  root.style.colorScheme = theme.tone
  root.dataset.theme = theme.family
  root.dataset.themeTone = theme.tone
  root.dataset.season = theme.season

  // Jelly-поверхности читают цвета из токенов: обновляем их только при смене
  // палитры, а не на каждом минутном тике времени.
  const jellySignature = `${theme.palette.backgroundPrimary}|${theme.palette.backgroundTertiary}`
  if (jellySignature !== appliedJellySignature) {
    appliedJellySignature = jellySignature
    notifyJellyThemeChange()
  }
  const colorScheme = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')
  const previousColorScheme = colorScheme?.content
  if (colorScheme) colorScheme.content = theme.tone
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  const previousThemeColor = themeColor?.content
  if (themeColor) themeColor.content = theme.palette.backgroundPrimary

  return () => {
    for (const property of Object.values(paletteProperties)) root.style.removeProperty(property)
    root.style.removeProperty('color-scheme')
    delete root.dataset.theme
    delete root.dataset.themeTone
    delete root.dataset.season
    if (colorScheme && previousColorScheme !== undefined) colorScheme.content = previousColorScheme
    if (themeColor && previousThemeColor !== undefined) themeColor.content = previousThemeColor
  }
}
