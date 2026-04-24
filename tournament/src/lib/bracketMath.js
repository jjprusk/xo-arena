// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Bracket math — compute the expected total number of games a tournament
 * will play out to completion given its bracket type, participant count,
 * and bestOfN. Used by the admin "Games played" column, the RUNAWAY
 * detection badge, and the sweep's auto-cancel runaway-loop guard.
 *
 *   SINGLE_ELIM: eliminates one player per match. N participants → N-1
 *     matches. Each match plays up to bestOfN games.
 *   ROUND_ROBIN: every pair plays once. N participants → N*(N-1)/2
 *     matches. Each match plays up to bestOfN games.
 *
 * For a conservative upper bound (the "ceiling" a healthy tournament
 * should never exceed by much), we use full bestOfN per match — even
 * though in practice matches often end early (2-0 in bestOf3). 3× this
 * ceiling is the "something's wrong" threshold; 5× is the "stop it
 * now, it's looping" threshold.
 */

/** Total matches the bracket plays before crowning a winner. */
export function expectedMatchCount(bracketType, participantCount) {
  const n = participantCount ?? 0
  if (n < 2) return 0
  switch (bracketType) {
    case 'SINGLE_ELIM': return n - 1
    case 'ROUND_ROBIN': return (n * (n - 1)) / 2
    default:            return n - 1  // conservative fallback
  }
}

/** Ceiling on games played to resolve the whole tournament. */
export function expectedGameCount(bracketType, participantCount, bestOfN) {
  const matches = expectedMatchCount(bracketType, participantCount)
  const bon = Math.max(1, bestOfN ?? 1)
  return matches * bon
}

/** Ratio of actual games played to expected ceiling. 0 if expected is 0. */
export function runawayRatio(gamesPlayed, bracketType, participantCount, bestOfN) {
  const expected = expectedGameCount(bracketType, participantCount, bestOfN)
  if (expected === 0) return 0
  return (gamesPlayed ?? 0) / expected
}

/** "Something's wrong" — admin UI surfaces this. */
export const RUNAWAY_WARN_RATIO   = 3
/** "Stop it now" — sweep auto-cancels. */
export const RUNAWAY_CANCEL_RATIO = 5
