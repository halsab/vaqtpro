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
    // Each case runs in exactly one risk-appropriate browser project.
    {
      name: 'chromium',
      testMatch: [
        '**/smoke.spec.ts',
        '**/offline.spec.ts',
        '**/privacy.spec.ts',
        '**/security.spec.ts',
        '**/location-selection.spec.ts',
        '**/navigation-transition.spec.ts',
        '**/fasting-duas.spec.ts',
        '**/ramadan-dhikr.spec.ts',
      ],
      use: { ...devices['Desktop Chrome'], launchOptions: {
        args: ['--enable-features=BackForwardCache'],
        ignoreDefaultArgs: ['--disable-back-forward-cache'],
      } },
    },
    {
      name: 'mobile-safari-portrait',
      testMatch: [
        '**/mobile.spec.ts',
        '**/qibla.spec.ts',
        '**/arabic-typography.spec.ts',
      ],
      use: { ...devices['iPhone 13'] },
    },
    {
      name: 'chromium-execution-gate',
      testMatch: ['**/execution-gate.spec.ts'],
      use: { ...devices['Desktop Chrome'], serviceWorkers: 'block' },
    },
    // This test intentionally updates dist/sw.js and must run after the others.
    {
      name: 'chromium-sw',
      testMatch: ['**/sw-update.spec.ts'],
      dependencies: ['chromium', 'mobile-safari-portrait', 'chromium-execution-gate'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${port}`,
    url: previewUrl,
    reuseExistingServer: !process.env.CI,
  },
})
