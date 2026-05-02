// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Belt-and-suspenders janitor for `isTest=true` tournament_templates and
 * tournaments that outlived their owning test run.
 *
 * The first line of defence is the test-suite cleanup helper
 * (e2e/tests/dbScript.js). The scheduler skip-isTest guard
 * (recurringScheduler.js — `includeTest=false` on the background sweep)
 * keeps a leaked template from driving load. This janitor closes the
 * loop: any test row whose `updatedAt` is older than the TTL gets GC'd
 * so the DB doesn't accumulate cruft from crashed specs (Ctrl-C,
 * machine reboot, OOM) that never reached their `afterAll` hook.
 *
 * Cascade-aware delete order:
 *   1. Tournament-side children that don't have onDelete:Cascade (Game,
 *      Table, MeritTransaction, ClassificationHistory) — explicitly null/
 *      delete first, otherwise the tournament delete fails on FK.
 *   2. Tournament rows (cascade handles participants / rounds / matches /
 *      seedBots / autoDrops by virtue of their tournamentId Cascade FKs).
 *   3. Template rows (cascade handles seedBots / registrations).
 */

import db from './db.js'
import logger from '../logger.js'

const TEST_ROW_TTL_MS = 24 * 60 * 60 * 1000  // 24h after last update → eligible

/**
 * One-shot sweep. Returns counts for logging / tests.
 * Always resolves; per-step failures log and skip the rest of that step.
 */
export async function sweepStaleTestRows(now = new Date()) {
  const cutoff = new Date(now.getTime() - TEST_ROW_TTL_MS)
  const counts = { tournaments: 0, templates: 0, games: 0, tables: 0 }

  // Stage 1: tournaments
  try {
    const stale = await db.tournament.findMany({
      where:  { isTest: true, updatedAt: { lt: cutoff } },
      select: { id: true },
    })
    if (stale.length > 0) {
      const ids = stale.map(t => t.id)

      // Game has tournamentId without Cascade — delete first.
      const g = await db.game.deleteMany({ where: { tournamentId: { in: ids } } })
      counts.games = g.count

      // Table has tournamentId without Cascade — delete first. (Test tables
      // are private to the spec; safe to drop alongside the tournament.)
      const tbl = await db.table.deleteMany({ where: { tournamentId: { in: ids } } })
      counts.tables = tbl.count

      // MeritTransaction / ClassificationHistory keep tournamentId nullable —
      // null it out instead of deleting (audit trail intact, FK satisfied).
      await db.meritTransaction.updateMany({
        where: { tournamentId: { in: ids } },
        data:  { tournamentId: null },
      }).catch(() => {})
      await db.classificationHistory.updateMany({
        where: { tournamentId: { in: ids } },
        data:  { tournamentId: null },
      }).catch(() => {})

      const t = await db.tournament.deleteMany({ where: { id: { in: ids } } })
      counts.tournaments = t.count
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Test janitor — tournament sweep failed')
  }

  // Stage 2: templates. Template→Tournament FK is SetNull, so a template
  // delete won't drop occurrences — those are handled in stage 1 via the
  // isTest filter. Cascade on TournamentTemplateSeedBot / RecurringTournament-
  // Registration handles the template's own children.
  try {
    const r = await db.tournamentTemplate.deleteMany({
      where: { isTest: true, updatedAt: { lt: cutoff } },
    })
    counts.templates = r.count
  } catch (err) {
    logger.warn({ err: err.message }, 'Test janitor — template sweep failed')
  }

  if (counts.tournaments + counts.templates > 0) {
    logger.info(counts, 'Test janitor — pruned stale isTest rows')
  }
  return counts
}
