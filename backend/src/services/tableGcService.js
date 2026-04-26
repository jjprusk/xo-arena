/**
 * Table garbage collection service.
 *
 * Periodically sweeps the `table` table and:
 *  1. Deletes FORMING tables that are empty and older than 30 min
 *     (skips tournament tables — they may be waiting for bridge players).
 *  2. Deletes COMPLETED tables older than 24 hr (results already in Game).
 *  3. Detects ACTIVE tables that have been idle longer than the configured
 *     idle threshold, marks them COMPLETED, and notifies connected sockets.
 *
 * Tunable via SystemConfig keys:
 *   game.idleWarnSeconds   (default 120)
 *   game.idleGraceSeconds  (default  60)
 *
 * Call `start(io)` once at server startup.
 */

import db from '../lib/db.js'
import logger from '../logger.js'
import { getSystemConfig } from './skillService.js'
import { dispatch } from '../lib/notificationBus.js'
import { botGameRunner } from '../realtime/botGameRunner.js'

const SWEEP_INTERVAL_MS = 60_000 // 1 minute

/**
 * Start the background GC sweep.
 * @param {import('socket.io').Server} io
 */
export function start(io) {
  sweep(io) // run once immediately
  setInterval(() => sweep(io), SWEEP_INTERVAL_MS)
  logger.info('Table GC service started (interval: 60s)')
}

/**
 * Single GC sweep — safe to call at any time.
 */
export async function sweep(io) {
  try {
    const now = new Date()

    const [deletedForming, deletedCompleted, abandonedActive, deletedDemos, killedSpars, deletedOldSpars] = await Promise.all([
      deleteStaleForming(now),
      deleteOldCompleted(now),
      abandonIdleActive(now, io),
      sweepDemos(now),
      sweepStaleSpars(),
      deleteOldSparGames(now),
    ])

    if (deletedForming > 0 || deletedCompleted > 0 || abandonedActive > 0 || deletedDemos > 0 || killedSpars > 0 || deletedOldSpars > 0) {
      logger.info(
        { deletedForming, deletedCompleted, abandonedActive, deletedDemos, killedSpars, deletedOldSpars },
        `Table GC: deleted ${deletedForming} forming, ${deletedCompleted} completed, abandoned ${abandonedActive} active, ${deletedDemos} demo, killed ${killedSpars} stuck spars, deleted ${deletedOldSpars} old spar games`,
      )
    }

    return { deletedForming, deletedCompleted, abandonedActive, deletedDemos, killedSpars, deletedOldSpars }
  } catch (err) {
    logger.warn({ err: err.message }, 'Table GC sweep failed')
    return { deletedForming: 0, deletedCompleted: 0, abandonedActive: 0, deletedDemos: 0, killedSpars: 0, deletedOldSpars: 0, error: err.message }
  }
}

// ── 1. Stale FORMING tables ──────────────────────────────────────────

async function deleteStaleForming(now) {
  const cutoff = new Date(now.getTime() - 30 * 60 * 1000) // 30 min ago

  // Prisma can't filter by JSON array contents, so fetch candidates then
  // check seats in JS. Only delete tables where ALL seats are empty —
  // tables with someone seated but no opponent get a longer grace period
  // (the 60-min-with-warning path is a future enhancement).
  const candidates = await db.table.findMany({
    where: {
      status: 'FORMING',
      createdAt: { lt: cutoff },
      tournamentId: null, // never GC tournament tables
    },
    select: { id: true, gameId: true, seats: true },
  })

  const emptyIds = candidates
    .filter(t => Array.isArray(t.seats) && t.seats.every(s => s.status !== 'occupied'))
    .map(t => t.id)

  if (emptyIds.length === 0) return 0

  const { count } = await db.table.deleteMany({ where: { id: { in: emptyIds } } })

  // Fire bus events so the Tables list page reacts in real time
  for (const t of candidates.filter(c => emptyIds.includes(c.id))) {
    dispatch({
      type: 'table.deleted',
      targets: { broadcast: true },
      payload: { tableId: t.id, gameId: t.gameId },
    }).catch(() => {})
  }

  return count
}

// ── 2. Old COMPLETED tables ──────────────────────────────────────────

async function deleteOldCompleted(now) {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000) // 24 hr ago

  const { count } = await db.table.deleteMany({
    where: {
      status: 'COMPLETED',
      updatedAt: { lt: cutoff },
    },
  })

  return count
}

