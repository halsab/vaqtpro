import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import ts from 'typescript'

const ROOT = resolve(import.meta.dirname, '..')
const MAX_CASES = 250
const IGNORED = new Set(['.git', '.vitest', 'node_modules', 'dist', 'coverage', 'test-results', 'playwright-report', 'public'])
const SOURCE = /\.(?:[cm]?[jt]sx?)$/

function command(bin, args) {
  const exe = resolve(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? bin + '.cmd' : bin)
  const result = spawnSync(exe, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (result.error || result.status !== 0) {
    throw new Error(`${bin} ${args.join(' ')} discovery failed (exit ${result.status}):\n${result.stderr || result.stdout || result.error}`)
  }
  return result.stdout
}

function walk(root) {
  const files = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED.has(entry.name)) files.push(...walk(join(root, entry.name)))
    } else if (entry.isFile() && SOURCE.test(entry.name)) {
      files.push(join(root, entry.name))
    }
  }
  return files
}

function testRoot(expression) {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return testRoot(expression.expression)
  if (ts.isElementAccessExpression(expression)) return testRoot(expression.expression)
  if (ts.isCallExpression(expression)) return testRoot(expression.expression)
  return null
}

function registersTest(file) {
  const content = readFileSync(file, 'utf8')
  const kind = file.endsWith('.tsx') || file.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, kind)
  let found = false
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const root = testRoot(node.expression)
      const name = node.expression.getText(source)
      if ((root === 'it' || root === 'test' || root === 'specify') && !/\.(?:describe|step|use|extend|setTimeout|setConfig)\b/.test(name)) {
        // Detect registrations even when the file is renamed or excluded by the runner.
        found = true
      }
    }
    if (!found) ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

function discoverVitest() {
  const directory = mkdtempSync(join(tmpdir(), 'vaqtpro-test-budget-'))
  const file = join(directory, 'vitest-list.json')
  try {
    command('vitest', ['list', `--json=${file}`])
    const list = JSON.parse(readFileSync(file, 'utf8'))
    if (!Array.isArray(list)) throw new Error('Unexpected Vitest discovery JSON: expected a case array')
    const discoveredFiles = new Set()
    for (const item of list) {
      const filepath = item.filepath ?? item.file ?? item.location?.file ?? item.moduleId
      if (typeof filepath !== 'string') throw new Error('Vitest case lacks filepath; count cannot be trusted')
      discoveredFiles.add(resolve(ROOT, filepath))
    }
    return { count: list.length, files: discoveredFiles }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function discoverPlaywright() {
  const listing = command('playwright', ['test', '--list'])
  const result = listing.match(/Total:\s*(\d+)\s+tests?\s+in\s+\d+\s+files?/i)
  if (!result) throw new Error('Could not parse Playwright test-list total: ' + listing.slice(-1200))
  const collectedFiles = new Set()
  for (const line of listing.split(/\r?\n/)) {
    const match = line.match(/(?:^|›)\s*(tests\/[^\s›]+\.spec\.[jt]sx?):\d+:\d+\s*›/)
    if (match) collectedFiles.add(resolve(ROOT, match[1]))
  }
  if (Number(result[1]) && collectedFiles.size === 0) throw new Error('Playwright cases found, but source files could not be identified')
  return { count: Number(result[1]), files: collectedFiles }
}

function main() {
  const vitest = discoverVitest()
  const playwright = discoverPlaywright()
  const allCases = vitest.count + playwright.count
  const collected = new Set([...vitest.files, ...playwright.files])
  const missing = walk(ROOT)
    .filter(path => registersTest(path) && !collected.has(path))
    .map(path => relative(ROOT, path).split(sep).join('/'))
  if (missing.length) throw new Error('Uncollected test declarations (rename/config bypass):\n' + missing.join('\n'))
  if (allCases === 0) throw new Error('Test discovery returned zero cases')
  process.stdout.write(`Test budget: Vitest ${vitest.count} + Playwright ${playwright.count} = ${allCases} / ${MAX_CASES}\n`)
  if (allCases > MAX_CASES) {
    throw new Error(`Hard test-budget limit exceeded: ${allCases} > ${MAX_CASES} (over by ${allCases - MAX_CASES})`)
  }
}
try { main() } catch (error) { console.error(error); process.exitCode = 1 }
