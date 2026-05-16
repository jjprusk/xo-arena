// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Research Log feature-flag helpers. Sprint 2 ships the publish flow
 * behind `SystemConfig.researchLog.publishEnabled` — when the row is
 * absent the flag is OFF (the entire publish surface stays hidden /
 * 503s). Flipping is a one-row SystemConfig upsert, no redeploy.
 *
 * See doc/Research_Log_Plan.md §7 C6.
 */

import db from '../../lib/db.js'

export const PUBLISH_FLAG_KEY = 'researchLog.publishEnabled'

/**
 * Returns `true` only when the SystemConfig row exists and its JSON
 * value evaluates truthy. Absence-of-row === OFF.
 */
export async function isPublishEnabled() {
  const row = await db.systemConfig.findUnique({ where: { key: PUBLISH_FLAG_KEY } })
  if (!row) return false
  const value = row.value
  if (value === true) return true
  if (value === 'true') return true
  if (value && typeof value === 'object' && value.enabled === true) return true
  return false
}
