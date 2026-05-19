// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * matchService — ranked best-of-N match lifecycle.
 *
 * Owns the `Match` row through its three live states (PENDING → IN_PROGRESS →
 * COMPLETED, plus CANCELLED for forfeit-before-game-1). Per-game results
 * flow in via `recordGameResult`; the service aggregates and decides when
 * the match is over.
 *
 * Scope (A2.2): RANKED_BO2 only. Tournament best-of-3 still flows through
 * `tournamentMatchService` against the `TournamentMatch` row.
 */
import { randomBytes } from 'node:crypto'
import db from '../lib/db.js'

export class MatchError extends Error {
  constructor(code, message) {
    super(message ?? code)
    this.code = code
  }
}

/**
 * Number of games required to complete a match in this format. The match
 * always plays out the full slate — BO2 deliberately plays both games so
 * each player gets the first-mover advantage exactly once.
 */
export const GAMES_PER_FORMAT = {
  RANKED_BO2: 2,
}

/**
 * Pure helper: given the running per-game totals, decide whether the match
 * is over and who (if anyone) won. Returns `{ complete, winnerId }` where
 * `winnerId` is null for a drawn match.
 *
 * @param {object} args
 * @param {'RANKED_BO2'} args.format
 * @param {string} args.player1Id
 * @param {string} args.player2Id
 * @param {number} args.p1Wins
 * @param {number} args.p2Wins
 * @param {number} args.drawGames
 */
export function evaluateMatchOutcome({ format, player1Id, player2Id, p1Wins, p2Wins, drawGames }) {
  const target = GAMES_PER_FORMAT[format]
  if (target == null) throw new MatchError('UNKNOWN_FORMAT', `Unknown match format: ${format}`)
  const played = p1Wins + p2Wins + drawGames
  if (played < target) return { complete: false, winnerId: null }
  if (p1Wins > p2Wins) return { complete: true, winnerId: player1Id }
  if (p2Wins > p1Wins) return { complete: true, winnerId: player2Id }
  return { complete: true, winnerId: null }
}

/**
 * Create a new ranked match in PENDING. Both players are required at INSERT
 * — there is no "open seat" state for ranked. A fresh deterministic seed is
 * minted for color assignment.
 */
export async function createMatch({ gameId, player1Id, player2Id, format = 'RANKED_BO2' }) {
  if (!gameId)     throw new MatchError('BAD_INPUT', 'gameId required')
  if (!player1Id)  throw new MatchError('BAD_INPUT', 'player1Id required')
  if (!player2Id)  throw new MatchError('BAD_INPUT', 'player2Id required')
  if (player1Id === player2Id) throw new MatchError('BAD_INPUT', 'players must be distinct')
  if (!(format in GAMES_PER_FORMAT)) throw new MatchError('UNKNOWN_FORMAT', `Unknown match format: ${format}`)

  const seed = randomBytes(16).toString('hex')
  return db.match.create({
    data: { gameId, player1Id, player2Id, format, status: 'PENDING', seed },
  })
}

/**
 * Record a single completed game against a match. Increments the running
 * tally, flips PENDING → IN_PROGRESS on the first call, and on the last
 * game of the format sets winner + completedAt + status=COMPLETED.
 *
 * `winnerId` must be either `player1Id`, `player2Id`, or null (draw).
 * Recording into a COMPLETED or CANCELLED match throws WRONG_STATE.
 *
 * Runs as a transaction so the tally + status flip are atomic — important
 * because game N can complete concurrently with a stale read of game N-1.
 *
 * @returns {Promise<{ match: object, complete: boolean }>}
 */
export async function recordGameResult({ matchId, winnerId }) {
  if (!matchId) throw new MatchError('BAD_INPUT', 'matchId required')

  return db.$transaction(async (tx) => {
    const m = await tx.match.findUnique({ where: { id: matchId } })
    if (!m) throw new MatchError('NOT_FOUND', 'Match not found')
    if (m.status === 'COMPLETED' || m.status === 'CANCELLED') {
      throw new MatchError('WRONG_STATE', `Match is ${m.status}; cannot record more games`)
    }

    let p1Wins = m.p1Wins, p2Wins = m.p2Wins, drawGames = m.drawGames
    if (winnerId == null)              drawGames += 1
    else if (winnerId === m.player1Id) p1Wins    += 1
    else if (winnerId === m.player2Id) p2Wins    += 1
    else throw new MatchError('BAD_INPUT', 'winnerId must be one of the match players or null')

    const outcome = evaluateMatchOutcome({
      format: m.format,
      player1Id: m.player1Id,
      player2Id: m.player2Id,
      p1Wins, p2Wins, drawGames,
    })

    const data = { p1Wins, p2Wins, drawGames }
    if (m.status === 'PENDING') {
      data.status    = 'IN_PROGRESS'
      data.startedAt = new Date()
    }
    if (outcome.complete) {
      data.status      = 'COMPLETED'
      data.winnerId    = outcome.winnerId
      data.completedAt = new Date()
    }

    const updated = await tx.match.update({ where: { id: matchId }, data })
    return { match: updated, complete: outcome.complete }
  })
}

/**
 * Cancel a match — used when a player forfeits before any game has been
 * played. Cancelling a match that has progressed past PENDING throws
 * WRONG_STATE; mid-match forfeits should record the game result with the
 * non-forfeiting player as winner instead.
 */
export async function cancelMatch({ matchId }) {
  if (!matchId) throw new MatchError('BAD_INPUT', 'matchId required')
  const m = await db.match.findUnique({ where: { id: matchId } })
  if (!m) throw new MatchError('NOT_FOUND', 'Match not found')
  if (m.status !== 'PENDING') {
    throw new MatchError('WRONG_STATE', `Match is ${m.status}; cancel is only valid in PENDING`)
  }
  return db.match.update({
    where: { id: matchId },
    data: { status: 'CANCELLED', completedAt: new Date() },
  })
}
