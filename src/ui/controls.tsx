import { useCallback, type ComponentProps, type ReactNode, type RefCallback } from 'react'

import { useJellySurface } from './jelly/useJellySurface'
import type { JellyPreset } from './jelly/presets'
import { markArabicText } from './ArabicText'

export type { JellyPreset } from './jelly/presets'

/**
 * Семантические роли интерактивных контролов поверх визуального foundation `.pill`.
 * Роль задаёт геометрию и выравнивание, поэтому feature-экраны не подбирают их локально.
 */
export type ButtonVariant = 'action' | 'primary' | 'auxiliary' | 'field'

type JellyButtonProps = ComponentProps<'button'> & {
  /** Пресет физического отклика; по умолчанию standard. */
  preset?: JellyPreset
  baseClassName: string
}

/**
 * Внутренний слой: нативный button в light DOM остаётся единственным носителем
 * семантики, а canvas за содержимым рисует ту же поверхность и деформируется.
 * Feature-код не должен использовать этот компонент напрямую.
 */
function JellyButton({ preset = 'standard', baseClassName, className, type = 'button', disabled, ref, children, ...rest }: JellyButtonProps) {
  const { buttonRef, canvasRef } = useJellySurface(preset, disabled)
  const mergedRef = useCallback<RefCallback<HTMLButtonElement>>((node) => {
    buttonRef.current = node

    if (typeof ref === 'function') {
      ref(node)
    } else if (ref) {
      ref.current = node
    }
  }, [buttonRef, ref])

  return <button ref={mergedRef} type={type} disabled={disabled} data-jelly-preset={preset}
    className={`${baseClassName} jelly-action${className ? ` ${className}` : ''}`} {...rest}>
    <canvas ref={canvasRef} className="jelly-action-canvas" aria-hidden="true" />
    {typeof children === 'string' ? markArabicText(children) : children}
  </button>
}

type ActionButtonProps = ComponentProps<'button'> & { variant?: ButtonVariant; preset?: JellyPreset }

/** Обычное самостоятельное действие VaqtPro. */
export function ActionButton({ variant = 'action', preset = 'standard', ...rest }: ActionButtonProps) {
  return <JellyButton baseClassName={`pill pill--${variant}`} preset={preset} {...rest} />
}

type IconActionButtonProps = ComponentProps<'button'> & { label: string; preset?: JellyPreset }

/** Компактное icon-only действие 44×44 px. */
export function IconActionButton({ label, preset = 'expressive', ...rest }: IconActionButtonProps) {
  return <JellyButton baseClassName="pill icon-button" preset={preset} aria-label={label} {...rest} />
}

type ActionRowProps = Omit<ComponentProps<'button'>, 'title'> & {
  title: ReactNode
  /** Значение/состояние строки, выравнивается вправо от заголовка. */
  value?: ReactNode
  /** Вторая строка, из-за которой строка становится вертикальной и полностью левой. */
  secondary?: ReactNode
  preset?: JellyPreset
}

/** Полноширинная интерактивная строка списка или настройки. */
export function ActionRow({ title, value, secondary, preset = 'subtle', ...rest }: ActionRowProps) {
  const stacked = secondary !== undefined
  const displayTitle = typeof title === 'string' ? markArabicText(title) : title
  const displayValue = typeof value === 'string' ? markArabicText(value) : value
  const displaySecondary = typeof secondary === 'string' ? markArabicText(secondary) : secondary

  return <JellyButton baseClassName={`pill pill-row${stacked ? ' pill-row--stacked' : ''}`} preset={preset} {...rest}>
    {stacked
      ? <><span className="action-row-title">{displayTitle}</span>{displaySecondary}</>
      : <><span>{displayTitle}</span>{value !== undefined ? <span className="note">{displayValue}</span> : null}</>}
  </JellyButton>
}

/**
 * Общий layout нижних действий. `stretch` — основное полноширинное действие,
 * `end` — одно вспомогательное действие справа, `between` — toolbar с ведущим и завершающим элементом.
 */
export function ScreenFooter({ align = 'stretch', children }: { align?: 'stretch' | 'end' | 'between'; children: ReactNode }) {
  return <div className={`screen-footer screen-footer--${align}`}>{children}</div>
}
