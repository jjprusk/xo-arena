// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect } from 'vitest'
import {
  expectedMatchCount,
  expectedGameCount,
  runawayRatio,
  RUNAWAY_WARN_RATIO,
  RUNAWAY_CANCEL_RATIO,
} from '../bracketMath.js'

describe('expectedMatchCount', () => {
  it('SINGLE_ELIM: N-1 matches', () => {
    expect(expectedMatchCount('SINGLE_ELIM', 2)).toBe(1)
    expect(expectedMatchCount('SINGLE_ELIM', 4)).toBe(3)
    expect(expectedMatchCount('SINGLE_ELIM', 8)).toBe(7)
  })
  it('ROUND_ROBIN: N*(N-1)/2 matches', () => {
    expect(expectedMatchCount('ROUND_ROBIN', 4)).toBe(6)
    expect(expectedMatchCount('ROUND_ROBIN', 6)).toBe(15)
  })
  it('returns 0 for <2 participants', () => {
    expect(expectedMatchCount('SINGLE_ELIM', 0)).toBe(0)
    expect(expectedMatchCount('SINGLE_ELIM', 1)).toBe(0)
    expect(expectedMatchCount('ROUND_ROBIN', 1)).toBe(0)
  })
  it('unknown bracket type falls back to N-1', () => {
    expect(expectedMatchCount('DOUBLE_ELIM', 4)).toBe(3)
  })
})

describe('expectedGameCount', () => {
  it('multiplies matches by bestOfN', () => {
    expect(expectedGameCount('SINGLE_ELIM', 4, 3)).toBe(9)   // 3 matches × 3
    expect(expectedGameCount('SINGLE_ELIM', 4, 1)).toBe(3)   // 3 matches × 1
    expect(expectedGameCount('ROUND_ROBIN', 4, 5)).toBe(30)  // 6 matches × 5
  })
  it('clamps bestOfN to at least 1', () => {
    expect(expectedGameCount('SINGLE_ELIM', 4, 0)).toBe(3)
    expect(expectedGameCount('SINGLE_ELIM', 4, null)).toBe(3)
  })
})

describe('runawayRatio', () => {
  it('0 expected → ratio 0 (avoid div-by-zero)', () => {
    expect(runawayRatio(100, 'SINGLE_ELIM', 1, 3)).toBe(0)
  })
  it('real-world staging runaway: 4-bot single-elim bestOf3 + 514 games', () => {
    // Expected ceiling = 9. Ratio ≈ 57×.
    const ratio = runawayRatio(514, 'SINGLE_ELIM', 4, 3)
    expect(ratio).toBeCloseTo(514 / 9, 2)
    expect(ratio).toBeGreaterThan(RUNAWAY_CANCEL_RATIO)
  })
  it('healthy tournament: ratio ≤ 1 when matches end in straight wins', () => {
    // 4 players, bestOf3, 3 matches, 6 games played (each match 2-0) → ratio 6/9.
    expect(runawayRatio(6, 'SINGLE_ELIM', 4, 3)).toBeCloseTo(6 / 9, 2)
  })
  it('WARN threshold is strictly less than CANCEL threshold', () => {
    expect(RUNAWAY_WARN_RATIO).toBeLessThan(RUNAWAY_CANCEL_RATIO)
  })
})
