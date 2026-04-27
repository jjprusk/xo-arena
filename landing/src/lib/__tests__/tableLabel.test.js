// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect } from 'vitest'
import { formatTableLabel } from '../tableLabel.js'

describe('formatTableLabel (frontend mirror)', () => {
  it('returns "Table" for null/undefined', () => {
    expect(formatTableLabel(null)).toBe('Table')
    expect(formatTableLabel(undefined)).toBe('Table')
  })

  it('HvB: "vs <BotName>" when viewer is the host', () => {
    const room = {
      isHvb: true,
      hostUserId: 'ba_alice',
      hostUserDisplayName: 'Alice',
      guestUserDisplayName: 'Rusty',
    }
    expect(formatTableLabel(room, 'ba_alice')).toBe('vs Rusty')
  })

  it('HvB: third-party viewer gets "<HostName> vs <BotName>"', () => {
    const room = {
      isHvb: true,
      hostUserId: 'ba_alice',
      hostUserDisplayName: 'Alice',
      guestUserDisplayName: 'Rusty',
    }
    expect(formatTableLabel(room, 'ba_other')).toBe('Alice vs Rusty')
  })

  it('Bot game spectator (isBotGame): bot1 vs bot2 even without seats array', () => {
    const room = {
      isBotGame: true,
      bot1: { displayName: 'Copper' },
      bot2: { displayName: 'Sterling' },
      hostUserDisplayName: 'Copper',
    }
    // The viewer is a spectator, not the host — fallthrough to host vs bot.
    expect(formatTableLabel(room, null)).toBe('Copper vs Sterling')
  })

  it('PvP waiting: "<HostName> · waiting"', () => {
    const room = {
      status: 'waiting',
      hostUserId: 'ba_alice',
      hostUserDisplayName: 'Alice',
      guestUserId: null,
    }
    expect(formatTableLabel(room)).toBe('Alice · waiting')
  })

  it('PvP playing: "<HostName> vs <OpponentName>"', () => {
    const room = {
      status: 'playing',
      hostUserId: 'ba_alice',
      hostUserDisplayName: 'Alice',
      guestUserId: 'ba_bob',
      guestUserDisplayName: 'Bob',
    }
    expect(formatTableLabel(room)).toBe('Alice vs Bob')
  })

  it('Demo: "Demo · <BotA> vs <BotB>"', () => {
    const room = {
      isDemo: true,
      botA: { displayName: 'Copper' },
      botB: { displayName: 'Sterling' },
    }
    expect(formatTableLabel(room)).toBe('Demo · Copper vs Sterling')
  })

  it('Fallback uses short slug when host name missing', () => {
    const room = {
      slug: 'abcdefghij',
      status: 'waiting',
      guestUserId: null,
    }
    expect(formatTableLabel(room)).toBe('Table abcdef · waiting')
  })
})
