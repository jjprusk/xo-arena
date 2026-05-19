// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * rankedMatchOrchestrator — transport-agnostic ranked-match lifecycle glue.
 *
 * Combines `matchService` (DB lifecycle) with `matchColors` (deterministic
 * first-mover assignment) into the two operations a call site needs:
 *
 *   1. `startRankedMatch` — at "ranked vs X" entry, mint the Match row and
 *      return the metadata required to spawn game 1's table.
 *
 *   2. `advanceMatchAfterGame` — at game-end, record the per-game result
 *      against the match and either return the next game's spawn metadata
 *      (BO2 not yet complete) or signal that the match is over.
 *
 * The orchestrator is intentionally transport-agnostic: it does NOT mint
 * tables, dispatch SSE events, or update ELO. Those concerns live in the
 * call site (`routes/play.js`, the game-completion hook in
 * `tableFlowService` / `botGameRunner`, and `eloService` respectively).
 * Keeping this layer narrow makes it trivially unit-testable and lets the
 * same code serve both HvB and HvH ranked play.
 *
 * Format scope (A2.4): RANKED_BO2 only. Tournament BO3 stays on
 * `TournamentMatch` / `tournamentMatchService`.
 */
import { createMatch, recordGameResult, GAMES_PER_FORMAT, MatchError } from './matchService.js'
import { assignColors } from './matchColors.js'

/**
 * Build the per-game spawn metadata a table-mint call site needs. Pure;
 * does not touch the DB. Exported so `advanceMatchAfterGame` can reuse it
 * but also useful in tests.
 *
 * @param {object} args
 * @param {object} args.match          The Match row (must have seed + player ids + format)
 * @param {number} args.sequence       1-indexed (1 or 2 for BO2)
 * @returns {{ matchId: string, sequence: number, firstMoverId: string,
 *             secondMoverId: string, p1IsFirstMover: boolean,
 *             gameId: string, format: string }}
 */
export function buildGameSpawnSpec({ match, sequence }) {
  if (!match)    throw new MatchError('BAD_INPUT', 'match required')
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new MatchError('BAD_INPUT', `sequence must be a positive integer, got ${sequence}`)
  }
  const target = GAMES_PER_FORMAT[match.format]
  if (target == null) throw new MatchError('UNKNOWN_FORMAT', `Unknown match format: ${match.format}`)
  if (sequence > target) {
    throw new MatchError('BAD_INPUT', `sequence ${sequence} exceeds ${target}-game format`)
  }

  const colors = assignColors({
    seed:      match.seed,
    player1Id: match.player1Id,
    player2Id: match.player2Id,
    sequence,
  })

  return {
    matchId:        match.id,
    sequence,
    firstMoverId:   colors.firstMoverId,
    secondMoverId:  colors.secondMoverId,
    p1IsFirstMover: colors.p1IsFirstMover,
    gameId:         match.gameId,
    format:         match.format,
  }
}

/**
 * Mint a ranked match and return the spawn spec for game 1. Caller uses
 * the spec to create the actual game table (HvB or HvH) with the correct
 * first mover and `matchId` stamped on each Game row spawned from the
 * table.
 *
 * @param {object} args
 * @param {string} args.gameId      e.g. 'tic-tac-toe'
 * @param {string} args.player1Id   Domain User.id
 * @param {string} args.player2Id   Domain User.id (may be a bot User row id)
 * @param {string} [args.format]    Defaults to 'RANKED_BO2'
 * @returns {Promise<{ match: object, spawn: object }>}
 */
export async function startRankedMatch({ gameId, player1Id, player2Id, format = 'RANKED_BO2' }) {
  const match = await createMatch({ gameId, player1Id, player2Id, format })
  const spawn = buildGameSpawnSpec({ match, sequence: 1 })
  return { match, spawn }
}

/**
 * Record a completed game against the match and decide what comes next.
 *
 * When the match is not yet complete (BO2 game 1 just ended), returns
 * `{ complete: false, match, nextSpawn }` so the caller can immediately
 * mint game 2's table with swapped colors.
 *
 * When the match is complete (BO2 second game just ended), returns
 * `{ complete: true, match, nextSpawn: null }`. The caller is then
 * responsible for finalizing — emitting `match.completed`, running the
 * match-level ELO update via `eloService` — but those concerns are
 * deliberately not handled here.
 *
 * `winnerId` must be the Match.player1Id, Match.player2Id, or null for a
 * drawn game.
 *
 * @param {object} args
 * @param {string} args.matchId
 * @param {string|null} args.winnerId
 * @returns {Promise<{ complete: boolean, match: object, nextSpawn: object | null }>}
 */
export async function advanceMatchAfterGame({ matchId, winnerId }) {
  const { match, complete } = await recordGameResult({ matchId, winnerId })
  if (complete) {
    return { complete: true, match, nextSpawn: null }
  }
  // Not complete → next game is sequence = (games played so far) + 1
  const played = match.p1Wins + match.p2Wins + match.drawGames
  const nextSpawn = buildGameSpawnSpec({ match, sequence: played + 1 })
  return { complete: false, match, nextSpawn }
}
