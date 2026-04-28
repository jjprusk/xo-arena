// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Wraps `db.table.create({ data })` with the table-create error counter.
 *
 * Behaviour is otherwise identical: returns the created Table on success,
 * rethrows on failure. Callers that retry on P2002 (slug collision) keep
 * working exactly as before — the counter only observes, it doesn't swallow.
 *
 * The counter is keyed by Prisma error code so the /health/tables dashboard
 * can distinguish a slug-collision burst (P2002) from a genuine schema/FK
 * regression (P2003 or OTHER).
 */

import db from './db.js'
import { incrementTableCreateError } from './resourceCounters.js'
import { getSystemConfig } from '../services/skillService.js'

/**
 * Resolve the realtime transport for a new table.
 *
 * Phase 7a / Risk R7 (Realtime_Migration_Plan.md): a partial gameflow
 * rollout would otherwise let two players land on the same Table over
 * different transports — server emits would only reach one side. Pinning
 * the value at create time eliminates that. Callers that already know the
 * transport (e.g. the SSE+POST `/rt/tables` route) can pass it explicitly
 * via `data.gameflowVia` and skip the SystemConfig read.
 */
async function resolveGameflowVia() {
  const v = await getSystemConfig('realtime.gameflow.via', null).catch(() => null)
  return v === 'sse' ? 'sse' : 'socketio'
}

export async function createTableTracked({ data }) {
  const enriched = data.gameflowVia
    ? data
    : { ...data, gameflowVia: await resolveGameflowVia() }
  try {
    return await db.table.create({ data: enriched })
  } catch (err) {
    incrementTableCreateError(err?.code)
    throw err
  }
}
