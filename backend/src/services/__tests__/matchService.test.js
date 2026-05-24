// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * matchService — A2.2 unit tests.
 *
 * Covers the pure outcome helper plus the three lifecycle entry points
 * (createMatch / recordGameResult / cancelMatch) with the DB layer mocked.
 * `$transaction` is mocked to invoke its callback with the same mock tx so
 * the transactional branch in `recordGameResult` is exercised end-to-end.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/db.js', () => {
  const match = { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() }
  return {
    default: {
      match,
      $transaction: vi.fn(async (cb) => cb({ match })),
    },
  }
})

import db from '../../lib/db.js'
import {
  createMatch,
  recordGameResult,
  cancelMatch,
  evaluateMatchOutcome,
  MatchError,
  GAMES_PER_FORMAT,
} from '../matchService.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('evaluateMatchOutcome (pure)', () => {
  const base = { format: 'RANKED_BO2', player1Id: 'p1', player2Id: 'p2' }

  it('returns not complete before the format quota of games is played', () => {
    expect(evaluateMatchOutcome({ ...base, p1Wins: 1, p2Wins: 0, drawGames: 0 }))
      .toEqual({ complete: false, winnerId: null })
  })

  it('returns p1 winner on 2-0', () => {
    expect(evaluateMatchOutcome({ ...base, p1Wins: 2, p2Wins: 0, drawGames: 0 }))
      .toEqual({ complete: true, winnerId: 'p1' })
  })

  it('returns p2 winner on 0-2', () => {
    expect(evaluateMatchOutcome({ ...base, p1Wins: 0, p2Wins: 2, drawGames: 0 }))
      .toEqual({ complete: true, winnerId: 'p2' })
  })

  it('returns draw on 1-1', () => {
    expect(evaluateMatchOutcome({ ...base, p1Wins: 1, p2Wins: 1, drawGames: 0 }))
      .toEqual({ complete: true, winnerId: null })
  })

  it('returns draw on 0-0 with two drawn games', () => {
    expect(evaluateMatchOutcome({ ...base, p1Wins: 0, p2Wins: 0, drawGames: 2 }))
      .toEqual({ complete: true, winnerId: null })
  })

  it('returns p1 winner on 1-0 with one drawn game (1.5-0.5)', () => {
    expect(evaluateMatchOutcome({ ...base, p1Wins: 1, p2Wins: 0, drawGames: 1 }))
      .toEqual({ complete: true, winnerId: 'p1' })
  })

  it('throws on unknown format', () => {
    expect(() => evaluateMatchOutcome({ ...base, format: 'BO99', p1Wins: 0, p2Wins: 0, drawGames: 0 }))
      .toThrow(MatchError)
  })
})

describe('createMatch', () => {
  it('throws BAD_INPUT when gameId is missing', async () => {
    await expect(createMatch({ player1Id: 'p1', player2Id: 'p2' }))
      .rejects.toMatchObject({ code: 'BAD_INPUT' })
  })

  it('throws BAD_INPUT when players are identical', async () => {
    await expect(createMatch({ gameId: 'tic-tac-toe', player1Id: 'p1', player2Id: 'p1' }))
      .rejects.toMatchObject({ code: 'BAD_INPUT' })
  })

  it('throws UNKNOWN_FORMAT for an unsupported format', async () => {
    await expect(createMatch({ gameId: 'tic-tac-toe', player1Id: 'p1', player2Id: 'p2', format: 'BO99' }))
      .rejects.toMatchObject({ code: 'UNKNOWN_FORMAT' })
  })

  it('creates a PENDING match with a fresh seed', async () => {
    db.match.create.mockResolvedValueOnce({ id: 'm1', status: 'PENDING' })
    await createMatch({ gameId: 'tic-tac-toe', player1Id: 'p1', player2Id: 'p2' })
    const arg = db.match.create.mock.calls[0][0]
    expect(arg.data).toMatchObject({
      gameId: 'tic-tac-toe',
      player1Id: 'p1',
      player2Id: 'p2',
      format: 'RANKED_BO2',
      status: 'PENDING',
    })
    // seed is a 32-char hex string (16 random bytes)
    expect(arg.data.seed).toMatch(/^[a-f0-9]{32}$/)
  })

  it('mints distinct seeds across calls', async () => {
    db.match.create.mockImplementation(({ data }) => Promise.resolve({ id: 'm', ...data }))
    await createMatch({ gameId: 'tic-tac-toe', player1Id: 'p1', player2Id: 'p2' })
    await createMatch({ gameId: 'tic-tac-toe', player1Id: 'p1', player2Id: 'p2' })
    const seeds = db.match.create.mock.calls.map((c) => c[0].data.seed)
    expect(seeds[0]).not.toBe(seeds[1])
  })
})

