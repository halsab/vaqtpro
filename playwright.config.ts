import { defineConfig, devices } from '@playwright/test'

const port = 4175
const previewUrl = `http://127.0.0.1:${port}/`

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  expect: {
    timeout: process.env.CI ? 15_000 : 5_000,
  },
  use: {
    baseURL: previewUrl,
    trace: 'retain-on-failure',
  },
  projects: [
    // Release gate: основной сценарий, offline, privacy и CSP.
    {
      name: 'chromium',
      testMatch: [
        '**/smoke.spec.ts',
        '**/homepage-seo.spec.ts',
        '**/offline.spec.ts',
        '**/privacy.spec.ts',
        '**/analytics.spec.ts',
        '**/location-selection.spec.ts',
        '**/navigation-transition.spec.ts',
        '**/deferred-loading.spec.ts',
        '**/security.spec.ts',
        '**/prayer-source-upgrade.spec.ts',
      ],
      use: { ...devices['Desktop Chrome'], launchOptions: {
        args: ['--enable-features=BackForwardCache'], ignoreDefaultArgs: ['--disable-back-forward-cache'],
      } },
    },
    {
      name: 'chromium-execution-gate',
      testMatch: ['**/execution-gate.spec.ts'],
      use: { ...devices['Desktop Chrome'], serviceWorkers: 'block', launchOptions: {
        args: ['--enable-features=BackForwardCache'], ignoreDefaultArgs: ['--disable-back-forward-cache'],
      } },
    },
    // Критические сценарии мобильного WebKit (portrait).
    {
      name: 'mobile-safari-portrait',
      testMatch: ['**/mobile.spec.ts'],
      use: { ...devices['iPhone 13'] },
    },
    {
      name: 'webkit-execution-gate',
      testMatch: ['**/execution-gate.spec.ts'],
      use: { ...devices['Desktop Safari'], serviceWorkers: 'block' },
    },
    {
      name: 'webkit-deferred-loading',
      testMatch: ['**/deferred-loading.spec.ts'],
      use: { ...devices['Desktop Safari'], serviceWorkers: 'block' },
    },
    {
      name: 'webkit-mobile-jelly',
      testMatch: ['**/jelly-pointer.spec.ts'],
      use: { ...devices['iPhone 13'], browserName: 'webkit', serviceWorkers: 'block' },
    },
    {
      name: 'webkit-analytics-bfcache',
      testMatch: ['**/analytics-bfcache.spec.ts'],
      use: { ...devices['Desktop Safari'], serviceWorkers: 'block' },
    },
    // Обновление service worker меняет dist/sw.js; запускается строго после остальных.
    {
      name: 'chromium-sw',
      testMatch: '**/sw-update.spec.ts',
      dependencies: ['chromium', 'mobile-safari-portrait', 'chromium-execution-gate', 'webkit-execution-gate'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${port}`,
    url: previewUrl,
    reuseExistingServer: !process.env.CI,
  },
})
