import { describe, expect, it } from 'vitest'

import { DEFAULT_THEME_FAMILY, getSeason, restoreThemeFamily } from '../domain/theme'
import { resolveTheme, themePalettes } from './theme'

describe('theme behavior', () => {
  it('restores only supported theme families', () => {
    expect(restoreThemeFamily(undefined)).toBe(DEFAULT_THEME_FAMILY)
    expect(restoreThemeFamily('invalid')).toBe(DEFAULT_THEME_FAMILY)
    expect(restoreThemeFamily('classic')).toBe('classic')
    expect(restoreThemeFamily('seasonal')).toBe('seasonal')
  })

  it.each([
    ['2026-01-01', 'winter'],
    ['2026-03-01', 'spring'],
    ['2026-06-01', 'summer'],
    ['2026-09-01', 'autumn'],
    ['2026-12-01', 'winter'],
  ] as const)('uses the season at the start of each calendar period', (date, season) => {
    expect(getSeason(date)).toBe(season)
  })

  it('keeps selected family and system tone independent from the current season', () => {
    expect(resolveTheme('seasonal', '2026-07-15', 'light'))
      .toMatchObject({ family: 'seasonal', season: 'summer', tone: 'light' })
    expect(resolveTheme('classic', '2026-07-15', 'dark'))
      .toMatchObject({ family: 'classic', season: 'summer', tone: 'dark' })
  })

  it('keeps theme text and countdown colors readable on both surfaces', () => {
    const luminance = (hex: string) => {
      const channels = hex.slice(1).match(/.{2}/g)?.map(value => Number.parseInt(value, 16) / 255) ?? []
      const [red = 0, green = 0, blue = 0] = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue
    }
    const contrast = (left: string, right: string) => {
      const [lighter, darker] = [luminance(left), luminance(right)].sort((a, b) => b - a)
      return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05)
    }

    for (const palette of Object.values(themePalettes)) {
      expect(contrast(palette.textPrimary, palette.backgroundSecondary)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(palette.textPrimary, palette.backgroundTertiary)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(palette.textSecondary, palette.backgroundSecondary)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(palette.textSecondary, palette.backgroundTertiary)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(palette.accentCountdown, palette.backgroundSecondary)).toBeGreaterThanOrEqual(4.5)
    }
  })
})
