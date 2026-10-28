import { expect, test } from './fixtures'

test('homepage exposes one stable canonical and homepage-only crawler files', async ({ request }) => {
  const response = await request.get('/?place=moskva&month=2026-10')
  expect(response.ok()).toBe(true)
  const html = await response.text()
  expect(html.match(/<title>/gi)).toHaveLength(1)
  expect(html).toContain('<title>VaqtPro — времена намаза</title>')
  expect(html.match(/<meta\s+name="description"/gi)).toHaveLength(1)
  expect(html).toContain('name="description" content="Время намаза для выбранного места: независимый расчёт на устройстве. Сохранённые данные доступны офлайн."')
  expect(html.match(/<link\b[^>]*\brel="canonical"[^>]*>/gi)).toEqual([
    '<link rel="canonical" href="https://vaqt.pro/" />',
  ])

  const robotsResponse = await request.get('/robots.txt')
  expect(robotsResponse.ok()).toBe(true)
  expect(await robotsResponse.text()).toBe('User-agent: *\nAllow: /\nSitemap: https://vaqt.pro/sitemap.xml\n')

  const sitemapResponse = await request.get('/sitemap.xml')
  expect(sitemapResponse.ok()).toBe(true)
  const sitemap = await sitemapResponse.text()
  expect([...sitemap.matchAll(/<loc>/g)]).toHaveLength(1)
  expect(sitemap).toContain('<loc>https://vaqt.pro/</loc>')
  expect(sitemap).not.toMatch(/<lastmod\b/i)
})
