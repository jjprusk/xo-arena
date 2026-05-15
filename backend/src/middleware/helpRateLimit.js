// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Help System rate limiter (Sprint 2 §2.5).
 *
 * Enforces two per-user windows on `POST /api/v1/help/ask`:
 *   - 5 requests per rolling 60 seconds  (burst)
 *   - 50 requests per rolling 24 hours   (daily cap)
 *
 * In-process state — one Map keyed by userId, each value is a pair of
 * timestamp arrays. We prune-then-check-then-record on every request. A
 * background sweep drops users whose daily window has gone empty so the
 * Map stays bounded under churn.
 *
 * 429 response shape per the §2.5 spec:
 *   { error: 'rate_limited', retryAfter: <seconds> }
 *
 * The provider-side 429 (OpenAI spend cap / RPM) is distinct from this
 * limiter — that one is emitted as an SSE `error` frame with
 * `source: 'provider'` inside `helpService.ask`. The app-level limiter
 * here returns the 429 before the SSE handshake even opens, so the UI
 * can render a clean inline message without an EventSource open/close
 * flicker.
 *
 * CLI bypass: requests authed via `X-Internal-Secret` (`req.auth.cliBypass`)
 * skip the limiter entirely — CLI traffic is for dev/admin debugging and
 * has no user identity to key off of.
 *
 * Clock injection: `_now` lets tests advance through windows deterministically
 * without `vi.useFakeTimers` (which interacts badly with async generators).
 */

const MINUTE_WINDOW_MS = 60 * 1000
const DAY_WINDOW_MS    = 24 * 60 * 60 * 1000

export const HELP_PER_MINUTE_LIMIT = 5
export const HELP_PER_DAY_LIMIT    = 50

// userId → { minute: number[], day: number[] }
// Each array holds request timestamps (ms). Pruned in-place on read.
const _buckets = new Map()

// Periodic sweep: every 5 minutes, drop users whose day-window is empty
// after a fresh prune. Keeps memory bounded — without this, an attacker
// could rotate userIds to grow the Map. Unref'd so it doesn't block exit.
const SWEEP_INTERVAL_MS = 5 * 60 * 1000
let _sweepTimer = null

function pruneArray(arr, cutoff) {
  // Most timestamps stay within the window for steady traffic; a single
  // splice off the front is cheaper than rebuilding. We splice once for
  // the contiguous prefix of expired entries.
  let i = 0
  while (i < arr.length && arr[i] <= cutoff) i++
  if (i > 0) arr.splice(0, i)
}

function pruneBucket(bucket, now) {
  pruneArray(bucket.minute, now - MINUTE_WINDOW_MS)
  pruneArray(bucket.day,    now - DAY_WINDOW_MS)
}

/**
 * Express middleware. Must run AFTER auth (needs `req.auth.userId`).
 *
 *   app.post('/ask', requireAuthOrInternalSecret, helpRateLimit(), ...)
 *
 * @param {object} [opts]
 * @param {() => number} [opts._now]  test seam — defaults to Date.now
 */
export function helpRateLimit(opts = {}) {
  const now = opts._now ?? Date.now

  return function helpRateLimitMiddleware(req, res, next) {
    // CLI bypass requests carry no real user — skip the limiter.
    if (req.auth?.cliBypass) return next()

    const userId = req.auth?.userId
    if (!userId) {
      // Defensive: this middleware is wired after the auth guard, so we
      // should never reach here with a missing userId. If we do, the auth
      // guard should have already 401'd; fall through to the next handler
      // and let the route's auth layer handle the rejection.
      return next()
    }

    const t = now()
    let bucket = _buckets.get(userId)
    if (!bucket) {
      bucket = { minute: [], day: [] }
      _buckets.set(userId, bucket)
    }
    pruneBucket(bucket, t)

    // Check daily cap first — it's the broader gate, and the retryAfter
    // hint is more useful (60s for minute breaches vs hours for day).
    if (bucket.day.length >= HELP_PER_DAY_LIMIT) {
      const oldest = bucket.day[0]
      const retryAfter = Math.max(1, Math.ceil((oldest + DAY_WINDOW_MS - t) / 1000))
      res.setHeader('Retry-After', String(retryAfter))
      return res.status(429).json({
        error: 'rate_limited',
        retryAfter,
        scope: 'day',
      })
    }
    if (bucket.minute.length >= HELP_PER_MINUTE_LIMIT) {
      const oldest = bucket.minute[0]
      const retryAfter = Math.max(1, Math.ceil((oldest + MINUTE_WINDOW_MS - t) / 1000))
      res.setHeader('Retry-After', String(retryAfter))
      return res.status(429).json({
        error: 'rate_limited',
        retryAfter,
        scope: 'minute',
      })
    }

    // Record the hit.
    bucket.minute.push(t)
    bucket.day.push(t)
    return next()
  }
}

/** Test helper — reset all buckets between tests. */
export function _resetHelpRateLimitState() {
  _buckets.clear()
}

/** Test helper — inspect the bucket for a userId (returns null if absent). */
export function _peekHelpRateLimitBucket(userId) {
  const b = _buckets.get(userId)
  return b ? { minute: [...b.minute], day: [...b.day] } : null
}

/**
 * Start the periodic sweep. Idempotent — calling more than once is a no-op.
 * Wired from backend boot (index.js); off in tests.
 */
export function startHelpRateLimitSweep(opts = {}) {
  if (_sweepTimer) return _sweepTimer
  const now = opts._now ?? Date.now
  _sweepTimer = setInterval(() => {
    const t = now()
    for (const [userId, bucket] of _buckets) {
      pruneBucket(bucket, t)
      if (bucket.minute.length === 0 && bucket.day.length === 0) {
        _buckets.delete(userId)
      }
    }
  }, SWEEP_INTERVAL_MS)
  if (_sweepTimer.unref) _sweepTimer.unref()
  return _sweepTimer
}

/** Test helper — stop the sweep so tests don't leak timers. */
export function stopHelpRateLimitSweep() {
  if (_sweepTimer) {
    clearInterval(_sweepTimer)
    _sweepTimer = null
  }
}
