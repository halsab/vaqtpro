import { jellyEngine, type JellyComponent } from './engine'
import { JELLY_PRESETS, type JellyPreset } from './presets'
import { JellyBody, traceSmoothPath } from './softBody'

/**
 * Контроллер одной jelly-поверхности VaqtPro: нативная кнопка остаётся в light DOM,
 * а canvas за её содержимым рисует ту же tertiary-поверхность и локально её
 * деформирует. В покое форма совпадает с CSS-пилюлей, поэтому визуальный язык
 * VaqtPro не меняется.
 *
 * Запас JELLY_SURFACE_PAD равен content inset: канвас не создаёт overflow и
 * не выходит за пределы экранного паддинга.
 */
export const JELLY_SURFACE_PAD = 16

let themeEpoch = 0
const liveSurfaces = new Set<JellySurface>()

/** Вызывается после применения темы, чтобы поверхности перечитали токены. */
export function notifyJellyThemeChange(): void {
  themeEpoch += 1
  for (const surface of liveSurfaces) {
    surface.refreshColors()
  }
}

export class JellySurface implements JellyComponent {
  private body: JellyBody | null = null
  private disabled: boolean
  private reduced: boolean
  private fill = '#383838'
  private colorsEpoch = -1
  private pointerId: number | null = null
  private keyboardActive = false
  private suppressClick = false
  private suppressClickTimer: number | null = null
  private cssW = 0
  private cssH = 0
  private readonly motionQuery: MediaQueryList | null
  private resizeObserver: ResizeObserver | null = null

  constructor(
    private readonly button: HTMLButtonElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx: CanvasRenderingContext2D,
    private readonly preset: JellyPreset,
    disabled: boolean,
  ) {
    this.disabled = disabled
    this.motionQuery = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null
    this.reduced = this.motionQuery?.matches ?? false
  }

