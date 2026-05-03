// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Presence REST — authoritative snapshot for the "who's here" UI.
 *
 *   GET /api/v1/presence/tables/:id
 *     Returns current seated players + spectators for a table. This is the
 *     REST counterpart to the socket `table:presence` broadcast; clients
 *     use it on page load and as a backstop when socket events are missed.
 *
 * Private tables are only visible to seated players. Guest spectators
 * (no userId) are included in `spectatingCount` but not in the `spectators`
 * list (no identity to show).
 */
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import db from '../lib/db.js'
import { getPresence } from '../realtime/tablePresence.js'
import { recordHeartbeat, getOnline, getOnlineCount } from '../lib/presenceStore.js'
import { auth } from '../lib/auth.js'
import logger from '../logger.js'

const router = Router()

// Heartbeat tolerates either Bearer auth (fetch) or BA session cookie (SSE
// parity, future web-worker heartbeats). Keeping this dual-mode avoids
// forcing clients to thread tokens through an otherwise trivial POST.
async function requireAuthFlexible(req, res, next) {
  // Try Bearer first (matches requireAuth behavior).
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) {
    return requireAuth(req, res, next)
  }
  // Fall back to BA session cookie.
  try {
    const session = await auth.api.getSession({ headers: req.headers })
    if (!session?.user?.id) return res.status(401).json({ error: 'Authentication required' })
    req.auth = { userId: session.user.id }
    next()
  } catch (err) {
    logger.warn({ err: err.message }, 'presence cookie auth failed')
    return res.status(401).json({ error: 'Authentication required' })
  }
}

// GET /api/v1/presence/tables/:id
router.get('/tables/:id', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params

    const table = await db.table.findUnique({
      where: { id },
      select: { id: true, seats: true, isPrivate: true, status: true },
    })
    if (!table) return res.status(404).json({ error: 'Table not found' })

    // Private-table ACL: only seated players may peek. Spectator socket room
    // is already closed off for private tables; this matches that.
    if (table.isPrivate) {
      const ba = req.auth.userId
      const me = await db.user.findUnique({ where: { betterAuthId: ba }, select: { id: true } })
      const seatedUserIds = (table.seats ?? []).map(s => s.userId).filter(Boolean)
      const isSeated = me?.id ? seatedUserIds.includes(me.id) : false
      if (!isSeated) return res.status(403).json({ error: 'Forbidden' })
    }

    const { count: spectatingCount, userIds: spectatorUserIds } = getPresence(id)

    // Resolve display names for both seated players and spectators in one pass.
    const allIds = [
      ...(table.seats ?? []).map(s => s.userId).filter(Boolean),
      ...spectatorUserIds,
    ]
    const uniqueIds = [...new Set(allIds)]
    const users = uniqueIds.length
      ? await db.user.findMany({
          where: { id: { in: uniqueIds } },
          select: { id: true, displayName: true, isBot: true },
        })
      : []
    const nameOf = Object.fromEntries(users.map(u => [u.id, u]))

    const seats = (table.seats ?? []).map(s => ({
      userId:      s.userId,
      status:      s.status,
      displayName: s.userId ? (nameOf[s.userId]?.displayName ?? s.displayName ?? null) : null,
      isBot:       s.userId ? !!nameOf[s.userId]?.isBot : false,
    }))

    const spectators = spectatorUserIds.map(uid => ({
      userId:      uid,
      displayName: nameOf[uid]?.displayName ?? null,
    }))

    res.json({
      tableId: id,
      status: table.status,
      seats,
      spectators,
      spectatingCount,
    })
  } catch (e) {
    next(e)
  }
})

// POST /api/v1/presence/heartbeat
// Refreshes the caller's presence entry. No body required.
router.post('/heartbeat', requireAuthFlexible, async (req, res, next) => {
  try {
    const ba = req.auth.userId
    // Resolve display info once — presenceStore caches it so /online can
    // return the shape clients expect without an extra join.
    const user = await db.user.findUnique({
      where: { betterAuthId: ba },
      select: { id: true, displayName: true, isBot: true },
    })
    if (!user) return res.status(401).json({ error: 'User not found' })
    const wasNew = recordHeartbeat(user.id, {
      displayName: user.displayName,
      isBot: user.isBot,
    })
    res.json({ ok: true, wasNew, count: getOnlineCount() })
  } catch (e) { next(e) }
})

// GET /api/v1/presence/online
// Returns the current snapshot of heartbeat-backed online users.
router.get('/online', requireAuthFlexible, async (_req, res, next) => {
  try {
    const users = getOnline()
    res.json({ users, count: users.length })
  } catch (e) { next(e) }
})

export default router
