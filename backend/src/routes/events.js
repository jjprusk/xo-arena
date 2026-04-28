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
import { nanoid } from 'nanoid'
import { requireAuth } from '../middleware/auth.js'
import { readStream, getStreamTailId } from '../lib/eventStream.js'
import * as sseBroker from '../lib/sseBroker.js'
import * as sseSessions from '../realtime/sseSessions.js'
import { auth } from '../lib/auth.js'
import db from '../lib/db.js'
import logger from '../logger.js'

// Cookie-based auth for the SSE endpoint. Browsers don't let EventSource send
// custom headers, so Bearer-only auth is unusable here. We read the BA session
// cookie via auth.api.getSession() — same path Better Auth uses everywhere
// else, so it honors session expiry, banned users, etc.
//
// Guest play (Phase 7a / Risk R3): if there's no BA session, allow the stream
// to open with `req.auth = null`. The session id minted in the route handler
// is still attached to every `/rt/*` POST, so the client→server attribution
// works the same way for guests as for signed-in users — we just can't filter
// per-user broadcasts to them, which is fine because guests only receive
// table-scoped (`userId: '*'`) events.
async function optionalSessionCookie(req, _res, next) {
  try {
    const session = await auth.api.getSession({ headers: req.headers })
    if (session?.user?.id) {
      logger.info({ url: req.url, userId: session.user.id }, 'SSE stream: auth ok')
      req.auth = { userId: session.user.id }
    } else {
      logger.info({ url: req.url, hasCookie: !!req.headers.cookie }, 'SSE stream: guest connection')
      req.auth = null
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'SSE cookie auth failed — proceeding as guest')
    req.auth = null
  }
  next()
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
router.get('/stream', optionalSessionCookie, async (req, res) => {
  // Guests have `req.auth === null` (see optionalSessionCookie). They get a
  // session id and can subscribe to broadcast channels (`userId: '*'`) but
  // not personal channels — there's no user to filter for.
  const appUser = req.auth?.userId
    ? await db.user.findUnique({
        where:  { betterAuthId: req.auth.userId },
        select: { id: true },
      })
    : null
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

  // Mint an SSE session id and ship it as the first named event. Clients
  // echo this on every /api/v1/rt/* POST via the X-SSE-Session header so the
  // server can attribute the call to a live SSE connection — replaces
  // socket.id for the SSE+POST transport (see Realtime_Migration_Plan.md C1).
  //
  // We also attach an `id:` derived from the current redis stream tail so the
  // client's EventSource stores a Last-Event-ID right away. Without this,
  // a reopen that happens before any real event arrives starts the new
  // connection with no resume cursor, and any event published in the gap
  // (e.g. `guide:journeyStep` fired by a completing POST) is silently lost.
  const sseSessionId = nanoid(16)
  const tailId = await getStreamTailId().catch(() => null)
  if (tailId) res.write(`id: ${tailId}\n`)
  res.write(`event: session\ndata: ${JSON.stringify({ sseSessionId })}\n\n`)
  // Phase 5: when the session truly goes away (3-s debounce expires), drop
  // it from every table presence map it had joined and rebroadcast presence
  // so badge counts settle. The dispatcher fetches latest sessionsModule
  // lazily because tablePresenceService → sseSessions has no inverse import.
  sseSessions.register(sseSessionId, {
    userId,
    res,
    onDispose: async (uid, sid, snapshot = {}) => {
      try {
        const { handleSessionGone } = await import('../services/tablePresenceService.js')
        const dropped = handleSessionGone({ sessionId: sid })
        const io = req.app?.get?.('io') ?? null
        if (dropped.length > 0) {
          const { getPresence } = await import('../realtime/tablePresence.js')
          const { dualEmitPresence } = await import('../services/tablePresenceService.js')
          // The Express app is reachable via req.app — but this callback runs
          // after `req.on('close')`, when the Express request lifecycle is
          // already torn down. Pull the io instance lazily off the request
          // we still hold a reference to (capture it by closure).
          for (const tableId of dropped) {
            dualEmitPresence(io, tableId, getPresence(tableId), 0)
          }
        }
        // Phase 6: tear down any pong rooms this session was in. The runner
        // emits `pong:<slug>:lifecycle` (kind=abandoned) so the surviving
        // participant — on either transport — sees the dropout.
        const pong = await import('../realtime/pongRunner.js')
        pong.removeSocket(sid)
        // Phase 7e: gameplay disconnect-forfeit — for each table this session
        // was seated at, run the FORMING-close / ACTIVE-forfeit-timer / etc.
        // logic that the legacy `socket.on('disconnect')` handler did.
        const tablesGone = Array.isArray(snapshot.joinedTables) ? snapshot.joinedTables : []
        if (tablesGone.length > 0) {
          const { handleDisconnect } = await import('../services/disconnectForfeitService.js')
          await handleDisconnect({ io, userId: uid, sessionId: sid, tablesGone })
        }
      } catch (err) {
        logger.warn({ err: err.message, sessionId: sid }, 'sseSessions onDispose: cleanup failed')
      }
    },
  })

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
  sseBroker.register(res, { userId, sessionId: sseSessionId, channels })

  // Heartbeat — SSE comment line every 30s. Without this, idle proxies drop
  // the connection after ~60s of silence.
  const heartbeat = setInterval(() => {
    try { res.write(`: heartbeat ${Date.now()}\n\n`) } catch {}
  }, SSE_HEARTBEAT_MS)

  // Cleanup on client disconnect (tab closed, navigation, network drop).
  // sseSessions.dispose() is debounced — a tab refresh that reopens within
  // ~3s for the same userId cancels the disposal so transient drops don't
  // trigger forfeits.
  req.on('close', () => {
    clearInterval(heartbeat)
    sseBroker.unregister(res)
    sseSessions.dispose(sseSessionId)
  })
})

export default router
