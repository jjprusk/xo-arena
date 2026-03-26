import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getUserByBetterAuthId, getBotByModelId, createGame } from '../services/userService.js'
import { updatePlayerEloAfterPvAI, updateBothElosAfterPvBot } from '../services/eloService.js'
import logger from '../logger.js'

const router = Router()

/**
 * POST /api/v1/games
 * Record a completed game for the authenticated user.
 *
 * PVAI body: { mode: 'PVAI', outcome, difficulty, aiImplementationId, totalMoves, durationMs, startedAt }
 * PVBOT body: { mode: 'PVBOT', outcome, botModelId, totalMoves, durationMs, startedAt }
 * (mode defaults to 'PVAI' for backwards compatibility)
 */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const user = await getUserByBetterAuthId(req.auth.userId)
    if (!user) return res.status(404).json({ error: 'User not found — sign in first' })

    const { outcome, difficulty, aiImplementationId, totalMoves, durationMs, startedAt, botModelId } = req.body
    const mode = req.body.mode ?? 'PVAI'

    if (!outcome || !totalMoves || !durationMs || !startedAt) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    if (mode === 'PVBOT') {
      if (!botModelId) return res.status(400).json({ error: 'botModelId required for PVBOT games' })

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
        mode: 'PVBOT',
        outcome,
        totalMoves,
        durationMs,
        startedAt,
      })

      // Update ELO for both sides (fire-and-forget)
      updateBothElosAfterPvBot(user.id, bot.id, outcome).catch(() => {})

      return res.status(201).json({ game: { id: game.id } })
    }

    // Default: PVAI
    let winnerId = null
    if (outcome === 'PLAYER1_WIN') winnerId = user.id

    const game = await createGame({
      player1Id: user.id,
      mode: 'PVAI',
      outcome,
      winnerId,
      difficulty: difficulty?.toUpperCase() || null,
      aiImplementationId: aiImplementationId || null,
      totalMoves,
      durationMs,
      startedAt,
    })

    // Update player ELO (fire-and-forget — non-fatal)
    updatePlayerEloAfterPvAI(user.id, outcome, difficulty).catch(() => {})

    res.status(201).json({ game: { id: game.id } })
  } catch (err) {
    logger.error({ err }, 'Failed to record game')
    next(err)
  }
})

export default router
