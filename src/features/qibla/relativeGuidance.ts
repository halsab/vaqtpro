import type { useLocalization } from '../../localization'

export function formatRelativeGuidance(angle: number, t: ReturnType<typeof useLocalization>['t']): string {
  if (Math.abs(angle) < 2.5) return t('qiblaRelativeAhead')
  if (Math.abs(angle) >= 177.5) return t('qiblaRelativeBehind')
  const direction = angle > 0 ? t('qiblaTurnRight') : t('qiblaTurnLeft')
  const degrees = Math.round(Math.abs(angle) / 5) * 5
  return t('qiblaRelativeTurn', { direction, degrees })
}