  mount(): void {
    liveSurfaces.add(this)

    this.measure()

    this.button.addEventListener('pointerdown', this.onPointerDown)
    this.button.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp, true)
    window.addEventListener('pointercancel', this.onPointerCancel, true)
    this.button.addEventListener('lostpointercapture', this.onLostPointerCapture)
    this.button.addEventListener('keydown', this.onKeyDown)
    this.button.addEventListener('keyup', this.onKeyUp)
    this.button.addEventListener('blur', this.onBlur)
    this.button.addEventListener('click', this.onClick, true)

    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => { this.measure() })
      this.resizeObserver.observe(this.button)
    }

    this.motionQuery?.addEventListener('change', this.onMotionChange)
  }

  destroy(): void {
    liveSurfaces.delete(this)
    jellyEngine.drop(this)

    this.button.removeEventListener('pointerdown', this.onPointerDown)
    this.button.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp, true)
    window.removeEventListener('pointercancel', this.onPointerCancel, true)
    this.button.removeEventListener('lostpointercapture', this.onLostPointerCapture)
    this.button.removeEventListener('keydown', this.onKeyDown)
    this.button.removeEventListener('keyup', this.onKeyUp)
    this.button.removeEventListener('blur', this.onBlur)
    this.button.removeEventListener('click', this.onClick, true)

    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.motionQuery?.removeEventListener('change', this.onMotionChange)
    if (this.suppressClickTimer !== null) window.clearTimeout(this.suppressClickTimer)
    this.suppressClickTimer = null
    this.suppressClick = false
    this.pointerId = null
    this.body = null
  }

  // Тема сменилась: токены перечитываются в ближайшей отрисовке.
  refreshColors(): void {
    this.colorsEpoch = -1
    this.paint()
  }

  // Кадр движка: физика, отрисовка и решение «продолжать ли цикл».
  frame = (dt: number): boolean => {
    if (this.reduced || !this.body) {
      return false
    }

    this.body.update(dt)
    this.paint()

    return !this.body.isResting()
  }

  // Размер и радиус берутся из layout кнопки: деформация всегда совпадает с
  // фактической геометрией, включая text scaling и двухстрочные строки.
  private measure(): void {
    const width = this.button.offsetWidth
    const height = this.button.offsetHeight
    if (width < 1 || height < 1) {
      return
    }

    const radius = this.readRadius()

    const cssW = width + JELLY_SURFACE_PAD * 2
    const cssH = height + JELLY_SURFACE_PAD * 2
    // Монохромной геометрии хватает плотности 2×: canvas на длинных списках
    // настроек занимает заметно меньше памяти, чем при 3×.
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    if (this.canvas.width !== Math.round(cssW * dpr) || this.canvas.height !== Math.round(cssH * dpr)) {
      this.canvas.width = Math.round(cssW * dpr)
      this.canvas.height = Math.round(cssH * dpr)
      this.canvas.style.width = `${cssW}px`
      this.canvas.style.height = `${cssH}px`
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    this.cssW = cssW
    this.cssH = cssH

    if (this.reduced) {
      return
    }

    if (!this.body) {
      this.body = new JellyBody({ width, height, radius, config: JELLY_PRESETS[this.preset].config })
    } else if (this.body.width !== width || this.body.height !== height || this.body.radius !== radius) {
      this.body.resize(width, height, radius)
    }

    this.paint()
  }

  private readRadius(): number {
    const value = Number.parseFloat(getComputedStyle(this.button).borderTopLeftRadius)

    return Number.isFinite(value) ? value : 22
  }

  private readColors(): void {
    if (this.colorsEpoch === themeEpoch) {
      return
    }

    const styles = getComputedStyle(document.documentElement)
    this.fill = styles.getPropertyValue('--background-tertiary').trim() || '#383838'
    this.colorsEpoch = themeEpoch
  }

  private paint(): void {
    const body = this.body
    if (!body || this.cssW < 1 || this.cssH < 1) {
      return
    }

    this.ctx.clearRect(0, 0, this.cssW, this.cssH)

    if (this.button.disabled) {
      return
    }

    this.readColors()

    this.ctx.save()
    this.ctx.translate(this.cssW / 2, this.cssH / 2)
    traceSmoothPath(this.ctx, body.getSurfacePoints())
    this.ctx.fillStyle = this.fill
    this.ctx.fill()
    this.ctx.restore()
  }

  private wake(): void {
    if (!this.reduced && this.body && !this.disabled) {
      jellyEngine.wake(this)
    }
  }

  // Экранные координаты в локальную систему тела: делитель убирает масштаб
  // предка (например, анимацию открытия диалога), чтобы палец не «уезжал».
  private toLocal(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.button.getBoundingClientRect()
    const scaleX = this.button.offsetWidth > 0 ? rect.width / this.button.offsetWidth : 1
    const scaleY = this.button.offsetHeight > 0 ? rect.height / this.button.offsetHeight : 1

    return {
      x: (clientX - (rect.left + rect.width / 2)) / (scaleX > 0.001 ? scaleX : 1),
      y: (clientY - (rect.top + rect.height / 2)) / (scaleY > 0.001 ? scaleY : 1),
    }
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (this.disabled || this.reduced || !this.body || this.pointerId !== null) {
      return
    }
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return
    }

    this.pointerId = event.pointerId
    this.suppressClick = false
    if (this.suppressClickTimer !== null) window.clearTimeout(this.suppressClickTimer)
    this.suppressClickTimer = null

    if (event.pointerType !== 'touch') {
      try {
        this.button.setPointerCapture(event.pointerId)
      } catch {
        // Захват может не состояться, если указатель уже ушёл; нажатие всё равно работает.
      }
    }

    const local = this.toLocal(event.clientX, event.clientY)

    this.body.pressAtLocal(local.x, local.y, JELLY_PRESETS[this.preset].strength)
    this.wake()
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId || this.disabled || this.reduced || !this.body) {
      return
    }

    const local = this.toLocal(event.clientX, event.clientY)

    this.body.moveToLocal(local.x, local.y)
    this.wake()
  }

  private onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) {
      return
    }

    const rect = this.button.getBoundingClientRect()

    // Отпускание за пределами кнопки не должно порождать click: так же ведёт
    // себя нативная кнопка без pointer capture.
    this.suppressClick = event.clientX < rect.left || event.clientX > rect.right
      || event.clientY < rect.top || event.clientY > rect.bottom

    this.endPointer()
    if (this.suppressClick) this.armClickSuppression()
  }

  private onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) {
      return
    }

    this.suppressClick = true
    this.endPointer()
    this.armClickSuppression()
  }

  private onLostPointerCapture = (): void => {
    // pointerup уже мог зафиксировать отпускание снаружи; его click ещё ожидается.
    if (this.pointerId === null) return
    this.suppressClick = true
    this.endPointer()
    this.armClickSuppression()
  }

  private armClickSuppression(): void {
    if (this.suppressClickTimer !== null) window.clearTimeout(this.suppressClickTimer)
    // Некоторые мобильные WebKit откладывают синтетический click после завершения pointer.
    this.suppressClickTimer = window.setTimeout(() => {
      this.suppressClick = false
      this.suppressClickTimer = null
    }, 800)
  }

  private endPointer(): void {
    this.pointerId = null
    this.body?.release()
    this.wake()
  }

  private onClick = (event: MouseEvent): void => {
    if (!this.suppressClick || event.detail === 0) {
      return
    }

    this.suppressClick = false
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (this.disabled || this.reduced || !this.body || this.keyboardActive || event.repeat) {
      return
    }
    if (event.key !== 'Enter' && event.key !== ' ') {
      return
    }

    this.keyboardActive = true
    // Та же энергия, что у указателя в центре (pressAt по умолчанию 1.12).
    this.body.centerPulse(JELLY_PRESETS[this.preset].strength * 1.12)
    this.wake()
  }

  private onKeyUp = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return
    }

    this.keyboardActive = false
    this.body?.release()
    this.wake()
  }

  private onBlur = (): void => {
    this.keyboardActive = false
    if (this.pointerId !== null) this.endPointer()
    this.body?.release()
    this.wake()
  }

  // Живая смена prefers-reduced-motion: физика отключается, статический
  // feedback остаётся на CSS.
  private onMotionChange = (): void => {
    this.reduced = this.motionQuery?.matches ?? false

    if (this.reduced) {
      this.endPointer()
      jellyEngine.drop(this)
    } else {
      this.measure()
    }
  }
}
