type PlatformNavigator = Pick<Navigator, 'platform' | 'userAgent' | 'maxTouchPoints'> & {
  userAgentData?: { platform?: string }
}

export function isDesktopPlatform(device: PlatformNavigator): boolean {
  const userAgent = device.userAgent.toLowerCase()
  const platform = (device.userAgentData?.platform || device.platform).toLowerCase()

  if (/android|iphone|ipad|ipod/.test(userAgent) || /android|ios|ipados/.test(platform)) return false
  if (/mac|ipad/.test(platform) && device.maxTouchPoints > 1) return false
  return /windows|win32|win64|mac|linux|x11|cros|chrome os/.test(platform)
}
