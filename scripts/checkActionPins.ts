import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/
const VERSION_COMMENT_PATTERN = /^v\d+(?:\.\d+){0,2}(?:\s|$)/
const USES_PATTERN = /^\s*(?:-\s*)?uses:\s*(['"]?)([^'"\s#]+)\1(?:\s+#\s*(.*?)\s*)?$/
const USES_KEY_PATTERN = /^\s*(?:-\s*)?['"]?uses['"]?\s*:/
const FLOW_USES_PATTERN = /\{[^}]*?(?:["']uses["']|uses)\s*:/

export function validateWorkflowActionPins(source: string, file: string): string[] {
  const errors: string[] = []

  for (const [index, line] of source.split(/\r?\n/).entries()) {
    const match = USES_PATTERN.exec(line)
    if (!match) {
      if (USES_KEY_PATTERN.test(line) || FLOW_USES_PATTERN.test(line)) {
        errors.push(
          `${file}:${index + 1}: uses должен быть записан отдельной строкой для проверки закрепления`,
        )
      }
      continue
    }

    const target = match[2]
    const comment = match[3]
    if (!target || target.startsWith('./')) continue
    if (/^[>|]/.test(target)) {
      errors.push(
        `${file}:${index + 1}: uses должен быть записан отдельной строкой для проверки закрепления`,
      )
      continue
    }

    const separatorIndex = target.lastIndexOf('@')
    const action = separatorIndex >= 0 ? target.slice(0, separatorIndex) : target
    const reference = separatorIndex >= 0 ? target.slice(separatorIndex + 1) : ''
    const location = `${file}:${index + 1}`

    if (!FULL_SHA_PATTERN.test(reference)) {
      errors.push(
        `${location}: remote action ${target} должен использовать полный 40-символьный SHA`,
      )
      continue
    }
    if (!comment || !VERSION_COMMENT_PATTERN.test(comment)) {
      errors.push(`${location}: ${action} должен иметь читаемый комментарий # vN`)
    }
  }

  return errors
}

async function workflowFiles(directory: string): Promise<string[]> {
  return (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
    .map((entry) => join(directory, entry.name))
    .sort()
}

export async function checkWorkflowActionPins(
  directory: string,
  root = resolve('.'),
  log: (message: string) => void = console.log,
): Promise<void> {
  const errors: string[] = []

  for (const absolutePath of await workflowFiles(directory)) {
    const file = relative(root, absolutePath).split(sep).join('/')
    errors.push(...validateWorkflowActionPins(await readFile(absolutePath, 'utf8'), file))
  }

  if (errors.length > 0) {
    throw new Error(`GitHub Actions должны быть закреплены:\n${errors.join('\n')}`)
  }
  log('Все remote GitHub Actions закреплены полными SHA с version-комментариями.')
}

export function reportActionPinFailure(error: unknown): void {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}

const entryPoint = process.argv[1]
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  const root = resolve('.')
  void checkWorkflowActionPins(join(root, '.github', 'workflows'), root)
    .catch(reportActionPinFailure)
}
