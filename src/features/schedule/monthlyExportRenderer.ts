import { jsPDF } from 'jspdf'

import springPattern from '../../../public/seasonal-patterns/vaqtpro-spring-transparent-seamless.png?url'
import summerPattern from '../../../public/seasonal-patterns/vaqtpro-summer-transparent-seamless.png?url'
import autumnPattern from '../../../public/seasonal-patterns/vaqtpro-autumn-transparent-seamless.png?url'
import winterPattern from '../../../public/seasonal-patterns/vaqtpro-winter-transparent-seamless.png?url'
import fontUrl from '../../assets/OldTimeyMono.ttf?url'
import type { MonthlyExportView } from './monthlyExportModel'

const MM_TO_PT = 72 / 25.4
const PAGE = { width: 210, height: 297, inset: 15, contentWidth: 180 }
const ROW_HEIGHT = 7
const TABLE_Y = 44
const PATTERN_SIZE = 166
const PNG_WIDTH = 1600
const PNG_HEIGHT = Math.round(PNG_WIDTH * PAGE.height / PAGE.width)
const patterns = { spring: springPattern, summer: summerPattern, autumn: autumnPattern, winter: winterPattern }

type Season = keyof typeof patterns
type DrawCommand =
  | { type: 'text'; text: string; x: number; y: number; size: number; tone: 'primary' | 'secondary'; align?: 'left' | 'center' | 'right' }
  | { type: 'line'; x: number; y: number; width: number; tone: 'rule' }
  | { type: 'rect'; x: number; y: number; width: number; height: number; tone: 'stripe' }
  | { type: 'image'; x: number; y: number; width: number; height: number; source: 'pattern' | 'logo' }

function seasonFor(month: string): Season {
  const monthNumber = Number(month.slice(5, 7))
  if (monthNumber <= 2 || monthNumber === 12) return 'winter'
  if (monthNumber <= 5) return 'spring'
  if (monthNumber <= 8) return 'summer'
  return 'autumn'
}

function createLayout(view: MonthlyExportView, measure: (text: string, size: number) => number): DrawCommand[] {
  const commands: DrawCommand[] = [
    { type: 'image', source: 'pattern', x: 0, y: 0, width: PATTERN_SIZE, height: PATTERN_SIZE },
    { type: 'image', source: 'pattern', x: PATTERN_SIZE, y: 0, width: PATTERN_SIZE, height: PATTERN_SIZE },
    { type: 'image', source: 'pattern', x: 0, y: PATTERN_SIZE, width: PATTERN_SIZE, height: PATTERN_SIZE },
    { type: 'image', source: 'pattern', x: PATTERN_SIZE, y: PATTERN_SIZE, width: PATTERN_SIZE, height: PATTERN_SIZE },
    { type: 'image', source: 'logo', x: 15, y: 15, width: 17, height: 17 },
  ]
  const columns = Array.from({ length: 8 }, (_, index) => PAGE.inset + (index + 0.5) * 22.5)
  const monthX = 195
  const locationWidth = measure(view.location, 10.5)
  if (locationWidth > 87 * MM_TO_PT) throw new RangeError('Location label is too long for the approved export header')
  commands.push(
    { type: 'text', text: 'VaqtPro', x: 35, y: 20.2, size: 18, tone: 'primary' },
    { type: 'text', text: view.monthTitle, x: monthX, y: 20.2, size: 18, tone: 'primary', align: 'right' },
    { type: 'text', text: view.brandSubtitle, x: 35, y: 30.2, size: 10.5, tone: 'secondary' },
    { type: 'text', text: view.location, x: monthX, y: 30.2, size: 10.5, tone: 'secondary', align: 'right' },
  )
  for (const [index, label] of view.headers.entries()) {
    commands.push({ type: 'text', text: label, x: columns[index] ?? PAGE.inset, y: TABLE_Y + 6.3, size: 10.5, tone: 'secondary', align: 'center' })
  }
  commands.push({ type: 'line', x: 15, y: TABLE_Y + 9.2, width: 180, tone: 'rule' })
  for (const [index, row] of view.rows.entries()) {
    const y = TABLE_Y + 9.2 + index * ROW_HEIGHT
    if ((index + 1) % 2 === 0) commands.push({ type: 'rect', x: 15, y, width: 180, height: ROW_HEIGHT, tone: 'stripe' })
    const day = `${row.day} ${row.weekday}`
    commands.push({ type: 'text', text: day, x: columns[0] ?? 26, y: y + 4.8, size: 10.5, tone: 'primary', align: 'center' })
    for (const [eventIndex, event] of row.times.entries()) {
      const x = columns[eventIndex + 1] ?? 0
      const text = event.value === '—' ? '—' : `${event.estimated ? '≈ ' : ''}${event.value}`
      commands.push({ type: 'text', text, x, y: y + 4.8, size: 10.5, tone: event.value === '—' || event.estimated ? 'secondary' : 'primary', align: 'center' })
    }
  }
  commands.push(
    { type: 'text', text: `${view.sourcePrefix}${view.sourceUrl}`, x: 15, y: 285, size: 10.5, tone: 'secondary' },
  )
  return commands
}

async function loadImage(source: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.src = source
  await image.decode()
  return image
}

