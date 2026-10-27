import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JellySurface } from './surface'

function mountSurface() {
  const { container } = render(<><button>Tap</button><canvas /></>)
  const button = container.querySelector('button')
  const canvas = container.querySelector('canvas')
  if (!button || !canvas) throw new Error('Jelly test elements were not rendered')
  const context = {
    setTransform: vi.fn(), clearRect: vi.fn(), save: vi.fn(), translate: vi.fn(), beginPath: vi.fn(),
    moveTo: vi.fn(), bezierCurveTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(), restore: vi.fn(),
  } as unknown as CanvasRenderingContext2D
  Object.defineProperty(button, 'offsetWidth', { configurable: true, value: 120 })
  Object.defineProperty(button, 'offsetHeight', { configurable: true, value: 44 })
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 120, bottom: 44, width: 120, height: 44, toJSON: () => ({}),
  })
  const onClick = vi.fn()
  button.addEventListener('click', onClick)
  const surface = new JellySurface(button, canvas, context, 'standard', false)
  surface.mount()
  return { button, surface, onClick }
}

describe('Jelly pointer lifecycle', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('ends a pointer released outside and preserves the next tap', () => {
    const { button, surface, onClick } = mountSurface()
    fireEvent.pointerDown(button, { pointerId: 1, pointerType: 'touch', button: 0, clientX: 20, clientY: 20 })
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'touch', button: 0, clientX: 140, clientY: 20 })
    fireEvent.pointerDown(button, { pointerId: 2, pointerType: 'touch', button: 0, clientX: 20, clientY: 20 })
    fireEvent.pointerUp(window, { pointerId: 2, pointerType: 'touch', button: 0, clientX: 20, clientY: 20 })
    fireEvent.click(button)

    expect(onClick).toHaveBeenCalledOnce()
    surface.destroy()
  })

  it('keeps outside-release click suppression through lost pointer capture', () => {
    const { button, surface, onClick } = mountSurface()
    fireEvent.pointerDown(button, { pointerId: 3, pointerType: 'mouse', button: 0, clientX: 20, clientY: 20 })
    fireEvent.pointerUp(window, { pointerId: 3, pointerType: 'mouse', button: 0, clientX: 140, clientY: 20 })
    fireEvent.lostPointerCapture(button, { pointerId: 3, pointerType: 'mouse' })
    fireEvent.click(button, { detail: 1 })

    expect(onClick).not.toHaveBeenCalled()
    surface.destroy()
  })

  it('suppresses a delayed synthetic click after an outside release', () => {
    vi.useFakeTimers()
    const { button, surface, onClick } = mountSurface()
    fireEvent.pointerDown(button, { pointerId: 4, pointerType: 'touch', button: 0, clientX: 20, clientY: 20 })
    fireEvent.pointerUp(window, { pointerId: 4, pointerType: 'touch', button: 0, clientX: 140, clientY: 20 })
    act(() => { vi.advanceTimersByTime(450) })
    fireEvent.click(button, { detail: 1, clientX: 140, clientY: 20 })

    expect(onClick).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(400) })
    fireEvent.click(button, { detail: 1, clientX: 20, clientY: 20 })
    expect(onClick).toHaveBeenCalledOnce()
    surface.destroy()
    vi.useRealTimers()
  })

  it('suppresses a synthetic click after pointer cancellation or lost capture', () => {
    const { button, surface, onClick } = mountSurface()
    fireEvent.pointerDown(button, { pointerId: 5, pointerType: 'touch', button: 0, clientX: 20, clientY: 20 })
    fireEvent.pointerCancel(window, { pointerId: 5, pointerType: 'touch' })
    fireEvent.click(button, { detail: 1 })
    expect(onClick).not.toHaveBeenCalled()

    fireEvent.pointerDown(button, { pointerId: 6, pointerType: 'mouse', button: 0, clientX: 20, clientY: 20 })
    fireEvent.lostPointerCapture(button, { pointerId: 6 })
    fireEvent.click(button, { detail: 1 })
    expect(onClick).not.toHaveBeenCalled()
    surface.destroy()
  })

  it('clears pointer state after cancellation so a later pointer is accepted', () => {
    const { button, surface } = mountSurface()
    fireEvent.pointerDown(button, { pointerId: 1, pointerType: 'touch', button: 0, clientX: 20, clientY: 20 })
    fireEvent.pointerCancel(window, { pointerId: 1, pointerType: 'touch' })
    fireEvent.pointerDown(button, { pointerId: 2, pointerType: 'touch', button: 0, clientX: 20, clientY: 20 })
    fireEvent.pointerCancel(window, { pointerId: 2, pointerType: 'touch' })

    surface.destroy()
  })
})
