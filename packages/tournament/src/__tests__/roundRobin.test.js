/**
 * Phase 4: Round Robin tests
 *
 * Covers:
 * - Bracket generation (even and odd player counts, all pairs scheduled)
 * - Scoring: win=2pts, draw=1pt each, loss=0
 * - Final standings: sorted by points, tiebreak by wins, then ELO
 */

import { describe, it, expect } from 'vitest'
import { generateRoundRobinSchedule } from '../lib/bracket.js'

// ─── Bracket generation ───────────────────────────────────────────────────────

describe('generateRoundRobinSchedule', () => {
  it('generates correct number of rounds for 4 players', () => {
    const players = [
      { id: 'p1', eloAtRegistration: 1400 },
      { id: 'p2', eloAtRegistration: 1300 },
      { id: 'p3', eloAtRegistration: 1200 },
      { id: 'p4', eloAtRegistration: 1100 },
    ]
    const rounds = generateRoundRobinSchedule(players)
    expect(rounds.length).toBe(3) // n-1 = 4-1 = 3 rounds
  })

  it('generates n*(n-1)/2 total matches for 4 players', () => {
    const players = [
      { id: 'p1', eloAtRegistration: 1400 },
      { id: 'p2', eloAtRegistration: 1300 },
      { id: 'p3', eloAtRegistration: 1200 },
      { id: 'p4', eloAtRegistration: 1100 },
    ]
    const rounds = generateRoundRobinSchedule(players)
    const totalMatches = rounds.reduce((sum, r) => sum + r.matches.length, 0)
    expect(totalMatches).toBe(6) // 4*3/2 = 6
  })

  it('each match has 2 distinct participants from the player list', () => {
    const players = [
      { id: 'p1', eloAtRegistration: 1400 },
      { id: 'p2', eloAtRegistration: 1300 },
      { id: 'p3', eloAtRegistration: 1200 },
      { id: 'p4', eloAtRegistration: 1100 },
    ]
    const rounds = generateRoundRobinSchedule(players)
    const ids = players.map(p => p.id)
    for (const round of rounds) {
      for (const match of round.matches) {
        expect(ids).toContain(match.participant1Id)
        expect(ids).toContain(match.participant2Id)
        expect(match.participant1Id).not.toBe(match.participant2Id)
      }
    }
  })

  it('every pair of players meets exactly once', () => {
    const players = [
      { id: 'p1', eloAtRegistration: 1400 },
      { id: 'p2', eloAtRegistration: 1300 },
      { id: 'p3', eloAtRegistration: 1200 },
      { id: 'p4', eloAtRegistration: 1100 },
    ]
    const rounds = generateRoundRobinSchedule(players)
    const allMatches = rounds.flatMap(r => r.matches)

    // Build set of pairs (sorted so order doesn't matter)
    const pairs = allMatches.map(m =>
      [m.participant1Id, m.participant2Id].sort().join('|')
    )
    // All pairs unique
    expect(new Set(pairs).size).toBe(pairs.length)
    // All 6 possible pairs present
    expect(pairs.length).toBe(6)
  })

  it('works for 3 players (odd count)', () => {
    const players = [
      { id: 'p1', eloAtRegistration: 1400 },
      { id: 'p2', eloAtRegistration: 1300 },
      { id: 'p3', eloAtRegistration: 1200 },
    ]
    const rounds = generateRoundRobinSchedule(players)
    const allMatches = rounds.flatMap(r => r.matches)
    // 3 players → 3 matches total
    expect(allMatches.length).toBe(3)
    // Every pair once
    const pairs = allMatches.map(m =>
      [m.participant1Id, m.participant2Id].sort().join('|')
    )
    expect(new Set(pairs).size).toBe(3)
  })

  it('returns empty array for fewer than 2 players', () => {
    expect(generateRoundRobinSchedule([])).toEqual([])
    expect(generateRoundRobinSchedule([{ id: 'p1', eloAtRegistration: 1200 }])).toEqual([])
  })

  it('no round has a player appearing more than once', () => {
    const players = [
      { id: 'p1', eloAtRegistration: 1400 },
      { id: 'p2', eloAtRegistration: 1300 },
      { id: 'p3', eloAtRegistration: 1200 },
      { id: 'p4', eloAtRegistration: 1100 },
      { id: 'p5', eloAtRegistration: 1000 },
      { id: 'p6', eloAtRegistration: 900 },
    ]
    const rounds = generateRoundRobinSchedule(players)
    for (const round of rounds) {
      const idsInRound = round.matches.flatMap(m => [m.participant1Id, m.participant2Id])
      expect(new Set(idsInRound).size).toBe(idsInRound.length) // all unique
    }
  })
})
