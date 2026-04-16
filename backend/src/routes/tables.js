// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Tables CRUD — Phase 3.1.
 *
 * A Table is the new front-door concept for browsing, creating, and joining
 * games on the Tables page. One Table targets one game (xo, connect4, …),
 * has a fixed set of seats, and tracks live preview state.
 *
 * Endpoints:
 *   POST   /api/v1/tables                — create a new table
 *   GET    /api/v1/tables                — list (public-only by default; ?mine=true for caller's tables)
 *   GET    /api/v1/tables/:id            — get one table (always allowed even if private)
 *   POST   /api/v1/tables/:id/join       — claim an empty seat
 *   POST   /api/v1/tables/:id/leave      — vacate the caller's seat
 *
 * Notification-bus events fired by these endpoints (see Phase 3.1 next commit):
 *   table.created, player.joined, table.empty
 */

import { Router } from 'express'
import { requireAuth, optionalAuth } from '../middleware/auth.js'
import db from '../lib/db.js'
import logger from '../logger.js'
import { dispatch } from '../lib/notificationBus.js'

const router = Router()

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build the initial seats array for a new table.
 * All seats start empty; the creator is NOT auto-seated — they must explicitly
 * join (matches the Tables-page UX where you can create a public bot-vs-bot
 * table without sitting yourself).
 */
function emptySeats(count) {
  return Array.from({ length: count }, () => ({ userId: null, status: 'empty' }))
}

/**
 * Validate a seats array shape.
 * Returns true if every element looks like { userId: string|null, status: 'occupied'|'empty' }.
 */
function isValidSeats(seats, expectedLength) {
  if (!Array.isArray(seats) || seats.length !== expectedLength) return false
  return seats.every(s =>
    s && typeof s === 'object'
    && (s.userId === null || typeof s.userId === 'string')
    && (s.status === 'occupied' || s.status === 'empty')
  )
}

/**
 * Find the index of the first empty seat. Returns -1 if the table is full.
 */
function firstEmptySeatIndex(seats) {
  return seats.findIndex(s => s.status === 'empty')
}

/**
 * Find the index of the seat held by userId. Returns -1 if not seated.
 */
function userSeatIndex(seats, userId) {
  return seats.findIndex(s => s.userId === userId)
}

/**
 * True when every seat is occupied.
 */
function isFull(seats) {
  return seats.every(s => s.status === 'occupied')
}

/**
 * True when no seat is occupied.
 */
function isEmpty(seats) {
  return seats.every(s => s.status === 'empty')
}

/**
 * Build the cohort for table-scoped notifications: all userIds currently seated.
 * Spectators will be added to this cohort once presence tracking lands.
 */
function tableCohort(seats) {
  return seats
    .filter(s => s.status === 'occupied' && typeof s.userId === 'string')
    .map(s => s.userId)
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/tables
 * Create a new table.
 * Body: { gameId, minPlayers, maxPlayers, isPrivate?, isTournament? }
 * Returns: the created table.
 *
 * The creator is the createdById but is NOT auto-seated; they must POST /join
 * to claim a seat. This keeps "public bot-vs-bot tables I created but am
 * spectating" trivially expressible.
 */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const {
      gameId,
      minPlayers,
      maxPlayers,
      isPrivate    = false,
      isTournament = false,
    } = req.body ?? {}

    if (typeof gameId     !== 'string' || !gameId)         return res.status(400).json({ error: 'gameId required' })
    if (!Number.isInteger(minPlayers) || minPlayers < 1)   return res.status(400).json({ error: 'minPlayers must be a positive integer' })
    if (!Number.isInteger(maxPlayers) || maxPlayers < minPlayers) return res.status(400).json({ error: 'maxPlayers must be >= minPlayers' })
    if (typeof isPrivate    !== 'boolean')                 return res.status(400).json({ error: 'isPrivate must be boolean' })
    if (typeof isTournament !== 'boolean')                 return res.status(400).json({ error: 'isTournament must be boolean' })

    const table = await db.table.create({
      data: {
        gameId,
        createdById: req.auth.userId,
        minPlayers,
        maxPlayers,
        isPrivate,
        isTournament,
        seats: emptySeats(maxPlayers),
      },
    })

    // Public tables broadcast — Tables page can react in real time.
    // Private tables don't broadcast (they're share-link only).
    if (!isPrivate) {
      dispatch({
        type: 'table.created',
        targets: { broadcast: true },
        payload: { tableId: table.id, gameId, maxPlayers },
      }).catch(err => logger.warn({ err: err.message, tableId: table.id }, 'table.created dispatch failed'))
    }

    res.status(201).json({ table })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/v1/tables
 * List tables.
 *   default       — public only (isPrivate=false), ordered newest first
 *   ?mine=true    — tables created by the caller (private + public)
 *   ?status=…     — filter to FORMING / ACTIVE / COMPLETED
 *   ?gameId=…     — filter by game
 *   ?limit=N      — page size (default 50, max 200)
 *
 * Private tables are NEVER listed in the default response; access them by
 * direct URL via GET /api/v1/tables/:id.
 */
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { mine, status, gameId } = req.query
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200)

    const where = {}
    if (mine === 'true') {
      // optionalAuth sets req.auth = null for guests
      if (!req.auth?.userId) return res.status(401).json({ error: 'Auth required for ?mine=true' })
      where.createdById = req.auth.userId
    } else {
      where.isPrivate = false
    }
    if (status && ['FORMING', 'ACTIVE', 'COMPLETED'].includes(status)) where.status = status
    if (gameId && typeof gameId === 'string') where.gameId = gameId

    const tables = await db.table.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    res.json({ tables })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/v1/tables/:id
 * Get a single table by ID.
 * Always reachable — private tables ARE accessible by direct URL (this is the
 * "share link" mechanism for private tables).
 */
router.get('/:id', async (req, res, next) => {
  try {
    const table = await db.table.findUnique({ where: { id: req.params.id } })
    if (!table) return res.status(404).json({ error: 'Table not found' })
    res.json({ table })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/v1/tables/:id/join
 * Claim an empty seat at the table.
 *
 * Idempotent: if the caller is already seated, returns 200 with the unchanged
 * table. Returns 409 when the table is full or its status is not FORMING.
 */
router.post('/:id/join', requireAuth, async (req, res, next) => {
  try {
    const table = await db.table.findUnique({ where: { id: req.params.id } })
    if (!table) return res.status(404).json({ error: 'Table not found' })
    if (table.status !== 'FORMING') return res.status(409).json({ error: 'Table is not accepting players' })

    if (!isValidSeats(table.seats, table.maxPlayers)) {
      // Defensive: shouldn't happen, but bail loudly if the column got corrupted.
      logger.warn({ tableId: table.id }, 'table.seats failed validation')
      return res.status(500).json({ error: 'Invalid seats state' })
    }

    // Already seated → no-op success
    if (userSeatIndex(table.seats, req.auth.userId) !== -1) return res.json({ table, seated: true })

    const idx = firstEmptySeatIndex(table.seats)
    if (idx === -1) return res.status(409).json({ error: 'Table is full' })

    // Build a fresh seats array — never mutate the value returned from findUnique.
    const seats = table.seats.map((s, i) =>
      i === idx ? { userId: req.auth.userId, status: 'occupied' } : s
    )

    const updated = await db.table.update({
      where: { id: table.id },
      data: { seats },
    })

    // Notify everyone seated at this table (excluding the joiner themself —
    // the bus filters them downstream via cohort de-dupe of the dispatcher).
    dispatch({
      type: 'player.joined',
      targets: { cohort: tableCohort(seats) },
      payload: { tableId: table.id, userId: req.auth.userId, seatIndex: idx },
    }).catch(err => logger.warn({ err: err.message, tableId: table.id }, 'player.joined dispatch failed'))

    res.json({ table: updated, seated: true })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/v1/tables/:id/leave
 * Vacate the caller's seat at the table.
 *
 * Returns 200 with the unchanged table if the caller wasn't seated.
 * If leaving empties the table while it's still FORMING, the table is left in
 * FORMING (the next commit will fire the table.empty bus event so the realtime
 * layer can decide whether to GC it).
 */
router.post('/:id/leave', requireAuth, async (req, res, next) => {
  try {
    const table = await db.table.findUnique({ where: { id: req.params.id } })
    if (!table) return res.status(404).json({ error: 'Table not found' })

    if (!isValidSeats(table.seats, table.maxPlayers)) {
      logger.warn({ tableId: table.id }, 'table.seats failed validation')
      return res.status(500).json({ error: 'Invalid seats state' })
    }

    const idx = userSeatIndex(table.seats, req.auth.userId)
    if (idx === -1) return res.json({ table, seated: false })

    // Fresh array — never mutate the findUnique result.
    const seats = table.seats.map((s, i) =>
      i === idx ? { userId: null, status: 'empty' } : s
    )

    const updated = await db.table.update({
      where: { id: table.id },
      data: { seats },
    })

    // Last seat vacated while still FORMING → fire table.empty so subscribers
    // (e.g. realtime layer) can decide whether to GC the table. Cohort is the
    // soon-to-be-emptied set (just the leaver in practice; spectators added
    // when presence tracking lands).
    if (updated.status === 'FORMING' && isEmpty(seats)) {
      dispatch({
        type: 'table.empty',
        targets: { cohort: [req.auth.userId] },
        payload: { tableId: table.id },
      }).catch(err => logger.warn({ err: err.message, tableId: table.id }, 'table.empty dispatch failed'))
    }

    res.json({ table: updated, seated: false })
  } catch (err) {
    next(err)
  }
})

export default router
