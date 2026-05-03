import { describe, it, expect, vi, afterEach } from 'vitest'
import { recordGameResult, resolveDrawCascade } from '../lib/match.js'

// ─── recordGameResult ─────────────────────────────────────────────────────────

describe('recordGameResult — bestOfN=3 (first to 2 wins)', () => {
  const baseMatch = {
    participant1Id: 'p1',
    participant2Id: 'p2',
    p1Wins: 0,
    p2Wins: 0,
    drawGames: 0,
  }

  it('p1 wins game 1 — not yet complete', () => {
    const result = recordGameResult(baseMatch, 'p1', 3)
    expect(result).toMatchObject({ p1Wins: 1, p2Wins: 0, drawGames: 0, matchComplete: false, matchWinnerId: null })
  })

  it('p1 wins games 1 and 2 — match complete, p1 wins', () => {
    const match = { ...baseMatch, p1Wins: 1 }
    const result = recordGameResult(match, 'p1', 3)
    expect(result).toMatchObject({ p1Wins: 2, p2Wins: 0, matchComplete: true, matchWinnerId: 'p1' })
  })

  it('p2 wins game to reach 2 — match complete, p2 wins', () => {
    const match = { ...baseMatch, p2Wins: 1 }
    const result = recordGameResult(match, 'p2', 3)
    expect(result).toMatchObject({ p2Wins: 2, matchComplete: true, matchWinnerId: 'p2' })
  })

  it('draw game increments drawGames', () => {
    const result = recordGameResult(baseMatch, null, 3)
    expect(result).toMatchObject({ drawGames: 1, matchComplete: false, matchWinnerId: null })
  })

  it('all 3 games drawn — match complete, winnerId null (needs draw cascade)', () => {
    const match = { ...baseMatch, p1Wins: 0, p2Wins: 0, drawGames: 2 }
    const result = recordGameResult(match, null, 3)
    expect(result).toMatchObject({ drawGames: 3, matchComplete: true, matchWinnerId: null })
  })

  it('p1=1, p2=1, draw — match complete after 3rd game, no winner', () => {
    const match = { ...baseMatch, p1Wins: 1, p2Wins: 1 }
    const result = recordGameResult(match, null, 3)
    expect(result).toMatchObject({ p1Wins: 1, p2Wins: 1, drawGames: 1, matchComplete: true, matchWinnerId: null })
  })
})

describe('recordGameResult — bestOfN=5 (first to 3 wins)', () => {
  const baseMatch = {
    participant1Id: 'p1',
    participant2Id: 'p2',
    p1Wins: 0,
    p2Wins: 0,
    drawGames: 0,
  }

  it('p1 needs 3 wins — 2 wins not enough', () => {
    const match = { ...baseMatch, p1Wins: 2 }
    const result = recordGameResult(match, 'p1', 5)
    expect(result).toMatchObject({ p1Wins: 3, matchComplete: true, matchWinnerId: 'p1' })
  })

  it('p2 wins with 3rd win', () => {
    const match = { ...baseMatch, p2Wins: 2 }
    const result = recordGameResult(match, 'p2', 5)
    expect(result).toMatchObject({ p2Wins: 3, matchComplete: true, matchWinnerId: 'p2' })
  })

  it('5 games played without decisive winner — match complete, no winner', () => {
    const match = { ...baseMatch, p1Wins: 2, p2Wins: 2 }
    const result = recordGameResult(match, null, 5)
    expect(result).toMatchObject({ p1Wins: 2, p2Wins: 2, drawGames: 1, matchComplete: true, matchWinnerId: null })
  })

  it('match not complete at 2-1 with 1 draw', () => {
    const match = { ...baseMatch, p1Wins: 2, p2Wins: 1, drawGames: 0 }
    const result = recordGameResult(match, 'p2', 5) // p2 ties: 2-2
    expect(result).toMatchObject({ p1Wins: 2, p2Wins: 2, matchComplete: false })
  })
})

describe('recordGameResult — edge cases', () => {
  it('unknown winner ID treated as draw', () => {
    const match = { participant1Id: 'p1', participant2Id: 'p2', p1Wins: 0, p2Wins: 0, drawGames: 0 }
    const result = recordGameResult(match, 'unknown-id', 3)
    expect(result.drawGames).toBe(1)
    expect(result.matchComplete).toBe(false)
  })

  it('bestOfN=1 — single game decides match', () => {
    const match = { participant1Id: 'p1', participant2Id: 'p2', p1Wins: 0, p2Wins: 0, drawGames: 0 }
    const result = recordGameResult(match, 'p1', 1)
    expect(result).toMatchObject({ p1Wins: 1, matchComplete: true, matchWinnerId: 'p1' })
  })
})

// ─── resolveDrawCascade ───────────────────────────────────────────────────────

