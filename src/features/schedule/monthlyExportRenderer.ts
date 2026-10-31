import { GState, jsPDF } from 'jspdf'

import springPattern from '../../../public/seasonal-patterns/vaqtpro-spring-transparent-seamless.png?url'
import summerPattern from '../../../public/seasonal-patterns/vaqtpro-summer-transparent-seamless.png?url'
import autumnPattern from '../../../public/seasonal-patterns/vaqtpro-autumn-transparent-seamless.png?url'
import winterPattern from '../../../public/seasonal-patterns/vaqtpro-winter-transparent-seamless.png?url'
import fontUrl from '../../assets/OldTimeyMono.ttf?url'
import type { MonthlyExportView } from './monthlyExportModel'

const MM_TO_PT = 72 / 25.4
const PAGE = { width: 210, height: 297, inset: 15 }
const ROW_HEIGHT = 7
const TABLE_Y = 44
const TABLE_HEADER_HEIGHT = 9.2
const PATTERN_SIZE = 166
const PNG_WIDTH = 1600
const PNG_HEIGHT = Math.round(PNG_WIDTH * PAGE.height / PAGE.width)
const PATTERN_URLS = { spring: springPattern, summer: summerPattern, autumn: autumnPattern, winter: winterPattern }

type Season = keyof typeof PATTERN_URLS
type DrawCommand =
  | { type: 'text'; text: string; x: number; y: number; size: number; tone: 'primary' | 'secondary'; align?: 'left' | 'center' | 'right' }
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number; tone: 'rule' }
  | { type: 'rect'; x: number; y: number; width: number; height: number; tone: 'stripe' }
  | { type: 'image'; x: number; y: number; width: number; height: number; source: 'pattern' | 'logo' }

interface ExportAssets {
  fontBytes: ArrayBuffer
  patternCanvas: HTMLCanvasElement
  logoCanvas: HTMLCanvasElement
}

let fontBytesPromise: Promise<ArrayBuffer> | undefined
let fontFacePromise: Promise<void> | undefined
let logoCanvasPromise: Promise<HTMLCanvasElement> | undefined
let patternCache: { season: Season; promise: Promise<HTMLCanvasElement> } | undefined
let activePreparations = 0

function seasonFor(month: string): Season {
  const monthNumber = Number(month.slice(5, 7))
  if (monthNumber <= 2 || monthNumber === 12) return 'winter'
  if (monthNumber <= 5) return 'spring'
  if (monthNumber <= 8) return 'summer'
  return 'autumn'
}

function createLayout(view: MonthlyExportView, measure: (text: string, size: number) => number): DrawCommand[] {
  const columns = Array.from({ length: 8 }, (_, index) => PAGE.inset + (index + 0.5) * 22.5)
  const monthX = PAGE.width - PAGE.inset
  const rowTop = TABLE_Y + TABLE_HEADER_HEIGHT
  const locationWidth = measure(view.location, 10.5)
  if (locationWidth > 87 * MM_TO_PT) throw new RangeError('Location label is too long for the approved export header')

  const commands: DrawCommand[] = [
    { type: 'image', source: 'pattern', x: 0, y: 0, width: PATTERN_SIZE, height: PATTERN_SIZE },
    { type: 'image', source: 'pattern', x: PATTERN_SIZE, y: 0, width: PATTERN_SIZE, height: PATTERN_SIZE },
    { type: 'image', source: 'pattern', x: 0, y: PATTERN_SIZE, width: PATTERN_SIZE, height: PATTERN_SIZE },
    { type: 'image', source: 'pattern', x: PATTERN_SIZE, y: PATTERN_SIZE, width: PATTERN_SIZE, height: PATTERN_SIZE },
    { type: 'image', source: 'logo', x: 15, y: 15, width: 17, height: 17 },
    { type: 'text', text: 'VaqtPro', x: 35, y: 20.2, size: 18, tone: 'primary' },
    { type: 'text', text: view.monthTitle, x: monthX, y: 20.2, size: 18, tone: 'primary', align: 'right' },
    { type: 'text', text: view.brandSubtitle, x: 35, y: 30.2, size: 10.5, tone: 'secondary' },
    { type: 'text', text: view.location, x: monthX, y: 30.2, size: 10.5, tone: 'secondary', align: 'right' },
  ]

  for (const [index, label] of view.headers.entries()) {
    commands.push({ type: 'text', text: label, x: columns[index] ?? PAGE.inset, y: TABLE_Y + 6.3, size: 10.5, tone: 'secondary', align: 'center' })
  }
  commands.push({ type: 'line', x1: PAGE.inset, y1: rowTop, x2: PAGE.width - PAGE.inset, y2: rowTop, tone: 'rule' })

  for (const [index, row] of view.rows.entries()) {
    const y = rowTop + index * ROW_HEIGHT
    if ((index + 1) % 2 === 0) commands.push({ type: 'rect', x: PAGE.inset, y, width: 180, height: ROW_HEIGHT, tone: 'stripe' })
    const day = `${row.day} ${row.weekday}`
    commands.push({ type: 'text', text: day, x: columns[0] ?? 26, y: y + 4.8, size: 10.5, tone: 'primary', align: 'center' })
    for (const [eventIndex, event] of row.times.entries()) {
      const x = columns[eventIndex + 1] ?? 0
      const text = event.value === '—' ? '—' : `${event.estimated ? '≈ ' : ''}${event.value}`
      commands.push({ type: 'text', text, x, y: y + 4.8, size: 10.5, tone: event.value === '—' || event.estimated ? 'secondary' : 'primary', align: 'center' })
    }
  }

  const tableBottom = rowTop + view.rows.length * ROW_HEIGHT
  commands.push(
    { type: 'line', x1: (columns[0] ?? 26.25) + 11.25, y1: TABLE_Y, x2: (columns[0] ?? 26.25) + 11.25, y2: tableBottom, tone: 'rule' },
    { type: 'text', text: `${view.sourcePrefix}${view.sourceUrl}`, x: PAGE.inset, y: 279, size: 10.5, tone: 'secondary' },
  )
  return commands
}

