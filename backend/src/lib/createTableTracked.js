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

export async function createTableTracked({ data }) {
  try {
    return await db.table.create({ data })
  } catch (err) {
    incrementTableCreateError(err?.code)
    throw err
  }
}
