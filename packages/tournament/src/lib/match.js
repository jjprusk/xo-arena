/**
 * Match state machine and draw cascade resolution for single elimination.
 */

/**
 * Record a game result within a match and determine if the match is complete.
 *
 * @param {object} match - current TournamentMatch record
 *   { participant1Id, participant2Id, p1Wins, p2Wins, drawGames }
 * @param {string|null} gameWinnerId - participant ID who won the game, or null for draw
 * @param {number} bestOfN - series length (e.g. 3 = first to 2 wins)
 * @returns {{ p1Wins: number, p2Wins: number, drawGames: number, matchComplete: boolean, matchWinnerId: string|null }}
 */
export function recordGameResult(match, gameWinnerId, bestOfN) {
  let p1Wins = match.p1Wins ?? 0
  let p2Wins = match.p2Wins ?? 0
  let drawGames = match.drawGames ?? 0

  if (gameWinnerId === null || gameWinnerId === undefined) {
    // Draw game
    drawGames += 1
  } else if (gameWinnerId === match.participant1Id) {
    p1Wins += 1
  } else if (gameWinnerId === match.participant2Id) {
    p2Wins += 1
  } else {
    // Unknown winner ID — treat as draw
    drawGames += 1
  }

  const winsNeeded = Math.ceil(bestOfN / 2)
  const gamesPlayed = p1Wins + p2Wins + drawGames

  let matchComplete = false
  let matchWinnerId = null

  if (p1Wins >= winsNeeded) {
    matchComplete = true
    matchWinnerId = match.participant1Id
  } else if (p2Wins >= winsNeeded) {
    matchComplete = true
    matchWinnerId = match.participant2Id
  } else if (gamesPlayed >= bestOfN) {
    // All games played without a decisive winner — series ended in a draw
    matchComplete = true
    matchWinnerId = null // Caller must invoke resolveDrawCascade
  }

  return { p1Wins, p2Wins, drawGames, matchComplete, matchWinnerId }
}

/**
 * Draw cascade for single elimination — resolve when series ends in a draw.
 * Steps (in order):
 *   1. WINS — player with more total wins advances. If tied, go to step 2.
 *   2. ELO  — player with higher eloAtRegistration advances. If tied, go to step 3.
 *   3. RANDOM — coin flip.
 *
 * @param {{ participant1Id: string, participant2Id: string, p1Wins: number, p2Wins: number }} match
 * @param {{ id: string, eloAtRegistration: number }} p1
 * @param {{ id: string, eloAtRegistration: number }} p2
 * @returns {{ winnerId: string, resolution: 'WINS' | 'ELO' | 'RANDOM' }}
 */
export function resolveDrawCascade(match, p1, p2) {
  const p1Wins = match.p1Wins ?? 0
  const p2Wins = match.p2Wins ?? 0

  // Step 1: WINS tiebreaker
  if (p1Wins > p2Wins) {
    return { winnerId: p1.id, resolution: 'WINS' }
  }
  if (p2Wins > p1Wins) {
    return { winnerId: p2.id, resolution: 'WINS' }
  }

  // Step 2: ELO tiebreaker
  const p1Elo = p1.eloAtRegistration ?? 0
  const p2Elo = p2.eloAtRegistration ?? 0

  if (p1Elo > p2Elo) {
    return { winnerId: p1.id, resolution: 'ELO' }
  }
  if (p2Elo > p1Elo) {
    return { winnerId: p2.id, resolution: 'ELO' }
  }

  // Step 3: RANDOM tiebreaker (coin flip)
  const winnerId = Math.random() < 0.5 ? p1.id : p2.id
  return { winnerId, resolution: 'RANDOM' }
}
