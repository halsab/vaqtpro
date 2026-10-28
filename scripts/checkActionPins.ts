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

export function validateSeoRefreshWorkflow(refresh: string, release: string): string[] {
  const errors: string[] = []
  const requires = (source: string, pattern: RegExp, message: string) => {
    if (!pattern.test(source)) errors.push(message)
  }

  requires(release, /group:\s*production-release/, 'release.yml: production deployment must use the shared production-release concurrency group')
  requires(refresh, /group:\s*production-release/, 'seo-refresh.yml: timetable refresh must use the shared production-release concurrency group')
  requires(release, /queue:\s*max/, 'release.yml: production deploys must queue instead of replacing a pending release')
  requires(refresh, /queue:\s*max/, 'seo-refresh.yml: timetable refreshes must queue instead of replacing a pending deployment')
  requires(release, /cancel-in-progress:\s*false/, 'release.yml: production deployment cannot be cancelled in progress')
  requires(refresh, /cancel-in-progress:\s*false/, 'seo-refresh.yml: production deployment cannot be cancelled in progress')
  requires(refresh, /if:\s*vars\.VAQT_PRO_SEO_REFRESH_APPROVED\s*==\s*'true'/, 'seo-refresh.yml: recurring publication must remain disabled until the owner enables its repository variable')
  requires(refresh, /if:\s*github\.event_name\s*==\s*'workflow_dispatch'\s*&&\s*github\.ref\s*!=\s*'refs\/heads\/main'/, 'seo-refresh.yml: manual production refresh must refuse workflow definitions from non-main branches')
  requires(refresh, /ref:\s*\$\{\{\s*steps\.source\.outputs\.release_tag\s*\}\}/, 'seo-refresh.yml: refresh must check out an exact released tag')
  requires(refresh, /commit=\$\(git rev-parse HEAD\)/, 'seo-refresh.yml: release commit must be recorded from the checked-out tag')
  requires(refresh, /SEO_SOURCE_COMMIT:\s*\$\{\{\s*steps\.revision\.outputs\.commit\s*\}\}/, 'seo-refresh.yml: schedule calculation revision must match the released source tag')
  requires(refresh, /gh release view/, 'seo-refresh.yml: scheduled refresh must select an existing GitHub Release')
  requires(refresh, /^\s{6}reference_instant:/m, 'seo-refresh.yml: manual refresh must accept a reproducible reference instant for rollback')
  requires(refresh, /REQUESTED_INSTANT:\s*\$\{\{\s*inputs\.reference_instant\s*\}\}/, 'seo-refresh.yml: rollback reference instant must drive the deterministic timetable build')
  requires(refresh, /SEO_REQUIRE_PUBLICATION:\s*'true'/, 'seo-refresh.yml: refresh must fail closed when no city is approved')
  requires(refresh, /name:\s*github-pages/, 'seo-refresh.yml: production publish must use the existing GitHub Pages environment')
  requires(refresh, /notify-failure:[\s\S]*?issues:\s*write[\s\S]*?gh issue (?:create|comment)/, 'seo-refresh.yml: failed refresh must notify the owner through an actionable issue')

  const build = refresh.indexOf('npm run build')
  const artifact = refresh.indexOf('actions/upload-pages-artifact@')
  const deploy = refresh.indexOf('actions/deploy-pages@')
  if (build < 0 || artifact < build || deploy < artifact) {
    errors.push('seo-refresh.yml: build and validation must finish before the Pages artifact is uploaded and deployed')
  }
  if (/git tag|gh release create|gh release upload/.test(refresh)) {
    errors.push('seo-refresh.yml: SEO refresh must not create or change an application release')
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

export async function checkSeoRefreshWorkflow(root = resolve('.')): Promise<void> {
  const directory = join(root, '.github', 'workflows')
  const refresh = await readFile(join(directory, 'seo-refresh.yml'), 'utf8')
  const release = await readFile(join(directory, 'release.yml'), 'utf8')
  const errors = validateSeoRefreshWorkflow(refresh, release)
  if (errors.length > 0) throw new Error(`Нарушена безопасность публикации расписаний:\n${errors.join('\n')}`)
}

export function reportActionPinFailure(error: unknown): void {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}

const entryPoint = process.argv[1]
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  const root = resolve('.')
  void Promise.all([
    checkWorkflowActionPins(join(root, '.github', 'workflows'), root),
    checkSeoRefreshWorkflow(root),
  ])
    .catch(reportActionPinFailure)
}
