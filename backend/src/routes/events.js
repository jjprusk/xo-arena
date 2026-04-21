// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Tier 2 event replay.
 *
 *   GET /api/v1/events/replay?since=<streamId>&limit=<n>
 *
 * Returns events appended to the Redis replay stream after `since`. Filters
 * by the requesting user: broadcast entries (userId='*') always pass;
 * personal entries only pass for their owner.
 *
 * Stream is written by:
 *   - tournament/src/lib/redis.js::publish()        (all tournament broadcasts)
 *   - backend/src/lib/notificationBus.js::dispatch() (guide notifications)
 *   - backend/src/realtime/socketHandler.js         (tournament:match:score)
 *
 * Clients use this endpoint on SSE reconnect (Last-Event-ID replay) or when
 * the tab regains focus after being hidden.
 */
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { readStream } from '../lib/eventStream.js'
import * as sseBroker from '../lib/sseBroker.js'
import { auth } from '../lib/auth.js'
import db from '../lib/db.js'
import logger from '../logger.js'

// Cookie-based auth for the SSE endpoint. Browsers don't let EventSource send
// custom headers, so Bearer-only auth is unusable here. We read the BA session
// cookie via auth.api.getSession() — same path Better Auth uses everywhere
// else, so it honors session expiry, banned users, etc.
async function requireSessionCookie(req, res, next) {
  try {
    const session = await auth.api.getSession({ headers: req.headers })
    if (!session?.user?.id) {
      logger.warn({ url: req.url, hasCookie: !!req.headers.cookie }, 'SSE stream: 401 (no session)')
      return res.status(401).json({ error: 'Authentication required' })
    }
    logger.info({ url: req.url, userId: session.user.id }, 'SSE stream: auth ok')
    // Keep req.auth shape consistent with requireAuth so downstream code
    // (readStream, user lookups) is interchangeable.
    req.auth = { userId: session.user.id }
    next()
  } catch (err) {
    logger.warn({ err: err.message }, 'SSE cookie auth failed')
    return res.status(401).json({ error: 'Authentication required' })
  }
}

const router = Router()

// Per-user SSE cap. Each page opens 2 streams (guide+presence in AppLayout,
// tournament: on Tournaments/TournamentDetail), and a refresh briefly
// overlaps the old tab's connections with the new before close events
// settle. We need ≥ 4 to survive a reload flap without 429'ing the new tab,
// and enough room on top for two genuinely-open tabs. Effective ceiling is
// still bounded by the browser's own per-origin connection cap (~6).
const SSE_MAX_CONNECTIONS_PER_USER = 8
const SSE_HEARTBEAT_MS             = 30_000

// GET /api/v1/events/replay?since=<streamId>&limit=<n>
router.get('/replay', requireAuth, async (req, res, next) => {
  try {
    const since = typeof req.query.since === 'string' && req.query.since.length
      ? req.query.since : null
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 1000)

    // Resolve the domain User.id from the BA user id stored in req.auth.userId.
    // Events are stored with the domain User.id because that's what callers have
    // at append time (e.g. notificationBus dispatches to userId which is domain).
    const appUser = await db.user.findUnique({
      where: { betterAuthId: req.auth.userId },
      select: { id: true },
    })
    const userId = appUser?.id ?? null

    const { events, latestId } = await readStream(since, { limit, userId })
    res.json({ events, latestId })
  } catch (e) {
    logger.error({ err: e }, '/events/replay failed')
    next(e)
  }
})

// GET /api/v1/events/stream
//
// Long-lived SSE connection. Streams Tier 2 events to the client in real time.
// On reconnect, pass Last-Event-ID (EventSource sends this automatically, or
// client can pass ?lastEventId=...) to replay missed events.
//
// Query params:
//   channels=tournament:,guide:   comma-separated channel prefixes to filter
//                                 by. Empty/missing = receive all.
//
// Response framing:
//   retry: 2000              suggest 2s reconnect delay
//   id: <streamId>           monotonic Redis stream id per event
//   event: <channel>         e.g. 'tournament:started'
//   data: <json payload>
//   (comment heartbeats every 30s keep proxies from closing idle connections)
router.get('/stream', requireSessionCookie, async (req, res) => {
  const appUser = await db.user.findUnique({
    where: { betterAuthId: req.auth.userId },
    select: { id: true },
  })
  const userId = appUser?.id ?? null

  // Per-user connection cap — prevents a runaway tab from exhausting connections.
  if (userId && sseBroker.clientCountForUser(userId) >= SSE_MAX_CONNECTIONS_PER_USER) {
    return res.status(429).json({ error: 'Too many SSE connections for this user' })
  }

  const channels = typeof req.query.channels === 'string' && req.query.channels.length
    ? req.query.channels.split(',').map(s => s.trim()).filter(Boolean)
    : []

  const lastEventId = req.headers['last-event-id']
    ?? (typeof req.query.lastEventId === 'string' ? req.query.lastEventId : null)

  // SSE response headers. X-Accel-Buffering:no is critical — nginx and the
  // landing express proxy both buffer by default, which turns a stream into
  // "nothing, nothing, nothing, giant blast". no-transform stops compression
  // middleware from chunking.
  res.writeHead(200, {
    'Content-Type':      'text/event-stream; charset=utf-8',
    'Cache-Control':     'no-cache, no-transform',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders?.()
  // Suggest a 2s client reconnect delay. Browsers default to 3s otherwise.
  res.write('retry: 2000\n\n')

  // Replay missed events for Last-Event-ID reconnects. Bounded at 500 to
  // avoid a runaway replay for long-offline clients — they'll need a full
  // REST resync beyond that horizon.
  if (lastEventId) {
    try {
      const { events } = await readStream(lastEventId, { limit: 500, userId })
      for (const ev of events) {
        // Apply the same channel-prefix filter used for live dispatch.
        if (channels.length > 0 && !channels.some(p => ev.channel.startsWith(p))) continue
        res.write(`id: ${ev.id}\n`)
        res.write(`event: ${ev.channel}\n`)
        res.write(`data: ${JSON.stringify(ev.payload)}\n\n`)
      }
    } catch (err) {
      logger.warn({ err, lastEventId }, '/events/stream replay failed (continuing live)')
    }
  }

  // Register for live events.
  sseBroker.register(res, { userId, channels })

  // Heartbeat — SSE comment line every 30s. Without this, idle proxies drop
  // the connection after ~60s of silence.
  const heartbeat = setInterval(() => {
    try { res.write(`: heartbeat ${Date.now()}\n\n`) } catch {}
  }, SSE_HEARTBEAT_MS)

  // Cleanup on client disconnect (tab closed, navigation, network drop).
  req.on('close', () => {
    clearInterval(heartbeat)
    sseBroker.unregister(res)
  })
})

export default router
