/**
 * ELO Rating Service — Human Players
 *
 * Computes ELO updates after game outcomes and persists them.
 * AI opponents have fixed ELO ratings by difficulty level.
 */

import db from '../lib/db.js'

const K_FACTOR = 32

// Fixed ELO ratings for AI opponents (used for expected-score computation)
const AI_ELO = {
  easy:   800,
  medium: 1200,
  hard:   1800,
}

/**
 * Expected score for a player with `ratingA` against `ratingB`.
 */
function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400))
}

/**
 * Compute new ELO rating.
 * actualScore: 1 = win, 0.5 = draw, 0 = loss
 */
function computeNewElo(currentElo, opponentElo, actualScore) {
  const expected = expectedScore(currentElo, opponentElo)
  return Math.round((currentElo + K_FACTOR * (actualScore - expected)) * 10) / 10
}

/**
 * Update ELO for a human player after a PvAI game.
 * outcome: 'PLAYER1_WIN' | 'AI_WIN' | 'DRAW'
 * difficulty: 'easy' | 'medium' | 'hard'
 */
export async function updatePlayerEloAfterPvAI(userId, outcome, difficulty) {
  try {
    const user = await db.user.findUnique({ where: { id: userId }, select: { eloRating: true } })
    if (!user) return

    const opponentElo = AI_ELO[difficulty?.toLowerCase()] ?? AI_ELO.medium
    const actualScore = outcome === 'PLAYER1_WIN' ? 1 : outcome === 'DRAW' ? 0.5 : 0
    const outcomeLabel = outcome === 'PLAYER1_WIN' ? 'win' : outcome === 'DRAW' ? 'draw' : 'loss'

    const newElo = computeNewElo(user.eloRating, opponentElo, actualScore)
    const delta = newElo - user.eloRating

    await db.$transaction([
      db.user.update({ where: { id: userId }, data: { eloRating: newElo } }),
      db.userEloHistory.create({
        data: {
          userId,
          eloRating: newElo,
          delta,
          opponentType: `ai_${difficulty?.toLowerCase() ?? 'medium'}`,
          outcome: outcomeLabel,
        },
      }),
    ])

    return { newElo, delta }
  } catch (err) {
    // Non-fatal — log and continue
    console.error('[eloService] updatePlayerEloAfterPvAI error:', err.message)
  }
}

/**
 * Update ELO for both players after a PvP game.
 * outcome: 'PLAYER1_WIN' | 'PLAYER2_WIN' | 'DRAW'
 */
export async function updatePlayersEloAfterPvP(player1Id, player2Id, outcome) {
  try {
    const [p1, p2] = await Promise.all([
      db.user.findUnique({ where: { id: player1Id }, select: { eloRating: true } }),
      db.user.findUnique({ where: { id: player2Id }, select: { eloRating: true } }),
    ])
    if (!p1 || !p2) return

    const p1Score = outcome === 'PLAYER1_WIN' ? 1 : outcome === 'PLAYER2_WIN' ? 0 : 0.5
    const p2Score = 1 - p1Score

    const p1NewElo = computeNewElo(p1.eloRating, p2.eloRating, p1Score)
    const p2NewElo = computeNewElo(p2.eloRating, p1.eloRating, p2Score)

    const p1Outcome = p1Score === 1 ? 'win' : p1Score === 0 ? 'loss' : 'draw'
    const p2Outcome = p2Score === 1 ? 'win' : p2Score === 0 ? 'loss' : 'draw'

    await db.$transaction([
      db.user.update({ where: { id: player1Id }, data: { eloRating: p1NewElo } }),
      db.user.update({ where: { id: player2Id }, data: { eloRating: p2NewElo } }),
      db.userEloHistory.create({
        data: {
          userId: player1Id,
          eloRating: p1NewElo,
          delta: p1NewElo - p1.eloRating,
          opponentType: 'human',
          outcome: p1Outcome,
        },
      }),
      db.userEloHistory.create({
        data: {
          userId: player2Id,
          eloRating: p2NewElo,
          delta: p2NewElo - p2.eloRating,
          opponentType: 'human',
          outcome: p2Outcome,
        },
      }),
    ])

    return {
      player1: { newElo: p1NewElo, delta: p1NewElo - p1.eloRating },
      player2: { newElo: p2NewElo, delta: p2NewElo - p2.eloRating },
    }
  } catch (err) {
    console.error('[eloService] updatePlayersEloAfterPvP error:', err.message)
  }
}