async function loadImage(source: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.src = source
  await image.decode()
  return image
}

function loadFontBytes(): Promise<ArrayBuffer> {
  fontBytesPromise ??= (async () => {
    const response = await fetch(fontUrl)
    if (!response.ok) throw new Error('Could not load the VaqtPro font')
    return response.arrayBuffer()
  })().catch((error: unknown) => {
    fontBytesPromise = undefined
    throw error
  })
  return fontBytesPromise
}

async function loadFontFace(fontBytes: ArrayBuffer): Promise<void> {
  fontFacePromise ??= (async () => {
    const fontFace = new FontFace('MonthlyExportMono', fontBytes)
    await fontFace.load()
    document.fonts.add(fontFace)
  })().catch((error: unknown) => {
    fontFacePromise = undefined
    throw error
  })
  return fontFacePromise
}

function loadLogoCanvas(): Promise<HTMLCanvasElement> {
  logoCanvasPromise ??= loadImage('/icons/light/favicon.svg').then(image => {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 512
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not prepare the VaqtPro brand mark')
    context.filter = 'grayscale(1)'
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas
  }).catch((error: unknown) => {
    logoCanvasPromise = undefined
    throw error
  })
  return logoCanvasPromise
}

function loadPatternCanvas(season: Season): Promise<HTMLCanvasElement> {
  if (patternCache?.season === season) return patternCache.promise
  const promise = loadImage(PATTERN_URLS[season]).then(pattern => {
    const canvas = document.createElement('canvas')
    canvas.width = pattern.naturalWidth
    canvas.height = pattern.naturalHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Could not prepare the seasonal artwork')
    context.filter = 'grayscale(1) contrast(1.3) brightness(0.85)'
    context.drawImage(pattern, 0, 0)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
    const { data } = pixels
    for (let index = 0; index < data.length; index += 4) {
      const alpha = (data[index + 3] ?? 0) / 255 * 0.16
      const gray = Math.round(255 - (255 - (data[index] ?? 255)) * alpha)
      data[index] = gray
      data[index + 1] = gray
      data[index + 2] = gray
      data[index + 3] = 255
    }
    context.filter = 'none'
    context.putImageData(pixels, 0, 0)
    return canvas
  }).catch((error: unknown) => {
    if (patternCache?.promise === promise) patternCache = undefined
    throw error
  })
  patternCache = { season, promise }
  return promise
}

function releasePreparedArtwork(): void {
  const promises = [logoCanvasPromise, patternCache?.promise]
  logoCanvasPromise = undefined
  patternCache = undefined
  for (const promise of promises) void promise?.then(canvas => {
    canvas.width = 0
    canvas.height = 0
  }, () => {})
}

async function loadAssets(month: string): Promise<ExportAssets> {
  const fontBytes = await loadFontBytes()
  await loadFontFace(fontBytes)
  const [patternCanvas, logoCanvas] = await Promise.all([
    loadPatternCanvas(seasonFor(month)),
    loadLogoCanvas(),
  ])
  return { fontBytes, patternCanvas, logoCanvas }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode the export image')), type))
}

function positionText(context: CanvasRenderingContext2D, command: Extract<DrawCommand, { type: 'text' }>, scale: number): void {
  context.font = `${command.size * scale / MM_TO_PT}px MonthlyExportMono`
  context.textAlign = command.align ?? 'left'
  context.textBaseline = 'alphabetic'
  context.fillStyle = command.tone === 'primary' ? '#171717' : '#525252'
  context.fillText(command.text, command.x * scale, command.y * scale)
}

