import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'

import { ExecutionGateView } from './platform/ExecutionGateView'
import { cleanDeferredModuleReloadUrl } from './platform/deferredModuleRecovery'
import { initializeCloudflareAnalytics } from './platform/analytics'
import { createServiceWorkerReloadGuard } from './platform/serviceWorkerUpdate'
import './styles.css'
import './ui/screen.css'

initializeCloudflareAnalytics()

registerSW({
  immediate: true,
  onNeedReload: createServiceWorkerReloadGuard(),
})

const root = document.getElementById('root')
if (!root) throw new Error('Не найден корневой элемент приложения')
const cleanUrl = cleanDeferredModuleReloadUrl(window.location.href)
if (cleanUrl !== window.location.href) window.history.replaceState(window.history.state, '', cleanUrl)

// Фокусное кольцо контролов показываем только после клавиатурного ввода.
// WebKit после тапа оставляет светлый outline на select и строках с ним.
const inputRoot = document.documentElement
inputRoot.dataset.input = 'keyboard'
window.addEventListener('keydown', () => { inputRoot.dataset.input = 'keyboard' }, true)
window.addEventListener('pointerdown', () => { inputRoot.dataset.input = 'pointer' }, true)

createRoot(root).render(
  <StrictMode>
    <ExecutionGateView />
  </StrictMode>,
)
