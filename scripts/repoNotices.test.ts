import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('уведомления о лицензиях', () => {
  it('репозиторий содержит MIT лицензию и уведомления о третьих сторонах', async () => {
    const [license, notices] = await Promise.all([
      readFile(resolve(process.cwd(), 'LICENSE'), 'utf8'),
      readFile(resolve(process.cwd(), 'THIRD_PARTY_NOTICES.md'), 'utf8'),
    ])

    expect(license).toContain('MIT License')
    expect(license).toContain('Copyright (c) 2026 halsab')
    for (const expected of [
      'Old Timey Mono',
      'public/old-timey-mono-license.txt',
      'Kazan Basma Mushaf Normal',
      'Muhammet Abay',
      'GeoNames',
      'OpenStreetMap',
    ]) {
      expect(notices).toContain(expected)
    }
    expect(notices).not.toMatch(/ДУМ РТ|ДУМ РФ|dumrt\.ru/i)
    const kazanNotice = notices.split('## Шрифт: Kazan Basma Mushaf Normal')[1]?.split('\n## ')[0] ?? ''
    expect(kazanNotice).toContain('Muhammet Abay')
    expect(kazanNotice).not.toMatch(/лиценз|разрешен|разрешил|правообладател|All rights reserved|Яндекс/i)
    for (const dependency of [
      /\[React \/ ReactDOM 19\.2\.8\]\(https:\/\/github\.com\/react\/react\) — MIT/,
      /\[adhan 4\.4\.6\]\(https:\/\/github\.com\/batoulapps\/adhan-js\) — MIT/,
      /\[idb 8\.0\.3\]\(https:\/\/github\.com\/jakearchibald\/idb\) — ISC/,
      /\[vite-plugin-pwa 1\.3\.0\]\(https:\/\/github\.com\/vite-pwa\/vite-plugin-pwa\) — MIT/,
      /\[Workbox 7\.4\.1\]\(https:\/\/github\.com\/googlechrome\/workbox\) — MIT/,
      /\[Scheduler 0\.27\.0\]\(https:\/\/github\.com\/facebook\/react\) — MIT/,
    ]) {
      expect(notices).toMatch(dependency)
    }
  })
})