async function loadAssets(month: string) {
  const [fontResponse, pattern, logo] = await Promise.all([
    fetch(fontUrl), loadImage(patterns[seasonFor(month)]), loadImage('/icons/light/favicon.svg'),
  ])
  if (!fontResponse.ok) throw new Error('Could not load the VaqtPro font')
  const fontBytes = await fontResponse.arrayBuffer()
  const fontFace = new FontFace('MonthlyExportMono', `url(${fontUrl})`)
  await fontFace.load()
  document.fonts.add(fontFace)
  const tile = document.createElement('canvas')
  tile.width = pattern.naturalWidth
  tile.height = pattern.naturalHeight
  const tileContext = tile.getContext('2d', { willReadFrequently: true })
  if (!tileContext) throw new Error('Could not prepare the seasonal artwork')
  tileContext.filter = 'grayscale(1) contrast(1.3) brightness(0.85)'
  tileContext.drawImage(pattern, 0, 0)
  const pixels = tileContext.getImageData(0, 0, tile.width, tile.height)
  for (let index = 0; index < pixels.data.length; index += 4) {
    const alpha = (pixels.data[index + 3] ?? 0) / 255 * 0.16
    const gray = Math.round(255 - (255 - (pixels.data[index] ?? 255)) * alpha)
    pixels.data[index] = gray
    pixels.data[index + 1] = gray
    pixels.data[index + 2] = gray
    pixels.data[index + 3] = 255
  }
  tileContext.filter = 'none'
  tileContext.putImageData(pixels, 0, 0)
  return { fontBytes, patternCanvas: tile, logo }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode the export image')), type))
}

function positionText(context: CanvasRenderingContext2D, command: Extract<DrawCommand, { type: 'text' }>, scale: number) {
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
      context.strokeStyle = '#c8c8c8'; context.lineWidth = 0.2 * scale
      context.beginPath(); context.moveTo(command.x * scale, command.y * scale); context.lineTo((command.x + command.width) * scale, command.y * scale); context.stroke()
    } else if (command.type === 'rect') {
      context.fillStyle = 'rgba(0,0,0,0.09)'; context.fillRect(command.x * scale, command.y * scale, command.width * scale, command.height * scale)
    } else {
      const image = command.source === 'logo' ? assets.logo : assets.patternCanvas
      context.drawImage(image, command.x * scale, command.y * scale, command.width * scale, command.height * scale)
    }
  }
  return new File([await canvasBlob(canvas, 'image/png')], filename, { type: 'image/png' })
}

export async function renderMonthlyPdf(view: MonthlyExportView, month: string, filename: string): Promise<File> {
  const assets = await loadAssets(month)
  const logoCanvas = document.createElement('canvas')
  logoCanvas.width = 128; logoCanvas.height = 128
  const logoContext = logoCanvas.getContext('2d')
  if (!logoContext) throw new Error('Could not render the VaqtPro mark')
  const sourceStart = Math.round(15 / PATTERN_SIZE * assets.patternCanvas.width)
  const sourceSize = Math.round(17 / PATTERN_SIZE * assets.patternCanvas.width)
  logoContext.drawImage(assets.patternCanvas, sourceStart, sourceStart, sourceSize, sourceSize, 0, 0, 128, 128)
  logoContext.filter = 'grayscale(1)'
  logoContext.drawImage(assets.logo, 0, 0, 128, 128)
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  pdf.addFileToVFS('OldTimeyMono.ttf', bytesToBase64(assets.fontBytes))
  pdf.addFont('OldTimeyMono.ttf', 'MonthlyExportMono', 'normal')
  pdf.setFont('MonthlyExportMono', 'normal')
  pdf.setFontSize(10.5)
  const pattern = await canvasBlob(assets.patternCanvas, 'image/png')
  const patternData = await blobDataUrl(pattern)
  const logoBlob = await canvasBlob(logoCanvas, 'image/png')
  const logoData = await blobDataUrl(logoBlob)
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
      pdf.line(command.x, command.y, command.x + command.width, command.y)
    } else if (command.type === 'rect') {
      pdf.setFillColor(232, 232, 232)
      pdf.rect(command.x, command.y, command.width, command.height, 'F')
    } else {
      const image = command.source === 'logo' ? logoData : patternData
      pdf.addImage(image, 'PNG', command.x, command.y, command.width, command.height,
        command.source === 'logo' ? 'vaqtpro-mark' : 'seasonal-pattern', 'FAST')
    }
  }
  const sourceX = 15 + pdf.getTextWidth(view.sourcePrefix)
  const sourceY = 285 - 10.5 / MM_TO_PT
  const sourceWidth = pdf.getTextWidth(view.sourceUrl)
  pdf.link(sourceX, sourceY, sourceWidth, 10.5 / MM_TO_PT, { url: view.sourceUrl })
  return new File([pdf.output('arraybuffer')], filename, { type: 'application/pdf' })
}

function bytesToBase64(bytes: ArrayBuffer): string {
  const values = new Uint8Array(bytes)
  let binary = ''
  for (let offset = 0; offset < values.length; offset += 0x8000) {
    binary += String.fromCharCode(...values.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Could not encode PDF image'))
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not encode PDF image'))
    reader.readAsDataURL(blob)
  })
}

export async function prepareMonthlyExportFiles(view: MonthlyExportView): Promise<{ pdf: File; png: File }> {
  const slug = view.location.normalize('NFKD').replace(/[^\p{Letter}\p{Number}]+/gu, '_').replace(/^_|_$/g, '').toLocaleLowerCase('ru-RU') || 'location'
  const prefix = `VaqtPro_${slug}_${view.month}`
  const pdf = await renderMonthlyPdf(view, view.month, `${prefix}.pdf`)
  const png = await renderMonthlyPng(view, view.month, `${prefix}.png`)
  return { pdf, png }
}
