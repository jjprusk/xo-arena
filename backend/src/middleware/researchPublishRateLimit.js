// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Research-Log publish rate limiter (Sprint 2 §158 / Research_Log_Plan §2.5).
 *
 * Enforces one per-user window on `POST /api/v1/research/(notes|entries)/:id/publish`:
 *   - 50 publishes per rolling 7 days
 *
 * Editing a published note then re-publishing burns a slot — the route is
 * idempotent on the publish side (re-publish refreshes the HelpDoc) but the
 * limiter counts every accepted publish call, so a tight edit→publish loop
 * is bounded.
 *
 * Unpublishing is NOT rate-limited; revoking a share should always be
 * cheap and immediate.
 *
 * Same in-process Map pattern as helpRateLimit.js — one bucket per user,
 * pruned on every request, periodic sweep drops empty buckets.
 *
 * 429 shape:
 *   { error: 'rate_limited', retryAfter: <seconds>, scope: 'week' }
 */

const WEEK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export const RESEARCH_PUBLISH_PER_WEEK_LIMIT = 50

const _buckets = new Map() // userId → number[]  (publish timestamps in ms)

const SWEEP_INTERVAL_MS = 30 * 60 * 1000 // half-hour
let _sweepTimer = null

function pruneArray(arr, cutoff) {
  let i = 0
  while (i < arr.length && arr[i] <= cutoff) i++
  if (i > 0) arr.splice(0, i)
}

/**
 * Express middleware. Must run AFTER auth.
 *
 * @param {object} [opts]
 * @param {() => number} [opts._now]  test seam — defaults to Date.now
 */
export function researchPublishRateLimit(opts = {}) {
  const now = opts._now ?? Date.now

  return function researchPublishRateLimitMiddleware(req, res, next) {
    if (req.auth?.cliBypass) return next()

    const userId = req.auth?.userId
    if (!userId) return next()

    const t = now()
    let bucket = _buckets.get(userId)
    if (!bucket) {
      bucket = []
      _buckets.set(userId, bucket)
    }
    pruneArray(bucket, t - WEEK_WINDOW_MS)

    if (bucket.length >= RESEARCH_PUBLISH_PER_WEEK_LIMIT) {
      const oldest = bucket[0]
      const retryAfter = Math.max(1, Math.ceil((oldest + WEEK_WINDOW_MS - t) / 1000))
      res.setHeader('Retry-After', String(retryAfter))
      return res.status(429).json({
        error:      'rate_limited',
        retryAfter,
        scope:      'week',
        limit:      RESEARCH_PUBLISH_PER_WEEK_LIMIT,
      })
    }

    bucket.push(t)
    return next()
  }
}

export function _resetResearchPublishRateLimitState() {
  _buckets.clear()
}

export function _peekResearchPublishRateLimitBucket(userId) {
  const b = _buckets.get(userId)
  return b ? [...b] : null
}

export function startResearchPublishRateLimitSweep(opts = {}) {
  if (_sweepTimer) return _sweepTimer
  const now = opts._now ?? Date.now
  _sweepTimer = setInterval(() => {
    const t = now()
    for (const [userId, arr] of _buckets) {
      pruneArray(arr, t - WEEK_WINDOW_MS)
      if (arr.length === 0) _buckets.delete(userId)
    }
  }, SWEEP_INTERVAL_MS)
  if (_sweepTimer.unref) _sweepTimer.unref()
  return _sweepTimer
}

export function stopResearchPublishRateLimitSweep() {
  if (_sweepTimer) {
    clearInterval(_sweepTimer)
    _sweepTimer = null
  }
}
