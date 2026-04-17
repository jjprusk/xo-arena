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
 *   table.created, player.joined, player.left, table.empty, table.deleted
 */

import { Router } from 'express'
import { requireAuth, optionalAuth } from '../middleware/auth.js'
import db from '../lib/db.js'
import logger from '../logger.js'
import { dispatch } from '../lib/notificationBus.js'
import { mountainPool, MountainNamePool } from '../realtime/mountainNames.js'

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

/**
 * Build the enriched payload for player.joined / player.left bus events.
 *
 * Consumers:
 *   - Tables page & detail page re-fetch on every event regardless of
 *     relationship (they need to keep lists + seat strips live).
 *   - AppLayout's notification stack only surfaces these for stakeholders —
 *     the table's creator, or anyone currently seated, minus the actor.
 *     `stakeholders` is the allowlist the client filters against; we include
 *     it in the payload so the client doesn't have to fetch anything.
 *
 * Also embeds `actorDisplayName` so the toast copy reads "Joe took seat 2"
 * instead of "ba_user_abc took seat 2" without another round trip.
 */
async function buildSeatChangePayload({ table, updatedSeats, actorBaId, seatIndex }) {
  const seatedBaIds = (updatedSeats ?? [])
    .filter(s => s?.status === 'occupied' && typeof s.userId === 'string')
    .map(s => s.userId)
  const stakeholders = [...new Set([table.createdById, ...seatedBaIds].filter(Boolean))]

  let actorDisplayName = null
  try {
    const actor = await db.user.findUnique({
      where:  { betterAuthId: actorBaId },
      select: { displayName: true },
    })
    actorDisplayName = actor?.displayName ?? null
  } catch (err) {
    // Non-fatal — client falls back to a userId-slice label.
    logger.warn({ err: err.message, actorBaId }, 'buildSeatChangePayload(): actor lookup failed')
  }

  return {
    tableId: table.id,
    gameId:  table.gameId,
    userId:  actorBaId,
    seatIndex,
    stakeholders,
    actorDisplayName,
  }
}

/**
 * Enrich one or more tables with seated-player display info.
 *
 * Seats persist only `{ userId (betterAuthId), status }`. For rendering we also
 * want the player's `displayName` and `avatarUrl`, but we don't want to
 * duplicate that data into the Table row (names change, avatars change) —
 * instead we hydrate on read.
 *
 * Accepts a single table or an array. Returns the same shape, with every
 * occupied seat now also carrying `{ displayName, avatarUrl, isBot }` when
 * the owning user was found. Unknown userIds fall through unchanged so the
 * frontend can still show a truncated-id fallback.
 *
 * Does a single `findMany({ betterAuthId: { in: [...] } })` regardless of
 * input size, so this is safe to use on the list endpoint.
 */
