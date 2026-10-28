import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { themePalettes } from './src/ui/themePalette.ts'

const packageMetadata = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as { version: string }
const LOCAL_APP_VERSION = `v${packageMetadata.version}`
const ICON_DIRECTORIES = ['light', 'dark'] as const
const ICON_VERSION_HASH = createHash('sha256')
for (const theme of ICON_DIRECTORIES) {
  const directory = new URL(`./public/icons/${theme}/`, import.meta.url)
  for (const file of readdirSync(directory).sort()) {
    ICON_VERSION_HASH.update(file)
    ICON_VERSION_HASH.update(readFileSync(new URL(file, directory)))
  }
}
const ICON_VERSION = ICON_VERSION_HASH.digest('hex').slice(0, 12)
const iconUrl = (theme: string, file: string) => `icons/${theme}/${file}?v=${ICON_VERSION}`

// Синхронная bootstrap-палитра устраняет prepaint flash без ожидания IndexedDB или сети.
const INITIAL_THEME_BOOTSTRAP = `(()=>{const root=document.documentElement;let family='seasonal';try{const value=JSON.parse(localStorage.getItem('salah-theme-preference-v1')||'null');if(value&&value.version===1&&(value.themeFamily==='classic'||value.themeFamily==='seasonal'))family=value.themeFamily}catch{}const month=new Date().getMonth()+1;const season=month===12||month<=2?'winter':month<=5?'spring':month<=8?'summer':'autumn';let tone='light';try{tone=typeof matchMedia==='function'&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}catch{}const palettes=${JSON.stringify(themePalettes)};const key=family==='classic'?'classic-'+tone:season+'-'+tone;const palette=palettes[key];for(const [name,property] of Object.entries({backgroundPrimary:'--background-primary',backgroundSecondary:'--background-secondary',backgroundTertiary:'--background-tertiary',textPrimary:'--text-primary',textSecondary:'--text-secondary',accentCountdown:'--accent-countdown'}))root.style.setProperty(property,palette[name]);root.style.colorScheme=tone;root.dataset.theme=family;root.dataset.themeTone=tone;root.dataset.season=season;const meta=document.querySelector('meta[name="theme-color"]')||document.createElement('meta');meta.name='theme-color';meta.content=palette.backgroundPrimary;if(!meta.isConnected)document.head.append(meta)})()`
const INITIAL_THEME_HASH = createHash('sha256').update(INITIAL_THEME_BOOTSTRAP).digest('base64')
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  `script-src 'self' https://static.cloudflareinsights.com 'sha256-${INITIAL_THEME_HASH}'`,
  "style-src 'self'",
  "style-src-elem 'self'",
  // AppShell обновляет CSS-переменные видимой области при открытии клавиатуры.
  "style-src-attr 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self'",
  "connect-src 'self' https://cloudflareinsights.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-src 'none'",
  "media-src 'none'",
  "form-action 'none'",
].join('; ')

export default defineConfig({
  server: { host: '0.0.0.0' },
  base: '/',
  define: {
    'import.meta.env.VITE_APP_PACKAGE_VERSION': JSON.stringify(LOCAL_APP_VERSION),
  },
  build: {
    minify: 'terser',
    terserOptions: { compress: { passes: 2 }, maxWorkers: 2 },
  },
  // Worker минифицируется отдельно от основного пакета Terser.
  worker: { rolldownOptions: { output: { minify: true } } },
  plugins: [
    {
      name: 'production-content-security-policy',
      apply: 'build',
      transformIndexHtml: {
        order: 'pre',
        handler: () => [{
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: CONTENT_SECURITY_POLICY,
          },
          injectTo: 'head-prepend',
        }, {
          tag: 'script',
          children: INITIAL_THEME_BOOTSTRAP,
          injectTo: 'head-prepend',
        }],
      },
    },
    {
      name: 'development-initial-theme-bootstrap',
      apply: 'serve',
      transformIndexHtml: {
        order: 'pre',
        handler: () => [{ tag: 'script', children: INITIAL_THEME_BOOTSTRAP, injectTo: 'head-prepend' }],
      },
    },
    {
      name: 'icon-asset-version',
      transformIndexHtml: {
        order: 'pre',
        handler: html => html.replaceAll('%ICON_VERSION%', ICON_VERSION),
      },
    },
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['old-timey-mono-license.txt', 'data/ODbL-1.0.txt', 'data/tatarstan-boundary.NOTICE.txt'],
      manifest: {
        name: 'VaqtPro — времена намаза',
        short_name: 'VaqtPro',
        description: 'Время намаза для выбранного места: независимый расчёт на устройстве. Сохранённые данные доступны офлайн.',
        lang: 'ru',
        display: 'standalone',
        background_color: '#000000',
        theme_color: '#000000',
        id: '/',
        start_url: '/',
        scope: '/',
        icons: [
          ...[192, 512, 1024].map(size => ({
            src: iconUrl('light', `icon-${size}.png`),
            sizes: `${size}x${size}`,
            type: 'image/png',
            purpose: 'any',
          })),
          ...[192, 512, 1024].map(size => ({
            src: iconUrl('light', `icon-maskable-${size}.png`),
            sizes: `${size}x${size}`,
            type: 'image/png',
            purpose: 'maskable',
          })),
        ]
      },
      workbox: {
        cleanupOutdatedCaches: true,
        importScripts: ['city-cache-cleanup.js'],
        navigateFallback: 'index.html',
        ignoreURLParametersMatching: [/^v$/, /^utm_/i, /^fbclid$/i],
        navigateFallbackDenylist: [/^\/prayer-times(?:\/|$)/],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,ttf,json}'],
        globIgnores: [
          '**/data/cities-current.json',
          '**/data/cities/*/*.json',
          'city-cache-cleanup.js',
        ],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /\/data\/cities\/[a-f0-9]{20}\/[A-Z]{2}-[0-9]+\.json$/,
            // Проверенные пакеты сохраняет Worker в IndexedDB; сырой ответ не кешируем.
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: { enabled: false }
    })
  ]
})
