/**
 * ELO Rating Service
 *
 * Computes ELO updates after game outcomes and persists them.
 * AI opponents have fixed ELO ratings by difficulty level.
 * Bot opponents (PVBOT) use live ELO from their User row.
 */

import db from '../lib/db.js'

const K_FACTOR = 32

// Fixed ELO ratings for AI opponents (used for expected-score computation)
const AI_ELO = {
  novice:       800,
  intermediate: 1200,
  advanced:     1500,
  master:       1800,
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
 * difficulty: 'novice' | 'intermediate' | 'advanced' | 'master'
 */
export async function updatePlayerEloAfterPvAI(userId, outcome, difficulty) {
  try {
    const user = await db.user.findUnique({ where: { id: userId }, select: { eloRating: true } })
    if (!user) return

    const opponentElo = AI_ELO[difficulty?.toLowerCase()] ?? AI_ELO.intermediate
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
          opponentType: `ai_${difficulty?.toLowerCase() ?? 'intermediate'}`,
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
 * Update ELO for both sides after a PvBot game.
 * humanId: domain User.id of the human player (player1)
 * botId:   domain User.id of the bot (player2)
 * outcome: 'PLAYER1_WIN' | 'PLAYER2_WIN' | 'DRAW'
 */
export async function updateBothElosAfterPvBot(humanId, botId, outcome) {
  try {
    const [human, bot] = await Promise.all([
      db.user.findUnique({ where: { id: humanId }, select: { eloRating: true } }),
      db.user.findUnique({ where: { id: botId }, select: { eloRating: true } }),
    ])
    if (!human || !bot) return

    const humanScore = outcome === 'PLAYER1_WIN' ? 1 : outcome === 'PLAYER2_WIN' ? 0 : 0.5
    const botScore = 1 - humanScore

    const humanNewElo = computeNewElo(human.eloRating, bot.eloRating, humanScore)
    const botNewElo = computeNewElo(bot.eloRating, human.eloRating, botScore)

    const humanOutcome = humanScore === 1 ? 'win' : humanScore === 0 ? 'loss' : 'draw'
    const botOutcome = botScore === 1 ? 'win' : botScore === 0 ? 'loss' : 'draw'

    await db.$transaction([
      db.user.update({ where: { id: humanId }, data: { eloRating: humanNewElo } }),
      db.user.update({ where: { id: botId }, data: { eloRating: botNewElo } }),
      db.userEloHistory.create({
        data: {
          userId: humanId,
          eloRating: humanNewElo,
          delta: humanNewElo - human.eloRating,
          opponentType: 'bot',
          outcome: humanOutcome,
        },
      }),
      db.userEloHistory.create({
        data: {
          userId: botId,
          eloRating: botNewElo,
          delta: botNewElo - bot.eloRating,
          opponentType: 'human',
          outcome: botOutcome,
        },
      }),
    ])

    return {
      human: { newElo: humanNewElo, delta: humanNewElo - human.eloRating },
      bot: { newElo: botNewElo, delta: botNewElo - bot.eloRating },
    }
  } catch (err) {
    console.error('[eloService] updateBothElosAfterPvBot error:', err.message)
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