async function withSeatDisplay(input) {
  const tables = Array.isArray(input) ? input : [input]
  if (tables.length === 0) return input

  const baIds = new Set()
  for (const t of tables) {
    if (!Array.isArray(t?.seats)) continue
    for (const s of t.seats) {
      if (s?.status === 'occupied' && typeof s.userId === 'string') baIds.add(s.userId)
    }
  }
  if (baIds.size === 0) return input

  let users = []
  try {
    users = await db.user.findMany({
      where:  { betterAuthId: { in: [...baIds] } },
      select: { betterAuthId: true, displayName: true, avatarUrl: true, isBot: true },
    })
  } catch (err) {
    // Failure to hydrate is non-fatal — the frontend has a userId-slice
    // fallback. Log and return tables unchanged.
    logger.warn({ err: err.message }, 'withSeatDisplay(): user hydration failed; returning unenriched seats')
    return input
  }

  const byBaId = new Map(users.map(u => [u.betterAuthId, u]))
  const enriched = tables.map(t => {
    if (!Array.isArray(t?.seats)) return t
    return {
      ...t,
      seats: t.seats.map(s => {
        if (s?.status !== 'occupied' || typeof s.userId !== 'string') return s
        const u = byBaId.get(s.userId)
        if (!u) return s
        return { ...s, displayName: u.displayName, avatarUrl: u.avatarUrl, isBot: u.isBot }
      }),
    }
  })

  return Array.isArray(input) ? enriched : enriched[0]
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

    // Every table gets a mountain-name slug + displayName. The slug is the
    // room key the socket layer uses for room:join — without it GameView
    // falls through useGameSDK's `else` branch and emits room:create instead
    // of attaching, so each player ends up in their own phantom room.
    const name = mountainPool.acquire()
    if (!name) return res.status(503).json({ error: 'No mountain names available' })
    const slug = MountainNamePool.toSlug(name)
    const displayName = `Mt. ${name}`

    const table = await db.table.create({
      data: {
        gameId,
        slug,
        displayName,
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
 *   default (guest)     — public only (isPrivate=false), ordered newest first
 *   default (authed)    — public PLUS the caller's own private tables, so
 *                         a user can see every table they created without
 *                         having to toggle a filter. Other users' private
 *                         tables stay hidden.
 *   ?mine=true          — tables created by the caller (private + public only)
 *   ?status=…           — FORMING / ACTIVE / COMPLETED; comma-separate to combine
 *                         (e.g. ?status=FORMING,ACTIVE). Unknown values ignored.
 *   ?gameId=…           — filter by game
 *   ?search=…           — tables with a seated player whose displayName matches
 *                         (case-insensitive partial); returns empty if nobody matches
 *   ?since=ISO          — only tables created on/after this timestamp
 *   ?limit=N            — page size (default 20, max 200)
 *   ?page=N             — 1-based page number (default 1)
 *
 * Returns `{ tables, total, page, limit }`. `total` is the full filtered
 * count so the client can render pagination controls.
 *
 * Other users' private tables are never listed; they're accessible only by
 * direct URL via GET /api/v1/tables/:id (share-link mechanism).
 */
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { mine, status, gameId, search, since } = req.query
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 200)
    const page  = Math.max(1, parseInt(req.query.page, 10) || 1)
    const skip  = (page - 1) * limit

    // Visibility clause — mutually exclusive shapes for the three caller modes.
    let visibility
    if (mine === 'true') {
      if (!req.auth?.userId) return res.status(401).json({ error: 'Auth required for ?mine=true' })
      visibility = { createdById: req.auth.userId }
    } else if (req.auth?.userId) {
      visibility = { OR: [{ isPrivate: false }, { createdById: req.auth.userId }] }
    } else {
      visibility = { isPrivate: false }
    }

    const conditions = [visibility]

    if (typeof status === 'string' && status.length > 0) {
      const valid = new Set(['FORMING', 'ACTIVE', 'COMPLETED'])
      const statuses = status.split(',').map(s => s.trim().toUpperCase()).filter(s => valid.has(s))
      if (statuses.length === 1) conditions.push({ status: statuses[0] })
      else if (statuses.length > 1) conditions.push({ status: { in: statuses } })
    }

    if (gameId && typeof gameId === 'string') conditions.push({ gameId })

    if (typeof since === 'string' && since.length > 0) {
      const d = new Date(since)
      if (!Number.isNaN(d.getTime())) conditions.push({ createdAt: { gte: d } })
    }

    // Search by seated player displayName. Two-step: find matching users, then
    // filter tables whose seats JSON contains any of their betterAuthIds. If
    // no user matches we can short-circuit with an empty result (skip the
    // table query entirely).
    if (typeof search === 'string' && search.trim().length > 0) {
      const term = search.trim()
      const matchedUsers = await db.user.findMany({
        where:  { displayName: { contains: term, mode: 'insensitive' } },
        select: { betterAuthId: true },
        take:   200,
      })
      const baIds = matchedUsers.map(u => u.betterAuthId).filter(Boolean)
      if (baIds.length === 0) {
        return res.json({ tables: [], total: 0, page, limit })
      }
      conditions.push({
        OR: baIds.map(id => ({
          seats: { array_contains: [{ userId: id, status: 'occupied' }] },
        })),
      })
    }

    // Keep the simple-where shape (`{ isPrivate: false }`) when nothing else
    // is applied — preserves existing test assertions and is easier to read
    // in logs.
    const where = conditions.length === 1 ? conditions[0] : { AND: conditions }

    const [tables, total] = await Promise.all([
      db.table.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      db.table.count({ where }),
    ])

    res.json({ tables: await withSeatDisplay(tables), total, page, limit })
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
    res.json({ table: await withSeatDisplay(table) })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/v1/tables/:id/join
 * Claim an empty seat at the table.
 *
 * Body (optional): { seatIndex: number } — take that specific seat. Returns
 * 409 if the requested seat is already occupied or out of range. When
 * seatIndex is omitted, the first empty seat is used.
 *
 * Idempotent: if the caller is already seated, returns 200 with the unchanged
 * table (even if the caller requested a different seat — use leave + join to
 * change seats). Returns 409 when the table is full or its status is not
 * FORMING.
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
    if (userSeatIndex(table.seats, req.auth.userId) !== -1) {
      return res.json({ table: await withSeatDisplay(table), seated: true })
    }

    // Resolve target seat: explicit seatIndex from body, else first empty.
    const { seatIndex } = req.body ?? {}
    let idx
    if (seatIndex !== undefined && seatIndex !== null) {
      if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= table.maxPlayers) {
        return res.status(400).json({ error: 'seatIndex out of range' })
      }
      if (table.seats[seatIndex].status !== 'empty') {
        return res.status(409).json({ error: 'Seat is already occupied' })
      }
      idx = seatIndex
    } else {
      idx = firstEmptySeatIndex(table.seats)
      if (idx === -1) return res.status(409).json({ error: 'Table is full' })
    }

    // Build a fresh seats array — never mutate the value returned from findUnique.
    const seats = table.seats.map((s, i) =>
      i === idx ? { userId: req.auth.userId, status: 'occupied' } : s
    )

    // If this join fills the last seat, auto-transition FORMING → ACTIVE and
    // initialize the game's previewState. Seat 0 plays X, seat 1 plays O —
    // matches the PvP convention used by the realtime room:join handler so
    // both entry points produce identical game state for the same seating.
    const nowFull = seats.every(s => s.status === 'occupied')
    const updateData = { seats }
    let autoStarted = false
    if (nowFull) {
      const marks = {}
      seats.forEach((s, i) => { marks[s.userId] = i === 0 ? 'X' : 'O' })
      updateData.status = 'ACTIVE'
      updateData.previewState = {
        board:       Array(table.maxPlayers >= 2 ? 9 : 9).fill(null),  // XO board — swap when other games land
        currentTurn: 'X',
        scores:      { X: 0, O: 0 },
        round:       1,
        winner:      null,
        winLine:     null,
        marks,
        botMark:     null,  // PvP, not HvB
        moves:       [],
      }
      autoStarted = true
    }

    const updated = await db.table.update({
      where: { id: table.id },
      data:  updateData,
    })

    // Broadcast so every open view of the table — the detail page, the list
    // page's seat strip, a second tab of the joiner, signed-out spectators —
    // all see the seat change without refresh. The payload also carries
    // stakeholders + actorDisplayName so AppLayout can surface a friendly
    // notification to the creator and co-seated players only.
    const joinPayload = await buildSeatChangePayload({
      table,
      updatedSeats: seats,
      actorBaId:    req.auth.userId,
      seatIndex:    idx,
    })
    dispatch({
      type: 'player.joined',
      targets: { broadcast: true },
      payload: joinPayload,
    }).catch(err => logger.warn({ err: err.message, tableId: table.id }, 'player.joined dispatch failed'))

    // Separate event so the client can tell "seat fill" from "game begins" —
    // the Tables list only cares about seat changes; the detail page uses
    // table.started as a trigger to render the live board.
    if (autoStarted) {
      dispatch({
        type: 'table.started',
        targets: { broadcast: true },
        payload: { tableId: updated.id, slug: updated.slug, gameId: updated.gameId },
      }).catch(err => logger.warn({ err: err.message, tableId: updated.id }, 'table.started dispatch failed'))
    }

    res.json({ table: await withSeatDisplay(updated), seated: true })
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
    if (idx === -1) return res.json({ table: await withSeatDisplay(table), seated: false })

    // Fresh array — never mutate the findUnique result.
    const seats = table.seats.map((s, i) =>
      i === idx ? { userId: null, status: 'empty' } : s
    )

    const updated = await db.table.update({
      where: { id: table.id },
      data: { seats },
    })

    // Broadcast every leave so other open pages (list + detail, other tabs)
    // re-fetch. Mirrors player.joined — payload includes stakeholders +
    // actorDisplayName so only creator + remaining-seated get a notification.
    const leavePayload = await buildSeatChangePayload({
      table,
      updatedSeats: seats,
      actorBaId:    req.auth.userId,
      seatIndex:    idx,
    })
    dispatch({
      type: 'player.left',
      targets: { broadcast: true },
      payload: leavePayload,
    }).catch(err => logger.warn({ err: err.message, tableId: table.id }, 'player.left dispatch failed'))

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

    res.json({ table: await withSeatDisplay(updated), seated: false })
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /api/v1/tables/:id
 * Delete a table. Only the creator may delete it.
 *
 * Allowed when status is FORMING or COMPLETED. Disallowed mid-game (ACTIVE)
 * to prevent yanking a live session out from under seated players.
 *
 * Tournament-generated tables (isTournament=true) can only be deleted by
 * admins — the tournament service created them, not the user.
 *
 * Fires `table.deleted` on the bus (broadcast) so the Tables list and any
 * open detail views can react in real time.
 */
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const table = await db.table.findUnique({ where: { id: req.params.id } })
    if (!table) return res.status(404).json({ error: 'Table not found' })

    if (table.createdById !== req.auth.userId) {
      return res.status(403).json({ error: 'Only the creator can delete this table' })
    }
    if (table.isTournament) {
      return res.status(403).json({ error: 'Tournament tables cannot be deleted manually' })
    }
    if (table.status === 'ACTIVE') {
      return res.status(409).json({ error: 'Cannot delete an active table. Wait for the game to finish.' })
    }

    await db.table.delete({ where: { id: table.id } })

    dispatch({
      type: 'table.deleted',
      targets: { broadcast: true },
      payload: { tableId: table.id, gameId: table.gameId },
    }).catch(err => logger.warn({ err: err.message, tableId: table.id }, 'table.deleted dispatch failed'))

    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

export default router
