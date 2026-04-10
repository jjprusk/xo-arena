/**
 * Tournament CRUD and lifecycle routes.
 *
 * GET    /tournaments          — list (filter: status, game) — public
 * GET    /tournaments/:id      — get tournament + participants + rounds + matches — public
 * POST   /tournaments          — create — requireAuth + requireTournamentAdmin
 * PATCH  /tournaments/:id      — update (only in DRAFT) — requireAuth + requireTournamentAdmin
 * POST   /tournaments/:id/publish  — DRAFT→REGISTRATION_OPEN — requireAuth + requireTournamentAdmin
 * POST   /tournaments/:id/cancel   — cancel — requireAuth + requireTournamentAdmin
 * POST   /tournaments/:id/start    — start (generate bracket) — requireAuth + requireTournamentAdmin
 * POST   /tournaments/:id/register — self-register — requireAuth
 * DELETE /tournaments/:id/register — self-withdraw — requireAuth
 */

import { Router } from 'express'
import { requireAuth, requireTournamentAdmin } from '../middleware/auth.js'
import {
  createTournament,
  updateTournament,
  publishTournament,
  cancelTournament,
  registerParticipant,
  withdrawParticipant,
  startTournament,
} from '../services/tournamentService.js'
import db from '@xo-arena/db'
import logger from '../logger.js'

const router = Router()

// ─── List tournaments ─────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const { status, game, page = '1', limit = '20' } = req.query

    const where = {}
    if (status) where.status = status
    if (game) where.game = game

    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20))
    const skip = (pageNum - 1) * limitNum

    const [tournaments, total] = await Promise.all([
      db.tournament.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
        include: {
          _count: { select: { participants: { where: { status: { notIn: ['WITHDRAWN'] } } } } },
        },
      }),
      db.tournament.count({ where }),
    ])

    res.json({
      tournaments,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    })
  } catch (err) {
    logger.error({ err }, 'Failed to list tournaments')
    res.status(500).json({ error: 'Failed to list tournaments' })
  }
})

// ─── Get tournament by ID ─────────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const tournament = await db.tournament.findUnique({
      where: { id: req.params.id },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatarUrl: true,
                betterAuthId: true,
                eloRating: true,
              },
            },
          },
          orderBy: { seedPosition: 'asc' },
        },
        rounds: {
          orderBy: { roundNumber: 'asc' },
          include: {
            matches: {
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    })

    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' })
    }

    res.json({ tournament })
  } catch (err) {
    logger.error({ err }, 'Failed to get tournament')
    res.status(500).json({ error: 'Failed to get tournament' })
  }
})

// ─── Create tournament ────────────────────────────────────────────────────────

router.post('/', requireAuth, requireTournamentAdmin, async (req, res) => {
  try {
    const tournament = await createTournament(req.body, req.auth.userId)
    res.status(201).json({ tournament })
  } catch (err) {
    logger.error({ err }, 'Failed to create tournament')
    const status = err.status ?? 500
    res.status(status).json({ error: err.message || 'Failed to create tournament' })
  }
})

// ─── Update tournament ────────────────────────────────────────────────────────

router.patch('/:id', requireAuth, requireTournamentAdmin, async (req, res) => {
  try {
    const tournament = await updateTournament(req.params.id, req.body, req.auth.userId)
    res.json({ tournament })
  } catch (err) {
    logger.error({ err }, 'Failed to update tournament')
    const status = err.status ?? 500
    res.status(status).json({ error: err.message || 'Failed to update tournament' })
  }
})

// ─── Publish tournament ───────────────────────────────────────────────────────

router.post('/:id/publish', requireAuth, requireTournamentAdmin, async (req, res) => {
  try {
    const tournament = await publishTournament(req.params.id, req.auth.userId)
    res.json({ tournament })
  } catch (err) {
    logger.error({ err }, 'Failed to publish tournament')
    const status = err.status ?? 500
    res.status(status).json({ error: err.message || 'Failed to publish tournament' })
  }
})

// ─── Cancel tournament ────────────────────────────────────────────────────────

router.post('/:id/cancel', requireAuth, requireTournamentAdmin, async (req, res) => {
  try {
    const tournament = await cancelTournament(req.params.id, req.auth.userId)
    res.json({ tournament })
  } catch (err) {
    logger.error({ err }, 'Failed to cancel tournament')
    const status = err.status ?? 500
    res.status(status).json({ error: err.message || 'Failed to cancel tournament' })
  }
})

// ─── Start tournament ─────────────────────────────────────────────────────────

router.post('/:id/start', requireAuth, requireTournamentAdmin, async (req, res) => {
  try {
    const result = await startTournament(req.params.id, req.auth.userId)
    res.json(result)
  } catch (err) {
    logger.error({ err }, 'Failed to start tournament')
    const status = err.status ?? 500
    res.status(status).json({ error: err.message || 'Failed to start tournament' })
  }
})

// ─── Self-register ────────────────────────────────────────────────────────────

router.post('/:id/register', requireAuth, async (req, res) => {
  try {
    const participant = await registerParticipant(req.params.id, req.auth.userId)
    res.status(201).json({ participant })
  } catch (err) {
    logger.error({ err }, 'Failed to register participant')
    const status = err.status ?? 500
    res.status(status).json({ error: err.message || 'Failed to register' })
  }
})

// ─── Self-withdraw ────────────────────────────────────────────────────────────

router.delete('/:id/register', requireAuth, async (req, res) => {
  try {
    const participant = await withdrawParticipant(req.params.id, req.auth.userId)
    res.json({ participant })
  } catch (err) {
    logger.error({ err }, 'Failed to withdraw participant')
    const status = err.status ?? 500
    res.status(status).json({ error: err.message || 'Failed to withdraw' })
  }
})

export default router
