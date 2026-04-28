// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * tableService — transport-agnostic table operations.
 *
 * Phase 1 of the Realtime Migration (Realtime_Migration_Plan.md) introduces
 * `handleIdlePong` here so the legacy socket.io handler and the new
 * `/api/v1/rt/tables/:slug/idle/pong` POST route share a single source of
 * truth.
 *
 * Subsequent phases will move more table flow (move, forfeit, watch, …)
 * into this module so socket.io and SSE+POST are equivalent client-driven
 * transports rather than two parallel implementations.
 */
import db from '../lib/db.js'
import { resetIdleForUserInTable } from '../realtime/socketHandler.js'
import logger from '../logger.js'

/**
 * Resolve a table by slug, then reset its idle timer for the given user.
 *
 * Returns the same shape as `resetIdleForUserInTable`, plus `tableId` on
 * success so callers can log it.
 */
export async function handleIdlePong({ io, userId, slug }) {
  if (!userId || !slug) return { ok: false, reason: 'bad-request' }

  const table = await db.table.findUnique({
    where:  { slug },
    select: { id: true, status: true },
  })
  if (!table) return { ok: false, reason: 'not-found' }

  const result = await resetIdleForUserInTable(io, userId, table.id)
  if (!result.ok) return result
  return { ok: true, tableId: table.id, isPlayer: result.isPlayer }
}
