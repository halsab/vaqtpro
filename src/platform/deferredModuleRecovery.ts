const RECOVERY_PARAM = '__deferred_module_reload'
let retrySequence = 0

export function deferredModuleReloadUrl(currentUrl: string): string {
  const url = new URL(currentUrl)
  url.searchParams.set(RECOVERY_PARAM, Date.now().toString(36))
  return url.toString()
}

export function cleanDeferredModuleReloadUrl(currentUrl: string): string {
  const url = new URL(currentUrl)
  if (!url.searchParams.has(RECOVERY_PARAM)) return currentUrl
  url.searchParams.delete(RECOVERY_PARAM)
  return url.toString()
}

export function deferredModuleRetryUrl(moduleName: string, currentUrl: string, moduleUrl: string): string | null {
  const page = new URL(currentUrl)
  const escapedName = moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const assetPattern = new RegExp(`/${escapedName}-[A-Za-z0-9_-]+\\.js$`)
  try {
    const asset = new URL(moduleUrl, page)
    if (asset.origin !== page.origin || !assetPattern.test(asset.pathname)) return null
    asset.searchParams.set(RECOVERY_PARAM, `${Date.now().toString(36)}-${++retrySequence}`)
    return asset.toString()
  } catch { return null }
}
