import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path'

const root = resolve(process.env.SEO_STATIC_ROOT ?? 'dist')
const port = Number(process.env.PORT ?? 4175)
const host = process.env.HOST ?? '127.0.0.1'
const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.xml': 'application/xml; charset=utf-8',
}

function safePath(pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null
  const path = resolve(root, `.${decoded}`)
  const fromRoot = relative(root, path)
  return fromRoot === '' || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== '..' && !isAbsolute(fromRoot))
    ? path
    : null
}

function sendNotFound(response: import('node:http').ServerResponse, body: Buffer): void {
  response.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  response.end(body)
}

async function sendSiteNotFound(response: ServerResponse): Promise<void> {
  try {
    sendNotFound(response, await readFile(resolve(root, '404.html')))
  } catch {
    sendNotFound(response, Buffer.from('Not Found'))
  }
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const hostHeader = request.headers.host ?? 'localhost'
  const url = new URL(request.url ?? '/', `http://${hostHeader}`)

  // Тестовая старая версия SW воспроизводит прежний navigation fallback.
  if (url.pathname === '/__test__/legacy-sw.js') {
    const body = Buffer.from(`self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));self.addEventListener('fetch',event=>{if(event.request.mode==='navigate')event.respondWith(fetch('/index.html'))})`)
    response.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'service-worker-allowed': '/',
      'cache-control': 'no-store',
    })
    response.end(request.method === 'HEAD' ? undefined : body)
    return
  }
  if (url.pathname === '/__test__/bootstrap') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(request.method === 'HEAD' ? undefined : '<!doctype html><html lang="ru"><title>Тест обновления SW</title><body>Тест</body></html>')
    return
  }

  const requested = safePath(url.pathname)
  if (!requested) {
    await sendSiteNotFound(response)
    return
  }

  try {
    let metadata = await stat(requested)
    let file = requested
    if (metadata.isDirectory()) {
      if (!url.pathname.endsWith('/')) {
        response.writeHead(308, { location: `${url.pathname}/${url.search}`, 'cache-control': 'no-store' })
        response.end()
        return
      }
      file = resolve(requested, 'index.html')
      metadata = await stat(file)
    }
    if (!metadata.isFile()) throw new Error('not-a-file')
    const body = await readFile(file)
    response.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
      'content-length': body.byteLength,
      'cache-control': 'no-cache',
      ...(basename(file) === 'sw.js' ? { 'service-worker-allowed': '/' } : {}),
    })
    response.end(request.method === 'HEAD' ? undefined : body)
  } catch {
    await sendSiteNotFound(response)
  }
}

const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    if (response.headersSent) response.destroy()
    else void sendSiteNotFound(response)
  })
})

server.listen(port, host, () => console.log(`Serving ${root} at http://${host}:${port}`))
