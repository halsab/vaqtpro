import { cp, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'

import { buildSeoPages } from './buildSeoPages'
import { checkBuildArtifacts } from './checkBuildArtifacts'

const source = resolve('dist')
const target = resolve('dist-seo-preview')

async function fingerprint(root: string, include: (path: string) => boolean): Promise<string> {
  const files: string[] = []
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) files.push(path)
    }
  }
  await visit(root)
  const hash = createHash('sha256')
  for (const file of files.sort()) {
    const localPath = relative(root, file).split(sep).join('/')
    if (!include(localPath)) continue
    hash.update(localPath).update('\0').update(await readFile(file))
  }
  return hash.digest('hex')
}

function isSeoOutput(path: string): boolean {
  return path === '404.html' || path === 'robots.txt' || path === 'sitemap.xml'
    || path === 'prayer-times-theme.css' || path.startsWith('prayer-times/')
}

async function main(): Promise<void> {
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  await cp(source, target, { recursive: true })
  const result = await buildSeoPages({
    distDirectory: target,
    referenceInstant: '2026-10-28T12:00:00.000Z',
    previewCandidates: true,
  })
  await checkBuildArtifacts(target, {
    expectedSeoCityIds: result.cityIds,
    referenceInstant: '2026-10-28T12:00:00.000Z',
    log: () => undefined,
  })
  const seoBefore = await fingerprint(target, isSeoOutput)
  const appBefore = await fingerprint(target, path => !isSeoOutput(path))
  await buildSeoPages({
    distDirectory: target,
    referenceInstant: '2026-10-28T12:00:00.000Z',
    previewCandidates: true,
  })
  if (await fingerprint(target, isSeoOutput) !== seoBefore) {
    throw new Error('Повторная генерация при тех же входных данных изменила статические SEO-артефакты')
  }
  if (await fingerprint(target, path => !isSeoOutput(path)) !== appBefore) {
    throw new Error('Генератор расписаний изменил артефакты приложения или PWA')
  }
  console.log(`Prepared isolated SEO browser fixture: ${result.cityIds.length} candidate cities; reproducible output and unchanged app assets`)
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
