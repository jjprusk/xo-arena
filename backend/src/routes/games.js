import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getUserByClerkId, createGame } from '../services/userService.js'
import logger from '../logger.js'

const router = Router()

/**
 * POST /api/v1/games
 * Record a completed PvAI game for the authenticated user.
 * Body: { outcome, difficulty, aiImplementationId, totalMoves, durationMs, startedAt, board }
 */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const user = await getUserByClerkId(req.auth.userId)
    if (!user) return res.status(404).json({ error: 'User not found — sign in first' })

    const { outcome, difficulty, aiImplementationId, totalMoves, durationMs, startedAt } = req.body

    if (!outcome || !totalMoves || !durationMs || !startedAt) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    // Derive winnerId from outcome
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

    res.status(201).json({ game: { id: game.id } })
  } catch (err) {
    logger.error({ err }, 'Failed to record game')
    next(err)
  }
})

export default router
