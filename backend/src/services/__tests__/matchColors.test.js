// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * matchColors — A2.3 unit tests.
 *
 * The helper is fully pure (no DB, no clock), so tests pin specific seeds
 * and assert deterministic outcomes. The exact "which seed maps to which
 * starter" values are derived from sha256(seed) and locked in here so a
 * future refactor of the hash can't silently change the assignment for
 * matches already in flight.
 */
import { describe, it, expect } from 'vitest'
import { assignColors } from '../matchColors.js'

// Two seeds whose sha256 first byte has opposite parity. Pinned so the
// "starter flips with seed" tests are unambiguous.
const SEED_P1_STARTS = 'a'  // sha256('a')[0] & 1 === 0  → player1 starts game 1
const SEED_P2_STARTS = 'e'  // sha256('e')[0] & 1 === 1  → player2 starts game 1

describe('assignColors — argument validation', () => {
  it('throws when seed is missing', () => {
    expect(() => assignColors({ seed: '', player1Id: 'p1', player2Id: 'p2', sequence: 1 }))
      .toThrow(/seed required/)
  })

  it('throws when player1Id is missing', () => {
    expect(() => assignColors({ seed: 'x', player1Id: '', player2Id: 'p2', sequence: 1 }))
      .toThrow(/player1Id required/)
  })

  it('throws when player2Id is missing', () => {
    expect(() => assignColors({ seed: 'x', player1Id: 'p1', player2Id: '', sequence: 1 }))
      .toThrow(/player2Id required/)
  })

  it('throws on a non-integer sequence', () => {
    expect(() => assignColors({ seed: 'x', player1Id: 'p1', player2Id: 'p2', sequence: 1.5 }))
      .toThrow(/positive integer/)
  })

  it('throws on a zero or negative sequence', () => {
    expect(() => assignColors({ seed: 'x', player1Id: 'p1', player2Id: 'p2', sequence: 0 }))
      .toThrow(/positive integer/)
  })
})

describe('assignColors — game 1 (seeded)', () => {
  it('returns p1 as first mover for a seed whose hash bit-0 is 0', () => {
    const r = assignColors({ seed: SEED_P1_STARTS, player1Id: 'p1', player2Id: 'p2', sequence: 1 })
    expect(r).toEqual({ firstMoverId: 'p1', secondMoverId: 'p2', p1IsFirstMover: true })
  })

  it('returns p2 as first mover for a seed whose hash bit-0 is 1', () => {
    const r = assignColors({ seed: SEED_P2_STARTS, player1Id: 'p1', player2Id: 'p2', sequence: 1 })
    expect(r).toEqual({ firstMoverId: 'p2', secondMoverId: 'p1', p1IsFirstMover: false })
  })

  it('is deterministic — same input yields the same output across calls', () => {
    const a = assignColors({ seed: SEED_P1_STARTS, player1Id: 'p1', player2Id: 'p2', sequence: 1 })
    const b = assignColors({ seed: SEED_P1_STARTS, player1Id: 'p1', player2Id: 'p2', sequence: 1 })
    expect(a).toEqual(b)
  })
})

describe('assignColors — game 2 (swap)', () => {
  it('swaps from p1 to p2 when game 1 started with p1', () => {
    const r = assignColors({ seed: SEED_P1_STARTS, player1Id: 'p1', player2Id: 'p2', sequence: 2 })
    expect(r.firstMoverId).toBe('p2')
    expect(r.p1IsFirstMover).toBe(false)
  })

  it('swaps from p2 to p1 when game 1 started with p2', () => {
    const r = assignColors({ seed: SEED_P2_STARTS, player1Id: 'p1', player2Id: 'p2', sequence: 2 })
    expect(r.firstMoverId).toBe('p1')
    expect(r.p1IsFirstMover).toBe(true)
  })

  it('gives both players exactly one game as first mover over a BO2', () => {
    const g1 = assignColors({ seed: SEED_P1_STARTS, player1Id: 'p1', player2Id: 'p2', sequence: 1 })
    const g2 = assignColors({ seed: SEED_P1_STARTS, player1Id: 'p1', player2Id: 'p2', sequence: 2 })
    expect(new Set([g1.firstMoverId, g2.firstMoverId])).toEqual(new Set(['p1', 'p2']))
  })
})

describe('assignColors — game 3 tiebreaker', () => {
  it('without randomTiebreaker, sequence 3 continues the swap pattern (matches sequence 1)', () => {
    const g1 = assignColors({ seed: SEED_P1_STARTS, player1Id: 'p1', player2Id: 'p2', sequence: 1 })
    const g3 = assignColors({ seed: SEED_P1_STARTS, player1Id: 'p1', player2Id: 'p2', sequence: 3 })
    expect(g3.firstMoverId).toBe(g1.firstMoverId)
  })

  it('with randomTiebreaker, sequence 3 mixes the seed with ":g3" and is independent of swap pattern', () => {
    // For seed='a', game-1 starter is p1 (parity 0). The g3 mix may agree
    // or disagree with game-1 depending on sha256(seed + ':g3'); what we
    // assert here is determinism + that the value is locked to the mixed
    // hash, not the swap pattern.
    const g3a = assignColors({ seed: SEED_P1_STARTS, player1Id: 'p1', player2Id: 'p2', sequence: 3, randomTiebreaker: true })
    const g3b = assignColors({ seed: SEED_P1_STARTS, player1Id: 'p1', player2Id: 'p2', sequence: 3, randomTiebreaker: true })
    expect(g3a).toEqual(g3b)
    // Tiebreaker shouldn't always equal game-1; if it did the helper would
    // collapse into "swap pattern with extra hashing." Find one seed where
    // they differ to prove the branch is live.
    const seeds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']
    const differs = seeds.some((s) => {
      const g1 = assignColors({ seed: s, player1Id: 'p1', player2Id: 'p2', sequence: 1 })
      const g3 = assignColors({ seed: s, player1Id: 'p1', player2Id: 'p2', sequence: 3, randomTiebreaker: true })
      return g1.firstMoverId !== g3.firstMoverId
    })
    expect(differs).toBe(true)
  })

  it('is deterministic across calls with randomTiebreaker', () => {
    const a = assignColors({ seed: SEED_P2_STARTS, player1Id: 'p1', player2Id: 'p2', sequence: 3, randomTiebreaker: true })
    const b = assignColors({ seed: SEED_P2_STARTS, player1Id: 'p1', player2Id: 'p2', sequence: 3, randomTiebreaker: true })
    expect(a).toEqual(b)
  })
})

describe('assignColors — distribution over many seeds', () => {
  it('roughly 50/50 first-mover split across 256 random seeds (game 1)', () => {
    let p1Starts = 0
    const N = 256
    for (let i = 0; i < N; i++) {
      const seed = `seed_${i.toString(16).padStart(4, '0')}`
      const r = assignColors({ seed, player1Id: 'p1', player2Id: 'p2', sequence: 1 })
      if (r.p1IsFirstMover) p1Starts += 1
    }
    // sha256 is well-mixed; allow generous slack. If this fails the helper
    // has lost its randomness.
    expect(p1Starts).toBeGreaterThan(N * 0.35)
    expect(p1Starts).toBeLessThan   (N * 0.65)
  })
})
