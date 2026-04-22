// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Locks the tournament:bot:match:ready payload contract. Every publish
 * site in the tournament service (autoStart SINGLE_ELIM, autoStart
 * ROUND_ROBIN, bracket advancement in matches.js, recoverPendingBotMatches)
 * goes through buildBotMatchReadyPayload — so a regression that drops
 * `gameId` from any one site fails here. Satisfies §11g items 1 + 2.
 */

import { describe, it, expect } from 'vitest'
import { buildBotMatchReadyPayload } from '../publishPayloads.js'

describe('buildBotMatchReadyPayload', () => {
  const tournament = { id: 't1', bestOfN: 3, game: 'xo' }
  const match      = { id: 'm1' }
  const p1User     = { id: 'u1', displayName: 'Rusty',   botModelId: 'seed:rusty:novice',  isBot: true }
  const p2User     = { id: 'u2', displayName: 'Magnus',  botModelId: 'seed:magnus:master', isBot: true }

  it('includes gameId sourced from tournament.game', () => {
    const payload = buildBotMatchReadyPayload(tournament, match, p1User, p2User)
    expect(payload.gameId).toBe('xo')
  })

  it('passes through tournamentId, matchId, bestOfN', () => {
    const payload = buildBotMatchReadyPayload(tournament, match, p1User, p2User)
    expect(payload).toMatchObject({
      tournamentId: 't1',
      matchId:      'm1',
      bestOfN:      3,
    })
  })

  it('carries bot1/bot2 with id, displayName, botModelId — and no extras like isBot', () => {
    const payload = buildBotMatchReadyPayload(tournament, match, p1User, p2User)
    expect(payload.bot1).toEqual({
      id:          'u1',
      displayName: 'Rusty',
      botModelId:  'seed:rusty:novice',
    })
    expect(payload.bot2).toEqual({
      id:          'u2',
      displayName: 'Magnus',
      botModelId:  'seed:magnus:master',
    })
    // The isBot flag lives on the tournament-side user record; the backend
    // doesn't need it — omitting keeps the payload tight.
    expect(payload.bot1).not.toHaveProperty('isBot')
    expect(payload.bot2).not.toHaveProperty('isBot')
  })

  it('reflects a different gameId when the tournament is for a different game', () => {
    const pongTournament = { ...tournament, game: 'pong' }
    const payload = buildBotMatchReadyPayload(pongTournament, match, p1User, p2User)
    expect(payload.gameId).toBe('pong')
  })

  it('produces the exact full shape used by every call site — sentinel test', () => {
    // If this snapshot drifts, verify that every publish site in
    // tournamentSweep.js + matches.js matches the new shape, and that the
    // backend's botGameRunner still reads the fields it expects.
    const payload = buildBotMatchReadyPayload(tournament, match, p1User, p2User)
    expect(payload).toEqual({
      tournamentId: 't1',
      matchId:      'm1',
      bestOfN:      3,
      gameId:       'xo',
      bot1: { id: 'u1', displayName: 'Rusty',  botModelId: 'seed:rusty:novice'  },
      bot2: { id: 'u2', displayName: 'Magnus', botModelId: 'seed:magnus:master' },
    })
  })
})
