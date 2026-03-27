/**
 * ELO Rating Service
 *
 * Computes ELO updates after game outcomes and persists them.
 * AI opponents have fixed ELO ratings by difficulty level.
 * Bot opponents (PVBOT) use live ELO from their User row.
 */

import db from '../lib/db.js'
import { getSystemConfig } from './mlService.js'

const K_FACTOR = 32
const DEFAULT_PROVISIONAL_THRESHOLD = 5

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
    const [human, bot, threshold] = await Promise.all([
      db.user.findUnique({ where: { id: humanId }, select: { eloRating: true } }),
      db.user.findUnique({ where: { id: botId }, select: { eloRating: true, botGamesPlayed: true, botProvisional: true } }),
      getSystemConfig('bots.provisionalGames', DEFAULT_PROVISIONAL_THRESHOLD),
    ])
    if (!human || !bot) return

    const humanScore = outcome === 'PLAYER1_WIN' ? 1 : outcome === 'PLAYER2_WIN' ? 0 : 0.5
    const botScore = 1 - humanScore

    const humanNewElo = computeNewElo(human.eloRating, bot.eloRating, humanScore)
    const botNewElo = computeNewElo(bot.eloRating, human.eloRating, botScore)

    const humanOutcome = humanScore === 1 ? 'win' : humanScore === 0 ? 'loss' : 'draw'
    const botOutcome = botScore === 1 ? 'win' : botScore === 0 ? 'loss' : 'draw'

    const newGamesPlayed = (bot.botGamesPlayed ?? 0) + 1
    const nowProvisional = bot.botProvisional && newGamesPlayed < threshold

    await db.$transaction([
      db.user.update({ where: { id: humanId }, data: { eloRating: humanNewElo } }),
      db.user.update({ where: { id: botId }, data: { eloRating: botNewElo, botGamesPlayed: newGamesPlayed, botProvisional: nowProvisional } }),
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
 * Update ELO for both bots after a BotVsBot game.
 * bot1Id: domain User.id of the X player (bot1)
 * bot2Id: domain User.id of the O player (bot2)
 * outcome: 'PLAYER1_WIN' | 'PLAYER2_WIN' | 'DRAW'
 */
export async function updateBothElosAfterBotVsBot(bot1Id, bot2Id, outcome) {
  try {
    const [bot1, bot2, threshold] = await Promise.all([
      db.user.findUnique({ where: { id: bot1Id }, select: { eloRating: true, botGamesPlayed: true, botProvisional: true } }),
      db.user.findUnique({ where: { id: bot2Id }, select: { eloRating: true, botGamesPlayed: true, botProvisional: true } }),
      getSystemConfig('bots.provisionalGames', DEFAULT_PROVISIONAL_THRESHOLD),
    ])
    if (!bot1 || !bot2) return

    const r1 = bot1.eloRating ?? 1200
    const r2 = bot2.eloRating ?? 1200

    const exp1 = expectedScore(r1, r2)
    const exp2 = expectedScore(r2, r1)

    let score1 = 0.5
    if (outcome === 'PLAYER1_WIN') score1 = 1
    else if (outcome === 'PLAYER2_WIN') score1 = 0

    const score2 = 1 - score1

    const newR1 = Math.max(100, Math.round(r1 + K_FACTOR * (score1 - exp1)))
    const newR2 = Math.max(100, Math.round(r2 + K_FACTOR * (score2 - exp2)))

    const newGames1 = (bot1.botGamesPlayed ?? 0) + 1
    const newGames2 = (bot2.botGamesPlayed ?? 0) + 1

    await Promise.all([
      db.user.update({
        where: { id: bot1Id },
        data: {
          eloRating: newR1,
          botGamesPlayed: newGames1,
          botProvisional: bot1.botProvisional && newGames1 < threshold,
          userEloHistory: {
            create: {
              eloRating: newR1,
              delta: newR1 - r1,
              outcome: outcome === 'PLAYER1_WIN' ? 'win' : outcome === 'DRAW' ? 'draw' : 'loss',
              opponentType: 'bot',
            },
          },
        },
      }),
      db.user.update({
        where: { id: bot2Id },
        data: {
          eloRating: newR2,
          botGamesPlayed: newGames2,
          botProvisional: bot2.botProvisional && newGames2 < threshold,
          userEloHistory: {
            create: {
              eloRating: newR2,
              delta: newR2 - r2,
              outcome: outcome === 'PLAYER2_WIN' ? 'win' : outcome === 'DRAW' ? 'draw' : 'loss',
              opponentType: 'bot',
            },
          },
        },
      }),
    ])

    return {
      bot1: { newElo: newR1, delta: newR1 - r1 },
      bot2: { newElo: newR2, delta: newR2 - r2 },
    }
  } catch (err) {
    console.error('[eloService] updateBothElosAfterBotVsBot error:', err.message)
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
