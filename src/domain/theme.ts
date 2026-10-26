export type ThemeFamily = 'classic' | 'seasonal'
export type ThemeTone = 'dark' | 'light'
export type Season = 'winter' | 'spring' | 'summer' | 'autumn'

export const DEFAULT_THEME_FAMILY: ThemeFamily = 'seasonal'

export function restoreThemeFamily(value: unknown): ThemeFamily {
  if (value === 'classic' || value === 'seasonal') return value
  return DEFAULT_THEME_FAMILY
}

export function getSeason(civilDate: string): Season {
  const month = Number(civilDate.slice(5, 7))
  if (month === 12 || month <= 2) return 'winter'
  if (month <= 5) return 'spring'
  if (month <= 8) return 'summer'
  return 'autumn'
}
