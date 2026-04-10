/**
 * Match routes.
 *
 * POST /matches/:id/complete — record match result — requireAuth + requireTournamentAdmin
 *   body: { winnerId, p1Wins, p2Wins, drawGames, drawResolution? }
 *   After completing: publish tournament:match:result Redis event
 *   If tournament completed: publish tournament:completed Redis event (handled in service)
 */

import { Router } from 'express'
import { requireAuth, requireTournamentAdmin } from '../middleware/auth.js'
import { completeMatch } from '../services/tournamentService.js'
import { publishEvent } from '../lib/redis.js'
import logger from '../logger.js'

const router = Router()

// ─── Complete a match ─────────────────────────────────────────────────────────

router.post('/:id/complete', requireAuth, requireTournamentAdmin, async (req, res) => {
  try {
    const { winnerId, p1Wins, p2Wins, drawGames, drawResolution } = req.body

    if (!winnerId) {
      return res.status(400).json({ error: 'winnerId is required' })
    }

    const { match, tournament } = await completeMatch(req.params.id, winnerId, {
      p1Wins: p1Wins ?? 0,
      p2Wins: p2Wins ?? 0,
      drawGames: drawGames ?? 0,
      drawResolution: drawResolution ?? null,
    })

    // Publish match result event
    await publishEvent('tournament:match:result', {
      tournamentId: match.tournamentId,
      matchId: match.id,
      winnerId,
      p1Wins: match.p1Wins,
      p2Wins: match.p2Wins,
      drawGames: match.drawGames,
    })

    res.json({ match, tournament })
  } catch (err) {
    logger.error({ err }, 'Failed to complete match')
    const status = err.status ?? 500
    res.status(status).json({ error: err.message || 'Failed to complete match' })
  }
})

export default router
