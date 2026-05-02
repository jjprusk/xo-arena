// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * demoTableMatchups — sanity guards for the curated Hook step-2 list.
 *
 * The list was originally added without checks; two same-bot entries
 * (Copper vs Copper, Sterling vs Sterling) shipped to the demo. Two
 * identical avatars labeled the same name read as a bug to first-time
 * users (and triggered a React duplicate-key warning in the seat list).
 * These checks lock the list shape so a future edit can't silently
 * regress.
 */
import { describe, it, expect } from 'vitest'
import { DEMO_TABLE_MATCHUPS, pickMatchup } from '../demoTableMatchups.js'

describe('DEMO_TABLE_MATCHUPS', () => {
  it('contains at least one entry', () => {
    expect(DEMO_TABLE_MATCHUPS.length).toBeGreaterThan(0)
  })

  it('every entry pairs two DIFFERENT bots', () => {
    for (const m of DEMO_TABLE_MATCHUPS) {
      expect(m.x, `entry has x but no o: ${JSON.stringify(m)}`).toBeTruthy()
      expect(m.o, `entry has o but no x: ${JSON.stringify(m)}`).toBeTruthy()
      expect(m.x, `same-bot matchup is hokey for spectators: ${JSON.stringify(m)}`).not.toBe(m.o)
    }
  })

  it('every entry references a known seeded built-in bot', () => {
    const allowed = new Set(['bot-rusty', 'bot-copper', 'bot-sterling', 'bot-magnus'])
    for (const m of DEMO_TABLE_MATCHUPS) {
      expect(allowed.has(m.x), `unknown bot username: ${m.x}`).toBe(true)
      expect(allowed.has(m.o), `unknown bot username: ${m.o}`).toBe(true)
    }
  })
})

describe('pickMatchup', () => {
  it('returns an entry from the list (with deterministic rng)', () => {
    // rng=0 picks index 0 deterministically.
    expect(pickMatchup(() => 0)).toEqual(DEMO_TABLE_MATCHUPS[0])
    // rng→1 (effectively last) picks the last index — Math.floor handles
    // the half-open interval correctly.
    const last = DEMO_TABLE_MATCHUPS[DEMO_TABLE_MATCHUPS.length - 1]
    expect(pickMatchup(() => 0.999)).toEqual(last)
  })

  it('default rng covers every entry across many calls (no dead code paths)', () => {
    const seen = new Set()
    for (let i = 0; i < 200; i++) {
      const m = pickMatchup()
      seen.add(`${m.x}|${m.o}`)
    }
    // 200 trials over N entries with uniform Math.random — vanishingly
    // unlikely to skip an entry. If this flakes, the rng or list is wrong.
    expect(seen.size).toBe(DEMO_TABLE_MATCHUPS.length)
  })
})