describe('resolveDrawCascade — WINS step', () => {
  it('p1 has more wins → p1 wins via WINS', () => {
    const match = { participant1Id: 'p1', participant2Id: 'p2', p1Wins: 2, p2Wins: 1 }
    const p1 = { id: 'p1', eloAtRegistration: 1200 }
    const p2 = { id: 'p2', eloAtRegistration: 1300 }
    const result = resolveDrawCascade(match, p1, p2)
    expect(result).toEqual({ winnerId: 'p1', resolution: 'WINS' })
  })

  it('p2 has more wins → p2 wins via WINS', () => {
    const match = { participant1Id: 'p1', participant2Id: 'p2', p1Wins: 1, p2Wins: 3 }
    const p1 = { id: 'p1', eloAtRegistration: 1500 }
    const p2 = { id: 'p2', eloAtRegistration: 1000 }
    const result = resolveDrawCascade(match, p1, p2)
    expect(result).toEqual({ winnerId: 'p2', resolution: 'WINS' })
  })
})

describe('resolveDrawCascade — ELO step', () => {
  it('wins tied — higher ELO wins via ELO', () => {
    const match = { participant1Id: 'p1', participant2Id: 'p2', p1Wins: 1, p2Wins: 1 }
    const p1 = { id: 'p1', eloAtRegistration: 1400 }
    const p2 = { id: 'p2', eloAtRegistration: 1200 }
    const result = resolveDrawCascade(match, p1, p2)
    expect(result).toEqual({ winnerId: 'p1', resolution: 'ELO' })
  })

  it('wins tied — p2 higher ELO → p2 wins via ELO', () => {
    const match = { participant1Id: 'p1', participant2Id: 'p2', p1Wins: 2, p2Wins: 2 }
    const p1 = { id: 'p1', eloAtRegistration: 1000 }
    const p2 = { id: 'p2', eloAtRegistration: 1600 }
    const result = resolveDrawCascade(match, p1, p2)
    expect(result).toEqual({ winnerId: 'p2', resolution: 'ELO' })
  })
})

describe('resolveDrawCascade — RANDOM step', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('wins and ELO tied — Math.random < 0.5 → p1 wins via RANDOM', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.3)
    const match = { participant1Id: 'p1', participant2Id: 'p2', p1Wins: 1, p2Wins: 1 }
    const p1 = { id: 'p1', eloAtRegistration: 1200 }
    const p2 = { id: 'p2', eloAtRegistration: 1200 }
    const result = resolveDrawCascade(match, p1, p2)
    expect(result).toEqual({ winnerId: 'p1', resolution: 'RANDOM' })
  })

  it('wins and ELO tied — Math.random >= 0.5 → p2 wins via RANDOM', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.7)
    const match = { participant1Id: 'p1', participant2Id: 'p2', p1Wins: 0, p2Wins: 0 }
    const p1 = { id: 'p1', eloAtRegistration: 1200 }
    const p2 = { id: 'p2', eloAtRegistration: 1200 }
    const result = resolveDrawCascade(match, p1, p2)
    expect(result).toEqual({ winnerId: 'p2', resolution: 'RANDOM' })
  })

  it('boundary: Math.random === 0.5 → p2 wins', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const match = { participant1Id: 'p1', participant2Id: 'p2', p1Wins: 1, p2Wins: 1 }
    const p1 = { id: 'p1', eloAtRegistration: 1200 }
    const p2 = { id: 'p2', eloAtRegistration: 1200 }
    const result = resolveDrawCascade(match, p1, p2)
    expect(result).toEqual({ winnerId: 'p2', resolution: 'RANDOM' })
  })
})

describe('resolveDrawCascade — cascade order verification', () => {
  it('WINS takes precedence over ELO and RANDOM', () => {
    // p1 has more wins AND lower ELO — WINS should still win
    const match = { participant1Id: 'p1', participant2Id: 'p2', p1Wins: 3, p2Wins: 1 }
    const p1 = { id: 'p1', eloAtRegistration: 900 }
    const p2 = { id: 'p2', eloAtRegistration: 1800 }
    const result = resolveDrawCascade(match, p1, p2)
    expect(result.resolution).toBe('WINS')
    expect(result.winnerId).toBe('p1')
  })

  it('ELO takes precedence over RANDOM', () => {
    // wins tied, p2 higher ELO — should NOT reach RANDOM
    vi.spyOn(Math, 'random').mockReturnValue(0.1) // would pick p1 if RANDOM
    const match = { participant1Id: 'p1', participant2Id: 'p2', p1Wins: 2, p2Wins: 2 }
    const p1 = { id: 'p1', eloAtRegistration: 1100 }
    const p2 = { id: 'p2', eloAtRegistration: 1400 }
    const result = resolveDrawCascade(match, p1, p2)
    expect(result.resolution).toBe('ELO')
    expect(result.winnerId).toBe('p2')
    vi.restoreAllMocks()
  })
})
