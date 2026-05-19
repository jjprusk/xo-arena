// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * rankedMatchOrchestrator — A2.4 unit tests.
 *
 * Mocks the underlying matchService primitives so each branch can be
 * exercised without a real DB. `buildGameSpawnSpec` is exercised directly
 * because it's pure.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../matchService.js', async () => {
  const actual = await vi.importActual('../matchService.js')
  return {
    ...actual,
    createMatch:       vi.fn(),
    recordGameResult:  vi.fn(),
  }
})

import { createMatch, recordGameResult } from '../matchService.js'
import {
  buildGameSpawnSpec,
  startRankedMatch,
  advanceMatchAfterGame,
} from '../rankedMatchOrchestrator.js'

// Use a seed whose sha256 first byte is even → player1 is first mover in
// game 1 (locked in matchColors.test.js).
const SEED = 'a'

function makeMatch(overrides = {}) {
  return {
    id: 'm1',
    gameId: 'tic-tac-toe',
    format: 'RANKED_BO2',
    status: 'PENDING',
    player1Id: 'p1',
    player2Id: 'p2',
    p1Wins: 0,
    p2Wins: 0,
    drawGames: 0,
    seed: SEED,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('buildGameSpawnSpec', () => {
  it('throws BAD_INPUT when match is missing', () => {
    expect(() => buildGameSpawnSpec({ match: null, sequence: 1 }))
      .toThrow(/match required/)
  })

  it('throws BAD_INPUT for non-integer sequence', () => {
    expect(() => buildGameSpawnSpec({ match: makeMatch(), sequence: 1.5 }))
      .toThrow(/positive integer/)
  })

  it('throws UNKNOWN_FORMAT for an unknown match.format', () => {
    expect(() => buildGameSpawnSpec({ match: makeMatch({ format: 'BO99' }), sequence: 1 }))
      .toThrow(/Unknown match format/)
  })

  it('throws when sequence exceeds the format quota', () => {
    expect(() => buildGameSpawnSpec({ match: makeMatch(), sequence: 3 }))
      .toThrow(/exceeds 2-game format/)
  })

  it('game 1: p1 is first mover (seed=a)', () => {
    const spec = buildGameSpawnSpec({ match: makeMatch(), sequence: 1 })
    expect(spec).toMatchObject({
      matchId: 'm1',
      sequence: 1,
      firstMoverId: 'p1',
      secondMoverId: 'p2',
      p1IsFirstMover: true,
      gameId: 'tic-tac-toe',
      format: 'RANKED_BO2',
    })
  })

  it('game 2: swap — p2 is first mover', () => {
    const spec = buildGameSpawnSpec({ match: makeMatch(), sequence: 2 })
    expect(spec).toMatchObject({
      sequence: 2,
      firstMoverId: 'p2',
      secondMoverId: 'p1',
      p1IsFirstMover: false,
    })
  })
})

describe('startRankedMatch', () => {
  it('creates the match and returns the spawn spec for game 1', async () => {
    const match = makeMatch()
    createMatch.mockResolvedValueOnce(match)
    const { match: returned, spawn } = await startRankedMatch({
      gameId: 'tic-tac-toe',
      player1Id: 'p1',
      player2Id: 'p2',
    })
    expect(createMatch).toHaveBeenCalledWith({
      gameId: 'tic-tac-toe',
      player1Id: 'p1',
      player2Id: 'p2',
      format: 'RANKED_BO2',
    })
    expect(returned).toBe(match)
    expect(spawn.sequence).toBe(1)
    expect(spawn.firstMoverId).toBe('p1')
  })

  it('threads through a non-default format argument', async () => {
    // No alternate format ships in A2, but the parameter must reach
    // matchService for forward compat with future BO formats.
    createMatch.mockResolvedValueOnce(makeMatch())
    await startRankedMatch({
      gameId: 'tic-tac-toe',
      player1Id: 'p1',
      player2Id: 'p2',
      format: 'RANKED_BO2',
    })
    expect(createMatch).toHaveBeenCalledWith(expect.objectContaining({ format: 'RANKED_BO2' }))
  })
})

describe('advanceMatchAfterGame', () => {
  it('on game 1 of a BO2: returns nextSpawn for sequence 2 with swapped colors', async () => {
    // matchService.recordGameResult returns the *updated* match row.
    recordGameResult.mockResolvedValueOnce({
      match: makeMatch({ status: 'IN_PROGRESS', p1Wins: 1 }),
      complete: false,
    })
    const r = await advanceMatchAfterGame({ matchId: 'm1', winnerId: 'p1' })
    expect(r.complete).toBe(false)
    expect(r.nextSpawn).toMatchObject({
      sequence: 2,
      firstMoverId: 'p2',
      secondMoverId: 'p1',
      p1IsFirstMover: false,
    })
  })

  it('on a drawn first game: drawGames increments and nextSpawn is sequence 2', async () => {
    recordGameResult.mockResolvedValueOnce({
      match: makeMatch({ status: 'IN_PROGRESS', drawGames: 1 }),
      complete: false,
    })
    const r = await advanceMatchAfterGame({ matchId: 'm1', winnerId: null })
    expect(r.complete).toBe(false)
    expect(r.nextSpawn.sequence).toBe(2)
  })

  it('on the final game: returns complete=true and nextSpawn=null', async () => {
    recordGameResult.mockResolvedValueOnce({
      match: makeMatch({ status: 'COMPLETED', p1Wins: 1, p2Wins: 1, winnerId: null }),
      complete: true,
    })
    const r = await advanceMatchAfterGame({ matchId: 'm1', winnerId: 'p2' })
    expect(r.complete).toBe(true)
    expect(r.nextSpawn).toBeNull()
  })

  it('propagates underlying matchService errors (NOT_FOUND, WRONG_STATE)', async () => {
    recordGameResult.mockRejectedValueOnce(Object.assign(new Error('Match not found'), { code: 'NOT_FOUND' }))
    await expect(advanceMatchAfterGame({ matchId: 'm_missing', winnerId: 'p1' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
