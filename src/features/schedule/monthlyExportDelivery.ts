export interface ShareEnvironment {
  share?: ((data: ShareData) => Promise<void>) | undefined
  canShare?: ((data: ShareData) => boolean) | undefined
}

export type DeliveryResult = 'shared' | 'download-started' | 'cancelled' | 'failed'

export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.name
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function deliverFile(file: File, environment: ShareEnvironment,
  fallback: (file: File) => void = downloadFile): Promise<DeliveryResult> {
  const data: ShareData = { files: [file] }
  let supported = false
  try {
    supported = typeof environment.share === 'function'
      && typeof environment.canShare === 'function'
      && environment.canShare(data)
  } catch {
    supported = false
  }
  if (!supported || !environment.share) {
    fallback(file)
    return 'download-started'
  }
  try {
    await environment.share(data)
    return 'shared'
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
    return 'failed'
  }
}
