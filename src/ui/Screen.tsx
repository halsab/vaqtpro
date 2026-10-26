import { Children, Fragment, isValidElement, type ReactNode } from 'react'
import { ActionButton } from './controls'
import { useLocalization } from '../localization'

export function Screen({ label, top, bottom, children, contentClassName = '', busy = false }: {
  label: string
  top?: ReactNode
  bottom?: ReactNode
  children: ReactNode
  contentClassName?: string
  busy?: boolean
}) {
  const hasTop = hasRenderableContent(top)
  return <section className={`app-screen${hasTop ? '' : ' app-screen--no-top'}`} aria-label={label} aria-busy={busy || undefined}>
    {hasTop ? <header className="screen-top">{top}</header> : null}
    <div className={`screen-panel${hasTop ? '' : ' screen-panel--no-top'}`}>
      <div className={`screen-content${contentClassName ? ` ${contentClassName}` : ''}`}>
        {children}
      </div>
      {bottom ? <footer className="screen-bottom">{bottom}</footer> : null}
    </div>
  </section>
}

function hasRenderableContent(node: ReactNode): boolean {
  return Children.toArray(node).some(child => {
    if (typeof child === 'string') return child.trim().length > 0
    if (typeof child === 'number') return true
    return isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment
      ? hasRenderableContent(child.props.children)
      : isValidElement(child)
  })
}

export function BackButton({ onClick, label }: { onClick: () => void; label?: string }) {
  const { t } = useLocalization()
  return <ActionButton data-screen-focus onClick={onClick}>{label ?? t('back')}</ActionButton>
}