export async function renderMonthlyPng(view: MonthlyExportView, month: string, filename: string): Promise<File> {
  const assets = await loadAssets(month)
  const scale = PNG_WIDTH / PAGE.width
  const canvas = document.createElement('canvas')
  canvas.width = PNG_WIDTH
  canvas.height = PNG_HEIGHT
  try {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not render the export image')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    const commands = createLayout(view, (text, size) => {
      context.font = `${size * scale / MM_TO_PT}px MonthlyExportMono`
      return context.measureText(text).width / scale * MM_TO_PT
    })
    for (const command of commands) {
      if (command.type === 'text') positionText(context, command, scale)
      else if (command.type === 'line') {
        context.strokeStyle = '#c8c8c8'
        context.lineWidth = 0.2 * scale
        context.beginPath()
        context.moveTo(command.x1 * scale, command.y1 * scale)
        context.lineTo(command.x2 * scale, command.y2 * scale)
        context.stroke()
      } else if (command.type === 'rect') {
        context.fillStyle = 'rgba(0,0,0,0.09)'
        context.fillRect(command.x * scale, command.y * scale, command.width * scale, command.height * scale)
      } else {
        context.drawImage(command.source === 'logo' ? assets.logoCanvas : assets.patternCanvas,
          command.x * scale, command.y * scale, command.width * scale, command.height * scale)
      }
    }
    const blob = await canvasBlob(canvas, 'image/png')
    return new File([blob], filename, { type: 'image/png' })
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

export async function renderMonthlyPdf(view: MonthlyExportView, month: string, filename: string): Promise<File> {
  const assets = await loadAssets(month)
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  pdf.addFileToVFS('OldTimeyMono.ttf', bytesToBase64(assets.fontBytes))
  pdf.addFont('OldTimeyMono.ttf', 'MonthlyExportMono', 'normal')
  pdf.setFont('MonthlyExportMono', 'normal')
  pdf.setFontSize(10.5)
  const commands = createLayout(view, (text, size) => pdf.getTextWidth(text) * MM_TO_PT * (size / 10.5))
  for (const command of commands) {
    if (command.type === 'text') {
      pdf.setFontSize(command.size)
      if (command.tone === 'primary') pdf.setTextColor(23, 23, 23)
      else pdf.setTextColor(82, 82, 82)
      pdf.text(command.text, command.x, command.y, { align: command.align ?? 'left', baseline: 'alphabetic' })
    } else if (command.type === 'line') {
      pdf.setDrawColor(199, 199, 199)
      pdf.setLineWidth(0.2)
      pdf.line(command.x1, command.y1, command.x2, command.y2)
    } else if (command.type === 'rect') {
      pdf.setFillColor(0, 0, 0)
      pdf.setGState(new GState({ opacity: 0.09 }))
      pdf.rect(command.x, command.y, command.width, command.height, 'F')
      pdf.setGState(new GState({ opacity: 1 }))
    } else {
      const image = command.source === 'logo' ? assets.logoCanvas : assets.patternCanvas
      pdf.addImage(image, 'PNG', command.x, command.y, command.width, command.height,
        command.source === 'logo' ? 'vaqtpro-mark' : 'seasonal-pattern', 'FAST')
    }
  }
  const sourceX = PAGE.inset + pdf.getTextWidth(view.sourcePrefix)
  const sourceWidth = pdf.getTextWidth(view.sourceUrl)
  pdf.link(sourceX, 279 - 10.5 / MM_TO_PT, sourceWidth, 10.5 / MM_TO_PT, { url: view.sourceUrl })
  const file = new File([pdf.output('arraybuffer')], filename, { type: 'application/pdf' })
  return file
}

function bytesToBase64(bytes: ArrayBuffer): string {
  const values = new Uint8Array(bytes)
  let binary = ''
  for (let offset = 0; offset < values.length; offset += 0x8000) {
    binary += String.fromCharCode(...values.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

export interface MonthlyExportPreparation {
  pdf: File | null
  png: File | null
  failures: readonly ('pdf' | 'png')[]
}

export interface MonthlyExportRenderers {
  pdf(view: MonthlyExportView, month: string, filename: string): Promise<File>
  png(view: MonthlyExportView, month: string, filename: string): Promise<File>
}

export async function prepareMonthlyExportFiles(view: MonthlyExportView,
  renderers: MonthlyExportRenderers = { pdf: renderMonthlyPdf, png: renderMonthlyPng }): Promise<MonthlyExportPreparation> {
  const slug = view.location.normalize('NFKD').replace(/[^\p{Letter}\p{Number}]+/gu, '_').replace(/^_|_$/g, '').toLocaleLowerCase('ru-RU') || 'location'
  const prefix = `VaqtPro_${slug}_${view.month}`
  activePreparations += 1
  let pdf: File | null = null
  let png: File | null = null
  const failures: ('pdf' | 'png')[] = []
  try {
    try {
      pdf = await renderers.pdf(view, view.month, `${prefix}.pdf`)
    } catch {
      failures.push('pdf')
    }
    try {
      png = await renderers.png(view, view.month, `${prefix}.png`)
    } catch {
      failures.push('png')
    }
    if (!pdf && !png) throw new AggregateError(failures.map(format => new Error(`${format} preparation failed`)), 'Could not prepare monthly exports')
    return { pdf, png, failures }
  } finally {
    activePreparations -= 1
    if (activePreparations === 0) releasePreparedArtwork()
  }
}
