import { encode as encodePng } from 'fast-png'

interface PngEncodeRequest {
  id: number
  width: number
  height: number
  pixels: ArrayBuffer
}

interface PngEncodeResponse {
  id: number
  bytes?: ArrayBuffer
  error?: string
}

const workerScope = self as unknown as {
  addEventListener: (type: 'message', listener: (event: MessageEvent<PngEncodeRequest>) => void) => void
  postMessage: (message: PngEncodeResponse, transfer?: Transferable[]) => void
}

workerScope.addEventListener('message', ({ data }) => {
  try {
    const rgba = new Uint8Array(data.pixels)
    const grayscale = new Uint8Array(data.width * data.height)
    for (let source = 0, target = 0; target < grayscale.length; source += 4, target += 1) {
      grayscale[target] = rgba[source] ?? 255
    }
    const encoded = encodePng({ width: data.width, height: data.height, data: grayscale, channels: 1, depth: 8 }, { zlib: { level: 9 } })
    const bytes = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer
    workerScope.postMessage({ id: data.id, bytes }, [bytes])
  } catch {
    workerScope.postMessage({ id: data.id, error: 'Could not encode the export image' })
  }
})
