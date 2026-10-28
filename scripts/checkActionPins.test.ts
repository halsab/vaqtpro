import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  checkWorkflowActionPins,
  reportActionPinFailure,
  validateWorkflowActionPins,
} from './checkActionPins'

const CHECKOUT_SHA = 'd23441a48e516b6c34aea4fa41551a30e30af803'

describe('workflow action pins', () => {
  it.each([
    ['tag', 'actions/checkout@v6'],
    ['branch', 'actions/checkout@main'],
    ['short SHA', 'actions/checkout@d23441a'],
  ])('отклоняет remote action через %s', (_, action) => {
    const errors = validateWorkflowActionPins(
      `steps:\n  - uses: ${action} # v6\n`,
      '.github/workflows/ci.yml',
    )

    expect(errors).toEqual([
      `.github/workflows/ci.yml:2: remote action ${action} должен использовать полный 40-символьный SHA`,
    ])
  })

  it('отклоняет полный SHA без читаемого version-комментария', () => {
    const errors = validateWorkflowActionPins(
      `steps:\n  - uses: actions/checkout@${CHECKOUT_SHA}\n`,
      '.github/workflows/ci.yml',
    )

    expect(errors).toEqual([
      '.github/workflows/ci.yml:2: actions/checkout должен иметь читаемый комментарий # vN',
    ])
  })

  it.each([
    ['inline mapping', '- { uses: actions/checkout@v6 }'],
    ['quoted inline key', '- { "uses": actions/checkout@v6 }'],
    ['anchored inline mapping', '- &checkout { uses: actions/checkout@v6 }'],
    ['block scalar', '- uses: >-\n    actions/checkout@v6'],
  ])('fail-closed отклоняет неподдерживаемый uses через %s', (_, declaration) => {
    const errors = validateWorkflowActionPins(
      `steps:\n  ${declaration}\n`,
      'workflow.yml',
    )

    expect(errors).toContain(
      'workflow.yml:2: uses должен быть записан отдельной строкой для проверки закрепления',
    )
  })

  it('отклоняет flow mapping на строке продолжения sequence item', () => {
    const errors = validateWorkflowActionPins(
      'steps:\n  -\n    { "uses": actions/checkout@v6 }\n',
      'workflow.yml',
    )

    expect(errors).toContain(
      'workflow.yml:3: uses должен быть записан отдельной строкой для проверки закрепления',
    )
  })

  it('принимает полный SHA с version-комментарием и локальный workflow', () => {
    const source = [
      'steps:',
      `  - uses: actions/checkout@${CHECKOUT_SHA} # v6`,
      'publish:',
      '  uses: ./.github/workflows/ci.yml',
    ].join('\n')

    expect(validateWorkflowActionPins(source, '.github/workflows/release.yml')).toEqual([])
  })

  it('проверяет каждую uses-строку и сохраняет точные file:line', () => {
    const source = [
      'steps:',
      '  - uses: actions/checkout@v6',
      `  - uses: actions/setup-node@${CHECKOUT_SHA}`,
      '  - uses: ./local-action',
    ].join('\n')

    expect(validateWorkflowActionPins(source, 'workflow.yml')).toEqual([
      'workflow.yml:2: remote action actions/checkout@v6 должен использовать полный 40-символьный SHA',
      'workflow.yml:3: actions/setup-node должен иметь читаемый комментарий # vN',
    ])
  })

  it('проверяет все YAML-файлы каталога и сообщает успех через logger', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vaqtpro-actions-'))
    const directory = join(root, '.github', 'workflows')
    await mkdir(directory, { recursive: true })
    await writeFile(
      join(directory, 'ci.yml'),
      `steps:\n  - uses: actions/checkout@${CHECKOUT_SHA} # v6\n`,
    )
    await writeFile(join(directory, 'ignored.txt'), 'uses: actions/checkout@v6\n')
    const messages: string[] = []

    try {
      await checkWorkflowActionPins(directory, root, (message) => messages.push(message))
      expect(messages).toEqual([
        'Все remote GitHub Actions закреплены полными SHA с version-комментариями.',
      ])
    } finally {
      await rm(root, { recursive: true })
    }
  })

  it('возвращает ошибку с относительным путём для любого незакреплённого workflow', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vaqtpro-actions-'))
    const directory = join(root, '.github', 'workflows')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'release.yaml'), 'steps:\n  - uses: actions/checkout@v6\n')

    try {
      await expect(checkWorkflowActionPins(directory, root)).rejects.toThrow(
        '.github/workflows/release.yaml:2: remote action actions/checkout@v6',
      )
    } finally {
      await rm(root, { recursive: true })
    }
  })

  it('преобразует CLI failure в сообщение и ненулевой exit code', () => {
    const previousExitCode = process.exitCode
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      reportActionPinFailure(new Error('bad pin'))
      expect(error).toHaveBeenCalledWith('bad pin')
      expect(process.exitCode).toBe(1)
    } finally {
      process.exitCode = previousExitCode
    }
  })
})
