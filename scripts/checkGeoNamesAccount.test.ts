import { describe, expect, it, vi } from 'vitest'
import { checkGeoNamesAccount } from './checkGeoNamesAccount'

describe('GeoNames production account check', () => {
  it('uses one bounded name-only request and validates a real result', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ geonames: [{ geonameId: 2643743, name: 'London' }] }), { status: 200 }),
    )
    await expect(checkGeoNamesAccount('example-account', fetcher)).resolves.toBeUndefined()
    const url = new URL(fetcher.mock.calls[0]?.[0] as URL)
    expect(url.searchParams.get('name_startsWith')).toBe('London')
    expect(url.searchParams.get('maxRows')).toBe('1')
    expect(url.searchParams.get('username')).toBe('example-account')
    expect(url.searchParams.has('lat')).toBe(false)
    expect(url.searchParams.has('lng')).toBe(false)
  })

  it.each([{ status: { value: 10, message: 'authorization' } }, { status: { value: 18, message: 'quota' } }, { geonames: [] }])(
    'rejects provider failures and empty results', async payload => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }))
      await expect(checkGeoNamesAccount('example-account', fetcher)).rejects.toThrow()
    },
  )

  it('does not send requests without an account', async () => {
    const fetcher = vi.fn<typeof fetch>()
    await expect(checkGeoNamesAccount('', fetcher)).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
})
