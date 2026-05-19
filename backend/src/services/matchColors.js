// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * matchColors — pure helper that decides which player moves first in each
 * game of a match.
 *
 * Game-agnostic by design: TTT calls the first mover "X", Connect 4 calls
 * them "Red". The helper only returns user IDs ("firstMoverId" /
 * "secondMoverId"); the game-side adapter maps those to the game's color
 * labels.
 *
 * Determinism matters: a reconnect mid-match must render the same color on
 * the same board, and a replay must reproduce who-moved-first. Everything
 * derives from `Match.seed` (a 32-char hex string minted at match
 * creation) plus the game `sequence` (1, 2, 3).
 *
 * Lifecycle per match (set by Connect_Four_Implementation_Plan.md §A2):
 *   - Game 1: seeded from `hash(seed)` — first bit decides starter.
 *   - Game 2: swap (the other player starts).
 *   - Game 3: tournament-only tiebreaker. With `randomTiebreaker: true`,
 *     the starter derives from `hash(seed + ":g3")` so it is announceable
 *     ("game 3 is random") yet still deterministic per match. With
 *     `randomTiebreaker: false` (default), sequence 3 just continues the
 *     swap pattern (matches sequence 1 — not used today but documented so
 *     callers don't trip on it).
 */
import { createHash } from 'node:crypto'

/**
 * Returns 0 or 1 deterministically from `seed`. Uses sha256 to keep the
 * distribution well-mixed across small input deltas (`seed` vs
 * `seed + ":g3"`).
 */
function bitFromSeed(seed) {
  const buf = createHash('sha256').update(seed).digest()
  return buf[0] & 1
}

/**
 * Decide who moves first in game `sequence` of a match.
 *
 * @param {object} args
 * @param {string} args.seed                  Match.seed (hex, opaque)
 * @param {string} args.player1Id             User.id stored in Match.player1Id
 * @param {string} args.player2Id             User.id stored in Match.player2Id
 * @param {number} args.sequence              1-indexed game position (1, 2, 3)
 * @param {boolean} [args.randomTiebreaker]   Treat sequence==3 as random
 *                                            (tournament BO3 only).
 * @returns {{ firstMoverId: string, secondMoverId: string, p1IsFirstMover: boolean }}
 */
export function assignColors({ seed, player1Id, player2Id, sequence, randomTiebreaker = false }) {
  if (!seed)                  throw new Error('assignColors: seed required')
  if (!player1Id)             throw new Error('assignColors: player1Id required')
  if (!player2Id)             throw new Error('assignColors: player2Id required')
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error(`assignColors: sequence must be a positive integer, got ${sequence}`)
  }

  // Game 1 is seeded; the swap pattern alternates every game.
  let p1IsFirstMover = bitFromSeed(seed) === 0
  if ((sequence - 1) % 2 === 1) p1IsFirstMover = !p1IsFirstMover

  // Tournament BO3: game 3 ignores the swap pattern and mixes the seed
  // with a fixed suffix, so the value is independent of game 1's outcome
  // but still reproducible from the match seed alone.
  if (sequence === 3 && randomTiebreaker) {
    p1IsFirstMover = bitFromSeed(`${seed}:g3`) === 0
  }

  return {
    firstMoverId:   p1IsFirstMover ? player1Id : player2Id,
    secondMoverId:  p1IsFirstMover ? player2Id : player1Id,
    p1IsFirstMover,
  }
}
