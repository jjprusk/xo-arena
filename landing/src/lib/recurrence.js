// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Pure recurrence math for the admin schedule preview.
 *
 * Mirrors `tournament/src/lib/recurringScheduler.js` advanceOne: DAILY = +24h,
 * WEEKLY = +7d, MONTHLY = setMonth(+1). Kept inline (instead of shared) since
 * the tournament service ships in its own container and the landing app
 * doesn't import from it.
 */

const DAY_MS  = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS

export function advanceOne(date, interval) {
  const d = new Date(date)
  switch (interval) {
    case 'DAILY':   return new Date(d.getTime() + DAY_MS)
    case 'WEEKLY':  return new Date(d.getTime() + WEEK_MS)
    case 'MONTHLY': { const c = new Date(d); c.setMonth(c.getMonth() + 1); return c }
    default:        return null
  }
}

/**
 * Compute the next `count` occurrences strictly after `now`, honoring
 * end-date and paused. Returns Date[] of length 0..count.
 *
 * - paused → []
 * - end-date in the past → []
 * - recurrenceStart in the future → starts from recurrenceStart
 * - recurrenceStart in the past → walks forward until > now
 */
export function nextOccurrences({
  recurrenceStart,
  recurrenceInterval,
  recurrenceEndDate = null,
  paused = false,
  now = new Date(),
  count = 5,
}) {
  if (paused) return []
  if (!recurrenceStart || !recurrenceInterval) return []
  const start = new Date(recurrenceStart)
  if (Number.isNaN(start.getTime())) return []
  const end = recurrenceEndDate ? new Date(recurrenceEndDate) : null
  if (end && end < now) return []

  let cursor = start
  // Fast-forward past `now` so the first emitted date is in the future.
  let guard = 0
  while (cursor <= now && guard < 100_000) {
    const next = advanceOne(cursor, recurrenceInterval)
    if (!next) return []
    cursor = next
    guard++
  }

  const out = []
  while (out.length < count) {
    if (end && cursor > end) break
    out.push(cursor)
    const next = advanceOne(cursor, recurrenceInterval)
    if (!next) break
    cursor = next
  }
  return out
}
