// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getUserByBetterAuthId, getBotByModelId, createGame } from '../services/userService.js'
import db from '../lib/db.js'
import { updatePlayerEloAfterPvAI, updateBothElosAfterPvBot } from '../services/eloService.js'
import { recordGameCompletion } from '../services/creditService.js'
import { completeStep } from '../services/journeyService.js'
import cache from '../utils/cache.js'
import logger from '../logger.js'

const router = Router()

// Maps frontend difficulty strings to Prisma Difficulty enum values
const DIFFICULTY_MAP = {
  novice: 'NOVICE',
  intermediate: 'INTERMEDIATE',
  advanced: 'ADVANCED',
  master: 'MASTER',
}

/**
 * POST /api/v1/games
 * Record a completed game for the authenticated user.
 *
 * HVA body: { mode: 'HVA', outcome, difficulty, aiImplementationId, totalMoves, durationMs, startedAt }
 * HVB body: { mode: 'HVB', outcome, botModelId, totalMoves, durationMs, startedAt }
 * (mode defaults to 'HVA' for backwards compatibility)
 */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const user = await getUserByBetterAuthId(req.auth.userId)
    if (!user) return res.status(404).json({ error: 'User not found — sign in first' })

    const { outcome, difficulty, aiImplementationId, totalMoves, durationMs, startedAt, botModelId } = req.body
    const rawMode = req.body.mode ?? 'HVA'
    // Accept legacy mode strings from older clients
    const mode = rawMode === 'PVAI' ? 'HVA' : rawMode === 'PVBOT' ? 'HVB' : rawMode

    if (!outcome || totalMoves == null || durationMs == null || !startedAt) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    if (mode === 'HVB') {
      if (!botModelId) return res.status(400).json({ error: 'botModelId required for HVB games' })

      const bot = await getBotByModelId(botModelId)
      if (!bot) return res.status(404).json({ error: 'Bot not found' })
      if (!bot.botActive) return res.status(409).json({ error: 'Bot is inactive' })

      // Derive winnerId — player1 = human, player2 = bot
      let winnerId = null
      if (outcome === 'PLAYER1_WIN') winnerId = user.id
      else if (outcome === 'PLAYER2_WIN') winnerId = bot.id

      const game = await createGame({
        player1Id: user.id,
        player2Id: bot.id,
        winnerId,
        mode: 'HVB',
        outcome,
        totalMoves,
        durationMs,
        startedAt,
      })

      // Update ELO for both sides (fire-and-forget)
      updateBothElosAfterPvBot(user.id, bot.id, outcome).catch(() => {})
      cache.invalidatePrefix('leaderboard:')

      // Record credits (fire-and-forget — failure must never block the response)
      const pvbotParticipants = [
        { userId: user.id, isBot: false, botOwnerId: null },
        { userId: bot.id, isBot: true, botOwnerId: bot.botOwnerId ?? null },
      ]
      recordGameCompletion({ appId: 'xo-arena', participants: pvbotParticipants, mode: 'hvb' })
        .catch((err) => logger.warn({ err }, 'Credit recording failed (non-fatal)'))

      // Journey step 3: first game played (fire-and-forget)
      completeStep(user.id, 3).catch(() => {})

      return res.status(201).json({ game: { id: game.id } })
    }

    // Default: HVA
    let winnerId = null
    if (outcome === 'PLAYER1_WIN') winnerId = user.id

    const game = await createGame({
      player1Id: user.id,
      mode: 'HVA',
      outcome,
      winnerId,
      difficulty: DIFFICULTY_MAP[difficulty] || null,
      aiImplementationId: aiImplementationId || null,
      totalMoves,
      durationMs,
      startedAt,
    })

    // Update player ELO (fire-and-forget — non-fatal)
    updatePlayerEloAfterPvAI(user.id, outcome, difficulty).catch(() => {})
    cache.invalidatePrefix('leaderboard:')

    // Journey step 3: first game played (fire-and-forget)
    completeStep(user.id, 3).catch(() => {})

    res.status(201).json({ game: { id: game.id } })
  } catch (err) {
    logger.error({ err }, 'Failed to record game')
    next(err)
  }
})

/**
 * GET /api/v1/games/:id/replay
 * Returns a game record with its moveStream for replay.
 * Returns 404 if game not found, 410 if moveStream has been purged.
 */
router.get('/:id/replay', requireAuth, async (req, res, next) => {
  try {
    const game = await db.game.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        player1Id: true,
        player2Id: true,
        winnerId: true,
        outcome: true,
        totalMoves: true,
        durationMs: true,
        startedAt: true,
        endedAt: true,
        isTournament: true,
        moveStream: true,
        player1: { select: { id: true, displayName: true } },
        player2: { select: { id: true, displayName: true } },
      },
    })
    if (!game) return res.status(404).json({ error: 'Game not found' })
    if (game.moveStream === null) return res.status(410).json({ error: 'Replay has been purged' })
    res.json(game)
  } catch (err) {
    next(err)
  }
})

export default router