describe('recordGameResult', () => {
  function existingMatch(overrides = {}) {
    return {
      id: 'm1',
      format: 'RANKED_BO2',
      status: 'PENDING',
      player1Id: 'p1',
      player2Id: 'p2',
      p1Wins: 0,
      p2Wins: 0,
      drawGames: 0,
      winnerId: null,
      startedAt: null,
      completedAt: null,
      ...overrides,
    }
  }

  it('throws BAD_INPUT when matchId is missing', async () => {
    await expect(recordGameResult({ matchId: '', winnerId: 'p1' }))
      .rejects.toMatchObject({ code: 'BAD_INPUT' })
  })

  it('throws NOT_FOUND when the match is missing', async () => {
    db.match.findUnique.mockResolvedValueOnce(null)
    await expect(recordGameResult({ matchId: 'm1', winnerId: 'p1' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('throws WRONG_STATE on a COMPLETED match', async () => {
    db.match.findUnique.mockResolvedValueOnce(existingMatch({ status: 'COMPLETED' }))
    await expect(recordGameResult({ matchId: 'm1', winnerId: 'p1' }))
      .rejects.toMatchObject({ code: 'WRONG_STATE' })
  })

  it('throws BAD_INPUT for a winnerId that is not either player', async () => {
    db.match.findUnique.mockResolvedValueOnce(existingMatch())
    await expect(recordGameResult({ matchId: 'm1', winnerId: 'someone_else' }))
      .rejects.toMatchObject({ code: 'BAD_INPUT' })
  })

  it('on first game: increments wins, flips PENDING → IN_PROGRESS, stamps startedAt', async () => {
    db.match.findUnique.mockResolvedValueOnce(existingMatch())
    db.match.update.mockImplementation(({ data }) => Promise.resolve({ id: 'm1', ...data }))
    const { match, complete } = await recordGameResult({ matchId: 'm1', winnerId: 'p1' })
    expect(complete).toBe(false)
    expect(match.p1Wins).toBe(1)
    expect(match.status).toBe('IN_PROGRESS')
    expect(match.startedAt).toBeInstanceOf(Date)
    expect(match.completedAt).toBeUndefined()
  })

  it('records a draw as a drawGame increment', async () => {
    db.match.findUnique.mockResolvedValueOnce(existingMatch())
    db.match.update.mockImplementation(({ data }) => Promise.resolve({ id: 'm1', ...data }))
    const { match, complete } = await recordGameResult({ matchId: 'm1', winnerId: null })
    expect(complete).toBe(false)
    expect(match.drawGames).toBe(1)
    expect(match.status).toBe('IN_PROGRESS')
  })

  it('on the final game of a BO2: sets winner, completedAt, status=COMPLETED', async () => {
    db.match.findUnique.mockResolvedValueOnce(existingMatch({
      status: 'IN_PROGRESS',
      p1Wins: 1,
      startedAt: new Date('2026-05-01'),
    }))
    db.match.update.mockImplementation(({ data }) => Promise.resolve({ id: 'm1', ...data }))
    const { match, complete } = await recordGameResult({ matchId: 'm1', winnerId: 'p2' })
    expect(complete).toBe(true)
    expect(match.p1Wins).toBe(1)
    expect(match.p2Wins).toBe(1)
    expect(match.status).toBe('COMPLETED')
    expect(match.winnerId).toBeNull() // 1-1 draw
    expect(match.completedAt).toBeInstanceOf(Date)
  })

  it('drives a 2-0 sweep to COMPLETED with the sweeping player as winner', async () => {
    db.match.findUnique.mockResolvedValueOnce(existingMatch({
      status: 'IN_PROGRESS',
      p1Wins: 1,
    }))
    db.match.update.mockImplementation(({ data }) => Promise.resolve({ id: 'm1', ...data }))
    const { match, complete } = await recordGameResult({ matchId: 'm1', winnerId: 'p1' })
    expect(complete).toBe(true)
    expect(match.winnerId).toBe('p1')
    expect(match.status).toBe('COMPLETED')
  })
})

describe('cancelMatch', () => {
  it('throws BAD_INPUT when matchId is missing', async () => {
    await expect(cancelMatch({ matchId: '' }))
      .rejects.toMatchObject({ code: 'BAD_INPUT' })
  })

  it('throws NOT_FOUND when the match is missing', async () => {
    db.match.findUnique.mockResolvedValueOnce(null)
    await expect(cancelMatch({ matchId: 'm1' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('throws WRONG_STATE when the match has already moved past PENDING', async () => {
    db.match.findUnique.mockResolvedValueOnce({ id: 'm1', status: 'IN_PROGRESS' })
    await expect(cancelMatch({ matchId: 'm1' })).rejects.toMatchObject({ code: 'WRONG_STATE' })
  })

  it('sets status=CANCELLED and completedAt on a PENDING match', async () => {
    db.match.findUnique.mockResolvedValueOnce({ id: 'm1', status: 'PENDING' })
    db.match.update.mockImplementation(({ data }) => Promise.resolve({ id: 'm1', ...data }))
    const m = await cancelMatch({ matchId: 'm1' })
    expect(m.status).toBe('CANCELLED')
    expect(m.completedAt).toBeInstanceOf(Date)
  })
})

describe('GAMES_PER_FORMAT', () => {
  it('exposes the RANKED_BO2 quota', () => {
    expect(GAMES_PER_FORMAT.RANKED_BO2).toBe(2)
  })
})
