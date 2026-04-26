// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Bot vs Bot game management routes.
 *
 * POST /api/v1/bot-games           Start a new server-side bot vs bot game (admin/bot-admin only)
 * POST /api/v1/bot-games/practice  Spar — user's bot vs system bot at chosen tier (any signed-in user)
 * GET  /api/v1/bot-games           List active bot games
 * GET  /api/v1/bot-games/:slug     Get state of a specific bot game
 */

import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { botGameRunner } from '../realtime/botGameRunner.js'
import { hasRole } from '../utils/roles.js'
import { isValidSparTier, botUsernameForTier, SPAR_TIERS } from '../config/sparTiers.js'
import db from '../lib/db.js'

const router = Router()

/**
 * POST /api/v1/bot-games
 * Start a bot vs bot game. Requires ADMIN or BOT_ADMIN role.
 * Body: { bot1Id, bot2Id, moveDelayMs? }
 */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const caller = await db.user.findUnique({
      where: { betterAuthId: req.auth.userId },
      include: { userRoles: { select: { role: true } } },
    })
    if (!caller) return res.status(404).json({ error: 'User not found' })
    if (!hasRole(caller, 'ADMIN') && !hasRole(caller, 'BOT_ADMIN')) {
      return res.status(403).json({ error: 'Requires ADMIN or BOT_ADMIN role' })
    }

    const { bot1Id, bot2Id, moveDelayMs } = req.body
    if (!bot1Id || !bot2Id) return res.status(400).json({ error: 'bot1Id and bot2Id are required' })
    if (bot1Id === bot2Id) return res.status(400).json({ error: 'Bots must be different' })

    const [bot1, bot2] = await Promise.all([
      db.user.findUnique({ where: { id: bot1Id }, select: { id: true, displayName: true, botModelId: true, isBot: true, botActive: true } }),
      db.user.findUnique({ where: { id: bot2Id }, select: { id: true, displayName: true, botModelId: true, isBot: true, botActive: true } }),
    ])

    if (!bot1?.isBot) return res.status(404).json({ error: 'bot1 not found or not a bot' })
    if (!bot2?.isBot) return res.status(404).json({ error: 'bot2 not found or not a bot' })
    if (!bot1.botActive) return res.status(409).json({ error: `${bot1.displayName} is inactive` })
    if (!bot2.botActive) return res.status(409).json({ error: `${bot2.displayName} is inactive` })

    const { slug, displayName } = await botGameRunner.startGame({
      bot1,
      bot2,
      moveDelayMs: moveDelayMs ? Number(moveDelayMs) : undefined,
    })

    res.status(201).json({ slug, displayName })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/v1/bot-games/practice
 *
 * Spar — kick off a bot-vs-bot match between the caller's bot and a system
 * bot at the chosen tier. The caller spectates the match like any other
 * bot-game; on completion, journey step 5 is credited (Curriculum step 5).
 *
 * Body: { myBotId, opponentTier: 'easy' | 'medium' | 'hard', moveDelayMs? }
 *
 * Auth: any signed-in user. Caller must own `myBotId`.
 *
 * One-active-spar-per-bot: a previous in-flight spar for the same bot is
 * force-closed first, mirroring the Demo Table macro's replacement policy.
 */
router.post('/practice', requireAuth, async (req, res, next) => {
  try {
    const caller = await db.user.findUnique({
      where: { betterAuthId: req.auth.userId },
      select: { id: true },
    })
    if (!caller) return res.status(404).json({ error: 'User not found' })

    const { myBotId, opponentTier, moveDelayMs } = req.body ?? {}
    if (!myBotId)         return res.status(400).json({ error: 'myBotId is required' })
    if (!opponentTier)    return res.status(400).json({ error: 'opponentTier is required' })
    if (!isValidSparTier(opponentTier)) {
      return res.status(400).json({ error: `opponentTier must be one of: ${SPAR_TIERS.join(', ')}` })
    }

    // Ownership + bot validity
    const myBot = await db.user.findUnique({
      where:  { id: myBotId },
      select: { id: true, displayName: true, botModelId: true, isBot: true, botActive: true, botOwnerId: true, botInTournament: true },
    })
    if (!myBot?.isBot)                  return res.status(404).json({ error: 'myBot not found' })
    if (myBot.botOwnerId !== caller.id) return res.status(403).json({ error: 'You do not own this bot' })
    if (!myBot.botActive)            return res.status(409).json({ error: `${myBot.displayName} is inactive` })
    if (myBot.botInTournament) {
      return res.status(409).json({ error: `${myBot.displayName} is currently in a tournament` })
    }

    // Resolve opponent system bot by tier
    const opponentUsername = botUsernameForTier(opponentTier)
    const opponentBot = await db.user.findUnique({
      where:  { username: opponentUsername },
      select: { id: true, displayName: true, botModelId: true, isBot: true, botActive: true },
    })
    if (!opponentBot?.isBot) {
      return res.status(500).json({ error: `Tier opponent ${opponentUsername} is missing — re-run seed?` })
    }

    // One-active-spar-per-bot: kill any prior in-flight spar for this bot.
    const existingSlug = botGameRunner.findActiveSparForBot(myBot.id)
    if (existingSlug) botGameRunner.closeGameBySlug(existingSlug)

    const { slug, displayName } = await botGameRunner.startGame({
      bot1: myBot,
      bot2: opponentBot,
      moveDelayMs: moveDelayMs ? Number(moveDelayMs) : undefined,
      isSpar: true,
      sparUserId: caller.id,
    })

    res.status(201).json({ slug, displayName, opponentTier })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/v1/bot-games
 * List active bot vs bot games.
 */
router.get('/', (_req, res) => {
  res.json({ games: botGameRunner.listGames() })
})

/**
 * GET /api/v1/bot-games/:slug
 * Get state of a specific bot game (for initial spectator sync).
 */
router.get('/:slug', (req, res) => {
  const game = botGameRunner.getGame(req.params.slug)
  if (!game) return res.status(404).json({ error: 'Bot game not found' })

  res.json({
    game: {
      slug: game.slug,
      displayName: game.displayName,
      board: game.board,
      currentTurn: game.currentTurn,
      status: game.status,
      winner: game.winner,
      winLine: game.winLine,
      spectatorCount: game.spectatorIds.size,
      isBotGame: true,
      bot1: { displayName: game.bot1.displayName, mark: 'X' },
      bot2: { displayName: game.bot2.displayName, mark: 'O' },
    },
  })
})

export default router
