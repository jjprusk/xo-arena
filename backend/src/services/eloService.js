// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * ELO Rating Service
 *
 * Computes ELO updates after game outcomes and persists them to GameElo.
 * AI opponents have fixed ELO ratings by difficulty level.
 * Bot opponents (HVB) use their live GameElo.
 *
 * Multi-game ready (A1.6): every public function accepts `{ gameId, offLadder }`
 * as a trailing options argument. `gameId` defaults to the canonical TTT slug
 * so existing single-game callers keep working untouched. `offLadder: true`
 * (per SDK `BotPersona.offLadder`) short-circuits the entire update: no
 * GameElo writes, no UserEloHistory rows, no bot-stats bumps. Reserved for
 * matches where a structural loss carries no skill signal (e.g. Connect Four
 * Master tier — first-player-wins solved game).
 */

import db from '../lib/db.js'
import { getSystemConfig } from './skillService.js'
import { GAME_IDS } from '../constants/games.js'

const K_FACTOR = 32
const DEFAULT_PROVISIONAL_THRESHOLD = 5

// Fixed ELO ratings for AI opponents (used for expected-score computation)
const AI_ELO = {
  novice:       800,
  intermediate: 1200,
  advanced:     1500,
  master:       1800,
}

function normalizeOptions(options) {
  const gameId    = options?.gameId    ?? GAME_IDS.TIC_TAC_TOE
  const offLadder = options?.offLadder === true
  return { gameId, offLadder }
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

/** Get the current ELO rating for a user in a given game (defaults to 1200). */
async function getUserElo(userId, gameId) {
  const row = await db.gameElo.findUnique({
    where: { userId_gameId: { userId, gameId } },
  })
  return row?.rating ?? 1200
}

/** Upsert GameElo for a user. Increments gamesPlayed. */
function upsertGameElo(userId, gameId, rating) {
  return db.gameElo.upsert({
    where: { userId_gameId: { userId, gameId } },
    update: { rating, gamesPlayed: { increment: 1 } },
    create: { userId, gameId, rating, gamesPlayed: 1 },
  })
}

/**
 * Update ELO for a human player after a PvAI game.
 * outcome: 'PLAYER1_WIN' | 'AI_WIN' | 'DRAW'
 * difficulty: 'novice' | 'intermediate' | 'advanced' | 'master'
 * options.gameId / options.offLadder per module docstring.
 */
export async function updatePlayerEloAfterPvAI(userId, outcome, difficulty, options = {}) {
  const { gameId, offLadder } = normalizeOptions(options)
  if (offLadder) return { newElo: null, delta: 0, skipped: true }
  try {
    const currentElo = await getUserElo(userId, gameId)
    const opponentElo = AI_ELO[difficulty?.toLowerCase()] ?? AI_ELO.intermediate
    const actualScore = outcome === 'PLAYER1_WIN' ? 1 : outcome === 'DRAW' ? 0.5 : 0
    const outcomeLabel = outcome === 'PLAYER1_WIN' ? 'win' : outcome === 'DRAW' ? 'draw' : 'loss'

    const newElo = computeNewElo(currentElo, opponentElo, actualScore)
    const delta = newElo - currentElo

    await db.$transaction([
      upsertGameElo(userId, gameId, newElo),
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
 * options.gameId / options.offLadder per module docstring.
 */
export async function updateBothElosAfterPvBot(humanId, botId, outcome, options = {}) {
  const { gameId, offLadder } = normalizeOptions(options)
  if (offLadder) {
    return {
      human: { newElo: null, delta: 0 },
      bot:   { newElo: null, delta: 0 },
      skipped: true,
    }
  }
  try {
    const [humanElo, botEloRow, botData, threshold] = await Promise.all([
      getUserElo(humanId, gameId),
      db.gameElo.findUnique({ where: { userId_gameId: { userId: botId, gameId } } }),
      db.user.findUnique({ where: { id: botId }, select: { botGamesPlayed: true, botProvisional: true } }),
      getSystemConfig('bots.provisionalGames', DEFAULT_PROVISIONAL_THRESHOLD),
    ])
    const botElo = botEloRow?.rating ?? 1200

    const humanScore = outcome === 'PLAYER1_WIN' ? 1 : outcome === 'PLAYER2_WIN' ? 0 : 0.5
    const botScore = 1 - humanScore

    const humanNewElo = computeNewElo(humanElo, botElo, humanScore)
    const botNewElo = computeNewElo(botElo, humanElo, botScore)

    const humanOutcome = humanScore === 1 ? 'win' : humanScore === 0 ? 'loss' : 'draw'
    const botOutcome = botScore === 1 ? 'win' : botScore === 0 ? 'loss' : 'draw'

    const newGamesPlayed = (botData?.botGamesPlayed ?? 0) + 1
    const nowProvisional = botData?.botProvisional && newGamesPlayed < threshold

    await db.$transaction([
      upsertGameElo(humanId, gameId, humanNewElo),
      upsertGameElo(botId, gameId, botNewElo),
      db.user.update({ where: { id: botId }, data: { botGamesPlayed: newGamesPlayed, botProvisional: nowProvisional } }),
      db.userEloHistory.create({
        data: {
          userId: humanId,
          eloRating: humanNewElo,
          delta: humanNewElo - humanElo,
          opponentType: 'bot',
          outcome: humanOutcome,
        },
      }),
      db.userEloHistory.create({
        data: {
          userId: botId,
          eloRating: botNewElo,
          delta: botNewElo - botElo,
          opponentType: 'human',
          outcome: botOutcome,
        },
      }),
    ])

    return {
      human: { newElo: humanNewElo, delta: humanNewElo - humanElo },
      bot: { newElo: botNewElo, delta: botNewElo - botElo },
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
 * options.gameId / options.offLadder per module docstring.
 */
export async function updateBothElosAfterBotVsBot(bot1Id, bot2Id, outcome, options = {}) {
  const { gameId, offLadder } = normalizeOptions(options)
  if (offLadder) {
    return {
      bot1: { newElo: null, delta: 0 },
      bot2: { newElo: null, delta: 0 },
      skipped: true,
    }
  }
  try {
    const [bot1EloRow, bot2EloRow, bot1Data, bot2Data, threshold] = await Promise.all([
      db.gameElo.findUnique({ where: { userId_gameId: { userId: bot1Id, gameId } } }),
      db.gameElo.findUnique({ where: { userId_gameId: { userId: bot2Id, gameId } } }),
      db.user.findUnique({ where: { id: bot1Id }, select: { botGamesPlayed: true, botProvisional: true } }),
      db.user.findUnique({ where: { id: bot2Id }, select: { botGamesPlayed: true, botProvisional: true } }),
      getSystemConfig('bots.provisionalGames', DEFAULT_PROVISIONAL_THRESHOLD),
    ])

    const r1 = bot1EloRow?.rating ?? 1200
    const r2 = bot2EloRow?.rating ?? 1200

    const exp1 = expectedScore(r1, r2)
    const exp2 = expectedScore(r2, r1)

    let score1 = 0.5
    if (outcome === 'PLAYER1_WIN') score1 = 1
    else if (outcome === 'PLAYER2_WIN') score1 = 0

    const score2 = 1 - score1

    const newR1 = Math.max(100, Math.round(r1 + K_FACTOR * (score1 - exp1)))
    const newR2 = Math.max(100, Math.round(r2 + K_FACTOR * (score2 - exp2)))

    const newGames1 = (bot1Data?.botGamesPlayed ?? 0) + 1
    const newGames2 = (bot2Data?.botGamesPlayed ?? 0) + 1

    await db.$transaction([
      upsertGameElo(bot1Id, gameId, newR1),
      upsertGameElo(bot2Id, gameId, newR2),
      db.user.update({
        where: { id: bot1Id },
        data: {
          botGamesPlayed: newGames1,
          botProvisional: bot1Data?.botProvisional && newGames1 < threshold,
        },
      }),
      db.user.update({
        where: { id: bot2Id },
        data: {
          botGamesPlayed: newGames2,
          botProvisional: bot2Data?.botProvisional && newGames2 < threshold,
        },
      }),
      db.userEloHistory.create({
        data: {
          userId: bot1Id,
          eloRating: newR1,
          delta: newR1 - r1,
          outcome: outcome === 'PLAYER1_WIN' ? 'win' : outcome === 'DRAW' ? 'draw' : 'loss',
          opponentType: 'bot',
        },
      }),
      db.userEloHistory.create({
        data: {
          userId: bot2Id,
          eloRating: newR2,
          delta: newR2 - r2,
          outcome: outcome === 'PLAYER2_WIN' ? 'win' : outcome === 'DRAW' ? 'draw' : 'loss',
          opponentType: 'bot',
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
 * options.gameId / options.offLadder per module docstring. (PvP rarely sets
 * offLadder since there's no AI persona involved, but the flag is honored
 * for symmetry — e.g. casual / unrated rooms.)
 */
/**
 * Update ELO after a *match* — best-of-N ranked / tournament play. The
 * per-game ELO update is replaced by a single match-level update using
 * the fractional match score (sum of per-game 1/0.5/0 scores ÷ games
 * played). One `UserEloHistory` row per side is written for the match,
 * not per game; casual single-game play continues to use the existing
 * per-game updaters.
 *
 * For PvBot matches the bot's stats (games-played + provisional flag)
 * also tick, mirroring `updateBothElosAfterPvBot`.
 *
 * @param {object} args
 * @param {string}  args.player1Id       Domain User.id
 * @param {string}  args.player2Id       Domain User.id (bot or human)
 * @param {number}  args.p1Wins          Games player1 won in the match
 * @param {number}  args.p2Wins          Games player2 won in the match
 * @param {number}  [args.drawGames]     Drawn games in the match (default 0)
 * @param {boolean} args.isP2Bot         Whether player2 is a bot (drives stats bump)
 * @param {object}  [options]            { gameId, offLadder } per module docstring
 * @returns {Promise<{ player1: { newElo, delta }, player2: { newElo, delta }, skipped? }>}
 */
export async function updateBothElosAfterMatch({
  player1Id, player2Id, p1Wins, p2Wins, drawGames = 0, isP2Bot = false,
}, options = {}) {
  const { gameId, offLadder } = normalizeOptions(options)
  if (offLadder) {
    return {
      player1: { newElo: null, delta: 0 },
      player2: { newElo: null, delta: 0 },
      skipped: true,
    }
  }
  const gamesPlayed = p1Wins + p2Wins + drawGames
  if (gamesPlayed === 0) {
    // Match with no games — nothing to score on. Safe no-op.
    return {
      player1: { newElo: null, delta: 0 },
      player2: { newElo: null, delta: 0 },
      skipped: true,
    }
  }
  try {
    const [p1Elo, p2Elo] = await Promise.all([
      getUserElo(player1Id, gameId),
      getUserElo(player2Id, gameId),
    ])

    // Match score = sum of per-game scores / games played, where each
    // game contributes 1.0 (win), 0.5 (draw), or 0.0 (loss). A 2-0 sweep
    // gives the winning side 1.0; a 1-1 draw gives 0.5/0.5; a 1.5-0.5
    // (one win + one draw) gives 0.75/0.25.
    const p1Score = (p1Wins + 0.5 * drawGames) / gamesPlayed
    const p2Score = 1 - p1Score

    const p1NewElo = computeNewElo(p1Elo, p2Elo, p1Score)
    const p2NewElo = computeNewElo(p2Elo, p1Elo, p2Score)

    const labelFor = (s) => s > 0.5 ? 'win' : s < 0.5 ? 'loss' : 'draw'
    const p1Outcome = labelFor(p1Score)
    const p2Outcome = labelFor(p2Score)

    const tx = [
      upsertGameElo(player1Id, gameId, p1NewElo),
      upsertGameElo(player2Id, gameId, p2NewElo),
      db.userEloHistory.create({
        data: {
          userId: player1Id,
          eloRating: p1NewElo,
          delta: p1NewElo - p1Elo,
          opponentType: isP2Bot ? 'bot' : 'human',
          outcome: p1Outcome,
        },
      }),
      db.userEloHistory.create({
        data: {
          userId: player2Id,
          eloRating: p2NewElo,
          delta: p2NewElo - p2Elo,
          opponentType: isP2Bot ? 'human' : 'human',
          outcome: p2Outcome,
        },
      }),
    ]

    // Bot-side bookkeeping (games-played + provisional flag) — mirror
    // updateBothElosAfterPvBot. We do this even though the bot's "match"
    // was multiple games; the bot's games-played counter is intended as
    // a confidence signal for its rating, and one match = one confidence
    // bump in the match model.
    if (isP2Bot) {
      const [botData, threshold] = await Promise.all([
        db.user.findUnique({ where: { id: player2Id }, select: { botGamesPlayed: true, botProvisional: true } }),
        getSystemConfig('bots.provisionalGames', DEFAULT_PROVISIONAL_THRESHOLD),
      ])
      const newGamesPlayed = (botData?.botGamesPlayed ?? 0) + 1
      const nowProvisional = botData?.botProvisional && newGamesPlayed < threshold
      tx.push(db.user.update({
        where: { id: player2Id },
        data:  { botGamesPlayed: newGamesPlayed, botProvisional: nowProvisional },
      }))
    }

    await db.$transaction(tx)

    return {
      player1: { newElo: p1NewElo, delta: p1NewElo - p1Elo },
      player2: { newElo: p2NewElo, delta: p2NewElo - p2Elo },
    }
  } catch (err) {
    console.error('[eloService] updateBothElosAfterMatch error:', err.message)
  }
}

export async function updatePlayersEloAfterPvP(player1Id, player2Id, outcome, options = {}) {
  const { gameId, offLadder } = normalizeOptions(options)
  if (offLadder) {
    return {
      player1: { newElo: null, delta: 0 },
      player2: { newElo: null, delta: 0 },
      skipped: true,
    }
  }
  try {
    const [p1Elo, p2Elo] = await Promise.all([
      getUserElo(player1Id, gameId),
      getUserElo(player2Id, gameId),
    ])

    const p1Score = outcome === 'PLAYER1_WIN' ? 1 : outcome === 'PLAYER2_WIN' ? 0 : 0.5
    const p2Score = 1 - p1Score

    const p1NewElo = computeNewElo(p1Elo, p2Elo, p1Score)
    const p2NewElo = computeNewElo(p2Elo, p1Elo, p2Score)

    const p1Outcome = p1Score === 1 ? 'win' : p1Score === 0 ? 'loss' : 'draw'
    const p2Outcome = p2Score === 1 ? 'win' : p2Score === 0 ? 'loss' : 'draw'

    await db.$transaction([
      upsertGameElo(player1Id, gameId, p1NewElo),
      upsertGameElo(player2Id, gameId, p2NewElo),
      db.userEloHistory.create({
        data: {
          userId: player1Id,
          eloRating: p1NewElo,
          delta: p1NewElo - p1Elo,
          opponentType: 'human',
          outcome: p1Outcome,
        },
      }),
      db.userEloHistory.create({
        data: {
          userId: player2Id,
          eloRating: p2NewElo,
          delta: p2NewElo - p2Elo,
          opponentType: 'human',
          outcome: p2Outcome,
        },
      }),
    ])

    return {
      player1: { newElo: p1NewElo, delta: p1NewElo - p1Elo },
      player2: { newElo: p2NewElo, delta: p2NewElo - p2Elo },
    }
  } catch (err) {
    console.error('[eloService] updatePlayersEloAfterPvP error:', err.message)
  }
}
