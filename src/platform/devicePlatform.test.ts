import { describe, expect, it } from 'vitest'

import { isDesktopPlatform } from './devicePlatform'

function platform(platform: string, userAgent = '', maxTouchPoints = 0, userAgentPlatform?: string) {
  return userAgentPlatform
    ? { platform, userAgent, maxTouchPoints, userAgentData: { platform: userAgentPlatform } }
    : { platform, userAgent, maxTouchPoints }
}

describe('isDesktopPlatform', () => {
  it.each(['MacIntel', 'Win32', 'Linux x86_64', 'CrOS x86_64'])('recognizes desktop platform %s', value => {
    expect(isDesktopPlatform(platform(value))).toBe(true)
  })

  it('keeps the compass available on iPhone, Android, and iPadOS desktop mode', () => {
    expect(isDesktopPlatform(platform('iPhone', 'Mozilla/5.0 (iPhone)', 5))).toBe(false)
    expect(isDesktopPlatform(platform('Linux armv8l', 'Mozilla/5.0 (Linux; Android 15)', 5))).toBe(false)
    expect(isDesktopPlatform(platform('MacIntel', 'Mozilla/5.0 (Macintosh)', 5))).toBe(false)
  })

  it('uses explicit mobile user agent evidence before a desktop client hint', () => {
    expect(isDesktopPlatform(platform('MacIntel', 'Mozilla/5.0 (iPad)', 5, 'macOS'))).toBe(false)
  })

  it('leaves unknown systems available instead of guessing desktop', () => {
    expect(isDesktopPlatform(platform('Unknown'))).toBe(false)
  })
})
