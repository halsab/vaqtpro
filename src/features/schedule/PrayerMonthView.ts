import { createElement, type ReactNode } from 'react'

import { IconActionButton } from '../../ui/controls'

function MonthIcon({ direction }: { direction: 'previous' | 'next' }) {
  const path = direction === 'previous' ? 'm14.5 5-7 7 7 7' : 'm9.5 5 7 7-7 7'
  return createElement('svg', { viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
    createElement('path', {
      d: path,
      stroke: 'currentColor',
      strokeWidth: 1.8,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }))
}

export function PrayerMonthView({ monthLabel, previousMonthLabel, nextMonthLabel, onPreviousMonth, onNextMonth,
  locationLabel, calculationProfileLabel, profileLabel, methodology, children }: {
  monthLabel: string
  previousMonthLabel?: string | undefined
  nextMonthLabel?: string | undefined
  onPreviousMonth?: (() => void) | undefined
  onNextMonth?: (() => void) | undefined
  locationLabel?: string | undefined
  calculationProfileLabel?: string | undefined
  profileLabel?: string | undefined
  methodology?: ReactNode | undefined
  children?: ReactNode
}) {
  const previous = onPreviousMonth && previousMonthLabel
    ? createElement(IconActionButton, { label: previousMonthLabel, title: previousMonthLabel, onClick: onPreviousMonth },
      createElement(MonthIcon, { direction: 'previous' }))
    : createElement('span', { className: 'prayer-month-control-placeholder', 'aria-hidden': true })
  const next = onNextMonth && nextMonthLabel
    ? createElement(IconActionButton, { label: nextMonthLabel, title: nextMonthLabel, onClick: onNextMonth },
      createElement(MonthIcon, { direction: 'next' }))
    : createElement('span', { className: 'prayer-month-control-placeholder', 'aria-hidden': true })
  const disclosure = methodology !== undefined && locationLabel && calculationProfileLabel && profileLabel
    ? createElement('details', { className: 'prayer-month-method' },
      createElement('summary', null, `${locationLabel} · ${calculationProfileLabel} · ${profileLabel}`),
      createElement('div', { className: 'prayer-month-method-body' }, methodology))
    : null

  return createElement('div', { className: 'screen-stack prayer-month-screen' },
    createElement('div', { className: 'prayer-month-controls' },
      previous,
      createElement('h2', {
        'aria-live': onPreviousMonth || onNextMonth ? 'polite' : undefined,
        className: 'screen-title prayer-month-heading',
      }, monthLabel),
      next),
    disclosure,
    children)
}
