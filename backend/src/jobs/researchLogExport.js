// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Nightly research-log export job — Sprint 3 of doc/Research_Log_Plan.md §3.
 *
 * Walks TrainingSessionNote + ResearchLogEntry and rebuilds the flat
 * `research_log_exports` table via truncate-and-insert in a single
 * transaction. Source-of-truth rows stay in their original tables; this
 * table is disposable and is used only by downstream analytics + the
 * Sprint-5+ reranker training feed.
 *
 * Why truncate-and-insert vs. incremental upsert:
 *   - Idempotent. Re-running mid-day is safe — state is fully recomputed.
 *   - No tombstone tracking. Deleted notes/entries vanish on the next run
 *     without a soft-delete column or a tombstone table.
 *   - Tiny enough to be cheap. Even at 100k notes per cohort the rebuild
 *     is sub-second on PG.
 *
 * Scheduling: an hourly setInterval gated on `now.getUTCHours() === 3`
 * with a per-UTC-day idempotency key. Mirrors the `metricsSnapshot`
 * cron pattern — admin can also call `runResearchLogExport()` directly
 * if they need an ad-hoc refresh.
 */

import db from '../lib/db.js'
import logger from '../logger.js'

const TARGET_UTC_HOUR = 3
const HOURLY_MS = 60 * 60 * 1000

let _started = false
let _lastRunDate = null   // 'YYYY-MM-DD' UTC

/**
 * Build the flat row shape for a TrainingSessionNote.
 * The exported id is prefixed by `note:` so it can't collide with an
 * entry id (cuid()s are globally unique by construction, but the prefix
 * also makes the row hand-greppable in raw queries).
 */
function noteToRow(n) {
  return {
    id:                  `note:${n.id}`,
    type:                'note',
    userId:              n.userId,
    body:                n.body,
    outcome:             n.outcome,
    title:               null,
    category:            null,
    tags:                Array.isArray(n.tags) ? n.tags : [],
    sharedWithCommunity: !!n.sharedWithCommunity,
    publishedAt:         n.publishedAt ?? null,
    helpDocId:           n.helpDocId ?? null,
    sourceCreatedAt:     n.createdAt,
    sourceUpdatedAt:     n.updatedAt,
  }
}

function entryToRow(e) {
  return {
    id:                  `entry:${e.id}`,
    type:                'entry',
    userId:              e.userId,
    body:                e.body,
    outcome:             null,
    title:               e.title,
    category:            e.category,
    tags:                Array.isArray(e.tags) ? e.tags : [],
    sharedWithCommunity: !!e.sharedWithCommunity,
    publishedAt:         e.publishedAt ?? null,
    helpDocId:           e.helpDocId ?? null,
    sourceCreatedAt:     e.createdAt,
    sourceUpdatedAt:     e.updatedAt,
  }
}

/**
 * Run the export. Returns `{ noteCount, entryCount, totalCount, elapsedMs }`.
 * Wrapped in a single transaction so a partial run can never leave the
 * table half-truncated.
 */
export async function runResearchLogExport() {
  const t0 = Date.now()
  const [notes, entries] = await Promise.all([
    db.trainingSessionNote.findMany(),
    db.researchLogEntry.findMany(),
  ])
  const rows = [...notes.map(noteToRow), ...entries.map(entryToRow)]

  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('TRUNCATE TABLE "research_log_exports"')
    if (rows.length > 0) {
      // createMany is the right primitive here — one INSERT per chunk of
      // ~1k rows, no per-row roundtrip. Prisma will batch under the hood.
      await tx.researchLogExport.createMany({ data: rows })
    }
  })

  const elapsedMs = Date.now() - t0
  logger.info(
    { noteCount: notes.length, entryCount: entries.length, totalCount: rows.length, elapsedMs },
    'researchLogExport: rebuild complete',
  )
  return {
    noteCount:  notes.length,
    entryCount: entries.length,
    totalCount: rows.length,
    elapsedMs,
  }
}

function utcDateKey(d = new Date()) {
  return d.toISOString().slice(0, 10) // 'YYYY-MM-DD'
}

/**
 * Hourly poll. Fires the export when:
 *   1. Current UTC hour matches TARGET_UTC_HOUR (default 03:00), AND
 *   2. The export has not already run for today's UTC date.
 *
 * The per-day key is in-memory; restart-during-the-day will re-run the
 * export, which is fine (it's idempotent).
 */
async function tick({ _now = () => new Date() } = {}) {
  const now = _now()
  const date = utcDateKey(now)
  if (now.getUTCHours() !== TARGET_UTC_HOUR) return { skipped: 'wrong_hour' }
  if (_lastRunDate === date) return { skipped: 'already_ran_today' }
  try {
    const result = await runResearchLogExport()
    _lastRunDate = date
    return { ran: true, ...result }
  } catch (err) {
    logger.warn({ err: err.message }, 'researchLogExport: tick failed (will retry next hour)')
    return { skipped: 'error', err: err.message }
  }
}

/**
 * Idempotent. Safe to call from server startup.
 */
export function startResearchLogExportCron(opts = {}) {
  if (_started) return
  _started = true
  // Initial tick at boot so a restart inside the 03:00 hour still fires.
  tick(opts).catch(() => {})
  const id = setInterval(() => { tick(opts).catch(() => {}) }, HOURLY_MS)
  if (id.unref) id.unref()
  logger.info({ targetHour: TARGET_UTC_HOUR }, 'researchLogExport: cron started')
  return id
}

// Test helpers — reset module-level state.
export function _resetResearchLogExportState() {
  _started = false
  _lastRunDate = null
}
export function _tickForTest(opts) {
  return tick(opts)
}
