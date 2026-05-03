import { describe, it, expect } from 'vitest'
import { generateBracket, roundCount } from '../lib/bracket.js'

// ─── roundCount ───────────────────────────────────────────────────────────────

describe('roundCount', () => {
  it('2 participants → 1 round', () => {
    expect(roundCount(2)).toBe(1)
  })

  it('3 participants → 2 rounds', () => {
    expect(roundCount(3)).toBe(2)
  })

  it('4 participants → 2 rounds', () => {
    expect(roundCount(4)).toBe(2)
  })

  it('5 participants → 3 rounds', () => {
    expect(roundCount(5)).toBe(3)
  })

  it('8 participants → 3 rounds', () => {
    expect(roundCount(8)).toBe(3)
  })

  it('1 participant → 0 rounds', () => {
    expect(roundCount(1)).toBe(0)
  })
})

// ─── generateBracket ──────────────────────────────────────────────────────────

/**
 * Build a participant array for testing.
 */
function makeParticipants(count, eloStart = 1200) {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}`,
    userId: `u${i + 1}`,
    eloAtRegistration: eloStart - i * 10, // descending ELO: p1 is highest seed
  }))
}

describe('generateBracket — 2 participants (no BYE)', () => {
  const participants = makeParticipants(2)
  const bracket = generateBracket(participants)

  it('produces 1 round', () => {
    expect(bracket).toHaveLength(1)
  })

  it('round 1 has 1 match', () => {
    expect(bracket[0].matches).toHaveLength(1)
  })

  it('no BYE slots — both participant IDs are set', () => {
    const match = bracket[0].matches[0]
    expect(match.participant1Id).not.toBeNull()
    expect(match.participant2Id).not.toBeNull()
  })

  it('seed 1 (highest ELO) faces seed 2 (lowest)', () => {
    const match = bracket[0].matches[0]
    // p1 has highest ELO (seed 1), p2 has next (seed 2)
    const ids = [match.participant1Id, match.participant2Id]
    expect(ids).toContain('p1')
    expect(ids).toContain('p2')
  })
})

describe('generateBracket — 3 participants (1 BYE)', () => {
  const participants = makeParticipants(3)
  const bracket = generateBracket(participants)

  it('produces 2 rounds', () => {
    expect(bracket).toHaveLength(2)
  })

  it('round 1 has 2 matches (bracket size 4)', () => {
    expect(bracket[0].matches).toHaveLength(2)
  })

  it('round 2 has 1 match', () => {
    expect(bracket[1].matches).toHaveLength(1)
  })

  it('exactly one match in round 1 is a BYE', () => {
    const byeMatches = bracket[0].matches.filter(
      m => m.participant1Id !== null && m.participant2Id === null
    )
    expect(byeMatches).toHaveLength(1)
  })

  it('highest seed (p1) gets the BYE', () => {
    // In standard seeding, seed 1 is paired against the lowest possible opponent.
    // With 3 participants in a bracket of 4, seed 1 should face a BYE.
    const byeMatch = bracket[0].matches.find(m => m.participant2Id === null)
    expect(byeMatch).toBeDefined()
    expect(byeMatch.participant1Id).toBe('p1')
  })

  it('round 2 placeholder has null IDs', () => {
    const m = bracket[1].matches[0]
    expect(m.participant1Id).toBeNull()
    expect(m.participant2Id).toBeNull()
  })
})

describe('generateBracket — 8 participants (no BYE)', () => {
  const participants = makeParticipants(8)
  const bracket = generateBracket(participants)

  it('produces 3 rounds', () => {
    expect(bracket).toHaveLength(3)
  })

  it('round 1 has 4 matches', () => {
    expect(bracket[0].matches).toHaveLength(4)
  })

  it('round 2 has 2 matches', () => {
    expect(bracket[1].matches).toHaveLength(2)
  })

  it('round 3 (final) has 1 match', () => {
    expect(bracket[2].matches).toHaveLength(1)
  })

  it('no BYE slots in round 1', () => {
    const byeMatches = bracket[0].matches.filter(m => m.participant2Id === null)
    expect(byeMatches).toHaveLength(0)
  })

  it('all 8 participants appear exactly once in round 1', () => {
    const allIds = bracket[0].matches.flatMap(m => [m.participant1Id, m.participant2Id])
    const uniqueIds = new Set(allIds)
    expect(uniqueIds.size).toBe(8)
    for (let i = 1; i <= 8; i++) {
      expect(uniqueIds.has(`p${i}`)).toBe(true)
    }
  })

  it('seed 1 (highest ELO) is paired against seed 8 (lowest ELO)', () => {
    // Standard seeding: seed 1 vs seed N
    const round1Matches = bracket[0].matches
    const matchWithSeed1 = round1Matches.find(
      m => m.participant1Id === 'p1' || m.participant2Id === 'p1'
    )
    expect(matchWithSeed1).toBeDefined()
    const opponentId = matchWithSeed1.participant1Id === 'p1'
      ? matchWithSeed1.participant2Id
      : matchWithSeed1.participant1Id
    expect(opponentId).toBe('p8')
  })

  it('later rounds have null placeholder IDs', () => {
    for (const match of bracket[1].matches) {
      expect(match.participant1Id).toBeNull()
      expect(match.participant2Id).toBeNull()
    }
  })
})

describe('generateBracket — seeding order', () => {
  it('seeds by eloAtRegistration descending', () => {
    const participants = [
      { id: 'low', userId: 'u1', eloAtRegistration: 1000 },
      { id: 'high', userId: 'u2', eloAtRegistration: 1500 },
      { id: 'mid', userId: 'u3', eloAtRegistration: 1200 },
    ]
    const bracket = generateBracket(participants)

    // Highest ELO ('high') should get BYE (seed 1 in 3-player bracket)
    const byeMatch = bracket[0].matches.find(m => m.participant2Id === null)
    expect(byeMatch).toBeDefined()
    expect(byeMatch.participant1Id).toBe('high')
  })

  it('returns empty array for empty participants', () => {
    expect(generateBracket([])).toEqual([])
  })

  it('handles single participant', () => {
    const bracket = generateBracket([{ id: 'solo', userId: 'u1', eloAtRegistration: 1200 }])
    // 1 participant → bracket size 1 → 0 rounds → empty
    expect(bracket).toEqual([])
  })
})
