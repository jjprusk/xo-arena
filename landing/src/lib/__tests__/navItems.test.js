// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect } from 'vitest'
// Nav definition lives in `packages/nav` and is consumed via the
// `@xo-arena/nav` alias from landing. Keeping this contract test in
// landing/ ensures it runs under the pre-commit hook.
import { PRIMARY_NAV, resolveItem } from '@xo-arena/nav'

describe('PRIMARY_NAV', () => {
  it('has 6 items, under the 5-7 soft ceiling', () => {
    expect(PRIMARY_NAV).toHaveLength(6)
  })

  it('keys are unique', () => {
    const keys = PRIMARY_NAV.map(i => i.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('includes Bots and excludes About (Bot_Challenge_Plan B.1.x)', () => {
    const keys = PRIMARY_NAV.map(i => i.key)
    expect(keys).toContain('bots')
    expect(keys).not.toContain('about')
  })

  it('Bots item routes to /bots on the landing app', () => {
    const bots = PRIMARY_NAV.find(i => i.key === 'bots')
    expect(bots).toMatchObject({ label: 'Bots', to: '/bots', app: 'landing' })
  })

  it('every item has the four required fields', () => {
    for (const item of PRIMARY_NAV) {
      expect(item).toEqual(expect.objectContaining({
        key:   expect.any(String),
        label: expect.any(String),
        app:   expect.any(String),
        to:    expect.any(String),
      }))
    }
  })
})

describe('resolveItem', () => {
  const item = { key: 'bots', label: 'Bots', app: 'landing', to: '/bots' }

  it('returns internal routing when item.app matches the current appId', () => {
    expect(resolveItem(item, 'landing', { landing: 'http://x', xo: 'http://y' }))
      .toEqual({ href: '/bots', internal: true })
  })

  it('returns a cross-site href when the app differs', () => {
    expect(resolveItem(item, 'xo', { landing: 'http://landing.x', xo: 'http://xo.x' }))
      .toEqual({ href: 'http://landing.x/bots', internal: false })
  })

  it('returns null href + internal=false for an item with no `to`', () => {
    expect(resolveItem({ ...item, to: null }, 'landing', {}))
      .toEqual({ href: null, internal: false })
  })
})