// ── 4. Demo Tables — aggressive GC ───────────────────────────────────
//
// Demo Tables (Hook step 2 §5.1) get three stacked cleanup mechanisms:
//   - 2 min after the bot match completes (status=COMPLETED), delete — short
//     grace lets the user read the result, then it's gone.
//   - 1 hour TTL regardless of state — safety net for orphans (tab closed
//     mid-match, server restart, etc.).
// "One active per user" replacement is handled in POST /tables/demo, not here.

const DEMO_POST_COMPLETE_GRACE_MS = 2 * 60 * 1000          // 2 min (UX, not tunable)
const DEFAULT_DEMO_TTL_MINUTES    = 60                     // Sprint 6 fallback

async function sweepDemos(now) {
  const ttlMinutes      = await getSystemConfig('guide.demo.ttlMinutes', DEFAULT_DEMO_TTL_MINUTES)
  const completedCutoff = new Date(now.getTime() - DEMO_POST_COMPLETE_GRACE_MS)
  const ttlCutoff       = new Date(now.getTime() - ttlMinutes * 60 * 1000)

  // Candidates we'll delete: completed-and-graced OR exceeded TTL.
  const toDelete = await db.table.findMany({
    where: {
      isDemo: true,
      OR: [
        { status: 'COMPLETED', updatedAt: { lt: completedCutoff } },
        { createdAt: { lt: ttlCutoff } },
      ],
    },
    select: { id: true, gameId: true, slug: true, status: true },
  })
  if (toDelete.length === 0) return 0

  // Forcibly close any still-running runner games before removing the row,
  // so spectators don't keep ghost-listening to a slug that no longer maps
  // to a Table.
  for (const t of toDelete) {
    if (t.slug) botGameRunner.closeGameBySlug(t.slug)
  }

  const { count } = await db.table.deleteMany({ where: { id: { in: toDelete.map(t => t.id) } } })

  for (const t of toDelete) {
    dispatch({
      type: 'table.deleted',
      targets: { broadcast: true },
      payload: { tableId: t.id, gameId: t.gameId },
    }).catch(() => {})
  }

  return count
}

// ── 3. Idle ACTIVE tables → COMPLETED ────────────────────────────────

async function abandonIdleActive(now, io) {
  const [warnSec, graceSec] = await Promise.all([
    getSystemConfig('game.idleWarnSeconds', 120),
    getSystemConfig('game.idleGraceSeconds', 60),
  ])
  const idleThresholdMs = (warnSec + graceSec) * 1000
  const cutoff = new Date(now.getTime() - idleThresholdMs)

  // First find the idle tables so we can emit per-table events
  const idleTables = await db.table.findMany({
    where: {
      status: 'ACTIVE',
      updatedAt: { lt: cutoff },
    },
    select: { id: true, gameId: true },
  })

  if (idleTables.length === 0) return 0

  const ids = idleTables.map((t) => t.id)

  // Bulk-update to COMPLETED
  await db.table.updateMany({
    where: { id: { in: ids } },
    data: { status: 'COMPLETED' },
  })

  // Notify connected sockets for each table
  if (io) {
    for (const table of idleTables) {
      io.to(`table:${table.id}`).emit('room:abandoned', { reason: 'idle' })
    }
  }

  return idleTables.length
}

// ── 5. Spar — kill stuck in-flight matches (Intelligent Guide §5.2) ──
//
// Spar games run in BotGameRunner state, with no other timeout. A 2-hour
// in-flight cap catches games whose loop hung (a bot move that never
// resolves, a server crash mid-series). The Game row, if any, remains.

async function sweepStaleSpars() {
  const closed = botGameRunner.sweepStaleSpars(2 * 60 * 60 * 1000)  // 2h
  return closed.length
}

// ── 6. Spar — 30-day retention on persisted Game rows ────────────────
//
// Per §5.2: persisted spar matches (Game.isSpar=true) are kept 30 days for
// "let me see how my last training round did" then cleaned up so the table
// doesn't grow unboundedly. Excluded from ELO already (eloService skips
// isSpar games), so deletion is purely a storage hygiene operation.

const SPAR_RETENTION_MS = 30 * 24 * 60 * 60 * 1000  // 30 days

async function deleteOldSparGames(now) {
  const cutoff = new Date(now.getTime() - SPAR_RETENTION_MS)
  const { count } = await db.game.deleteMany({
    where: {
      isSpar: true,
      endedAt: { lt: cutoff },
    },
  })
  return count
}
