// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import db from '../lib/db.js'
import logger from '../logger.js'

const router = Router()

const TOURNAMENT_SERVICE_URL = process.env.TOURNAMENT_SERVICE_URL || 'http://localhost:3001'

// POST /api/v1/tournament-matches/:matchId/complete
// Proxy for human players to submit MIXED-mode match results.
// Validates the caller is a participant, then forwards to the tournament service
// with the internal secret (which the browser cannot send directly).
router.post('/:matchId/complete', requireAuth, async (req, res, next) => {
  try {
    const { matchId } = req.params
    const { winnerId, p1Wins, p2Wins, drawGames } = req.body

    const match = await db.tournamentMatch.findUnique({ where: { id: matchId } })
    if (!match) return res.status(404).json({ error: 'Match not found' })

    const appUser = await db.user.findUnique({
      where: { betterAuthId: req.auth.userId },
      select: { id: true },
    })
    if (!appUser) return res.status(403).json({ error: 'Forbidden' })

    const participantIds = [match.participant1Id, match.participant2Id].filter(Boolean)
    const participants = participantIds.length
      ? await db.tournamentParticipant.findMany({
          where: { id: { in: participantIds } },
          select: { userId: true },
        })
      : []

    const isParticipant = participants.some(p => p.userId === appUser.id)
    if (!isParticipant) return res.status(403).json({ error: 'Forbidden' })

    const tsRes = await fetch(`${TOURNAMENT_SERVICE_URL}/api/matches/${matchId}/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.INTERNAL_SECRET ? { 'x-internal-secret': process.env.INTERNAL_SECRET } : {}),
      },
      body: JSON.stringify({ winnerId, p1Wins, p2Wins, drawGames }),
    })

    const body = await tsRes.json().catch(() => ({}))
    if (!tsRes.ok) {
      logger.warn({ matchId, status: tsRes.status, body }, 'tournament-matches proxy: non-2xx from tournament service')
      return res.status(tsRes.status).json(body)
    }
    res.json(body)
  } catch (e) {
    next(e)
  }
})

export default router
