// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect } from 'vitest'
import { formatTableLabel } from '../tableLabel.js'

describe('formatTableLabel', () => {
  it('returns "Table" for null/undefined', () => {
    expect(formatTableLabel(null)).toBe('Table')
    expect(formatTableLabel(undefined)).toBe('Table')
  })

  it('HvB: "vs <BotName>" for the seated viewer', () => {
    const table = {
      isHvb: true,
      slug: 'abc12345',
      seats: [
        { userId: 'ba_alice', status: 'occupied', displayName: 'Alice' },
        { userId: 'bot_rusty', status: 'occupied', displayName: 'Rusty' },
      ],
    }
    expect(formatTableLabel(table, 'ba_alice')).toBe('vs Rusty')
  })

  it('HvB: third-party viewer gets "<HostName> vs <BotName>"', () => {
    const table = {
      isHvb: true,
      seats: [
        { userId: 'ba_alice', status: 'occupied', displayName: 'Alice' },
        { userId: 'bot_rusty', status: 'occupied', displayName: 'Rusty' },
      ],
    }
    expect(formatTableLabel(table, 'ba_other')).toBe('Alice vs Rusty')
  })

  it('PvP FORMING: "<HostName> · waiting"', () => {
    const table = {
      status: 'FORMING',
      seats: [
        { userId: 'ba_alice', status: 'occupied', displayName: 'Alice' },
        { userId: null, status: 'empty' },
      ],
    }
    expect(formatTableLabel(table)).toBe('Alice · waiting')
  })

  it('PvP ACTIVE: "<HostName> vs <OpponentName>"', () => {
    const table = {
      status: 'ACTIVE',
      seats: [
        { userId: 'ba_alice', status: 'occupied', displayName: 'Alice' },
        { userId: 'ba_bob',   status: 'occupied', displayName: 'Bob' },
      ],
    }
    expect(formatTableLabel(table)).toBe('Alice vs Bob')
  })

  it('Tournament table renders the same as a PvP ACTIVE table', () => {
    const table = {
      status: 'ACTIVE',
      isTournament: true,
      seats: [
        { userId: 'ba_alice', status: 'occupied', displayName: 'Alice' },
        { userId: 'ba_bob',   status: 'occupied', displayName: 'Bob' },
      ],
    }
    expect(formatTableLabel(table)).toBe('Alice vs Bob')
  })

  it('Demo: "Demo · <BotA> vs <BotB>"', () => {
    const table = {
      isDemo: true,
      seats: [
        { userId: 'bot_copper',   status: 'occupied', displayName: 'Copper' },
        { userId: 'bot_sterling', status: 'occupied', displayName: 'Sterling' },
      ],
    }
    expect(formatTableLabel(table)).toBe('Demo · Copper vs Sterling')
  })

  it('Fallback when names missing: "Table <slug.slice(0,6)> · waiting"', () => {
    const table = {
      slug: 'abcdefghij',
      status: 'FORMING',
      seats: [
        { userId: 'ba_x', status: 'occupied' },
        { userId: null, status: 'empty' },
      ],
    }
    expect(formatTableLabel(table)).toBe('Table abcdef · waiting')
  })

  it('Fallback when host name missing on ACTIVE table: "Table <slug>"', () => {
    const table = {
      slug: 'zzzzzzzz',
      status: 'ACTIVE',
      seats: [
        { userId: 'ba_x', status: 'occupied' },
        { userId: 'ba_y', status: 'occupied' },
      ],
    }
    expect(formatTableLabel(table)).toBe('Table zzzzzz')
  })
})
