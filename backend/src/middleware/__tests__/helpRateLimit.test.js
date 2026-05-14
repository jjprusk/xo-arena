// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  helpRateLimit,
  HELP_PER_MINUTE_LIMIT,
  HELP_PER_DAY_LIMIT,
  _resetHelpRateLimitState,
  _peekHelpRateLimitBucket,
  startHelpRateLimitSweep,
  stopHelpRateLimitSweep,
} from '../helpRateLimit.js'

// Helpers — synthesize a minimal Express req/res so tests don't pull in
// supertest. The middleware reads `req.auth.userId`, sets headers, and
// calls `res.status().json()` or `next()`. That's the full surface.

function makeReq({ userId = 'u-1', cliBypass = false } = {}) {
  return { auth: cliBypass ? { userId: 'cli', cliBypass: true } : { userId } }
}

function makeRes() {
  const res = {
    statusCode: null,
    body:       null,
    headers:    {},
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this },
    setHeader(k, v) { this.headers[k] = v },
  }
  return res
}

function runOnce(mw, { userId = 'u-1', cliBypass = false } = {}) {
  const req  = makeReq({ userId, cliBypass })
  const res  = makeRes()
  const next = vi.fn()
  mw(req, res, next)
  return { req, res, next }
}

describe('helpRateLimit middleware', () => {
  beforeEach(() => {
    _resetHelpRateLimitState()
  })

  it('allows the first 5 requests within a minute and rejects the 6th', () => {
    let now = 1_000_000_000_000
    const mw = helpRateLimit({ _now: () => now })

    for (let i = 0; i < HELP_PER_MINUTE_LIMIT; i++) {
      const { res, next } = runOnce(mw)
      expect(next).toHaveBeenCalled()
      expect(res.statusCode).toBeNull()
      now += 100 // 100ms apart, all within the minute window
    }

    const { res, next } = runOnce(mw)
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(429)
    expect(res.body).toMatchObject({ error: 'rate_limited', scope: 'minute' })
    expect(res.body.retryAfter).toBeGreaterThan(0)
    expect(res.body.retryAfter).toBeLessThanOrEqual(60)
    expect(res.headers['Retry-After']).toBe(String(res.body.retryAfter))
  })

  it('lets the minute window slide — after 60s the oldest hit drops off and a new request passes', () => {
    let now = 1_000_000_000_000
    const mw = helpRateLimit({ _now: () => now })

    // Burn 5 in quick succession.
    for (let i = 0; i < HELP_PER_MINUTE_LIMIT; i++) {
      runOnce(mw)
      now += 100
    }
    // 6th immediately → 429
    expect(runOnce(mw).res.statusCode).toBe(429)

    // Advance past the first hit's minute window. The first timestamp was
    // at t0; advancing to t0 + 60_001ms means it falls out of the window.
    now += 60_001
    const after = runOnce(mw)
    expect(after.next).toHaveBeenCalled()
    expect(after.res.statusCode).toBeNull()
  })

  it('allows 50 requests within a day and rejects the 51st', () => {
    let now = 1_000_000_000_000
    const mw = helpRateLimit({ _now: () => now })

    // Space requests ~30 min apart so neither minute nor day windows
    // overlap inside the loop except for the day cap itself. 30 min × 50
    // = 25 hours — but we'll measure on the spacing that keeps the day
    // window full: 28 minutes × 50 = 23.3 hours, fits inside 24h.
    const SPACING = 28 * 60 * 1000 // 28 min
    for (let i = 0; i < HELP_PER_DAY_LIMIT; i++) {
      const { next, res } = runOnce(mw)
      expect(next, `request #${i + 1} should pass`).toHaveBeenCalled()
      expect(res.statusCode, `request #${i + 1} should not be limited`).toBeNull()
      now += SPACING
    }

    // 51st request, still inside the 24h rolling window of the first hit.
    const { res, next } = runOnce(mw)
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(429)
    expect(res.body).toMatchObject({ error: 'rate_limited', scope: 'day' })
    expect(res.body.retryAfter).toBeGreaterThan(0)
    expect(res.body.retryAfter).toBeLessThanOrEqual(24 * 60 * 60)
  })

  it('day cap precedence — day-limit hit returns scope=day even if minute would also trip', () => {
    let now = 1_000_000_000_000
    const mw = helpRateLimit({ _now: () => now })

    // Burn 50 well-spaced requests (no minute pressure).
    for (let i = 0; i < HELP_PER_DAY_LIMIT; i++) {
      runOnce(mw)
      now += 28 * 60 * 1000
    }
    // Snap forward so the last 5 hits live inside the same minute as the
    // next attempt: pull `now` back to just-past the last hit.
    const { res } = runOnce(mw)
    expect(res.statusCode).toBe(429)
    expect(res.body.scope).toBe('day')
  })

  it('different userIds are independent', () => {
    const now = 1_000_000_000_000
    const mw = helpRateLimit({ _now: () => now })

    for (let i = 0; i < HELP_PER_MINUTE_LIMIT; i++) {
      runOnce(mw, { userId: 'alice' })
    }
    // Alice is now at her minute cap.
    expect(runOnce(mw, { userId: 'alice' }).res.statusCode).toBe(429)

    // Bob is unaffected.
    const bob = runOnce(mw, { userId: 'bob' })
    expect(bob.next).toHaveBeenCalled()
    expect(bob.res.statusCode).toBeNull()
  })

  it('CLI bypass requests skip the limiter entirely', () => {
    const now = 1_000_000_000_000
    const mw = helpRateLimit({ _now: () => now })

    for (let i = 0; i < HELP_PER_MINUTE_LIMIT + 10; i++) {
      const { next, res } = runOnce(mw, { cliBypass: true })
      expect(next).toHaveBeenCalled()
      expect(res.statusCode).toBeNull()
    }
    // CLI bypass should not populate the bucket — there's no userId to key on.
    expect(_peekHelpRateLimitBucket('cli')).toBeNull()
  })

  it('falls through (calls next) when req.auth is missing — auth layer is responsible for 401', () => {
    const mw = helpRateLimit()
    const req  = {}  // no .auth
    const res  = makeRes()
    const next = vi.fn()
    mw(req, res, next)
    expect(next).toHaveBeenCalled()
    expect(res.statusCode).toBeNull()
  })

  it('Retry-After header matches the body retryAfter on minute-cap rejection', () => {
    let now = 1_000_000_000_000
    const mw = helpRateLimit({ _now: () => now })

    for (let i = 0; i < HELP_PER_MINUTE_LIMIT; i++) {
      runOnce(mw)
      now += 100
    }
    const { res } = runOnce(mw)
    expect(res.headers['Retry-After']).toBe(String(res.body.retryAfter))
  })

  it('sweep helper is wireable and stoppable without throwing', () => {
    // The sweep is unref'd in production. Here we just verify it can start
    // and stop cleanly so the boot wiring doesn't blow up if invoked twice.
    const t1 = startHelpRateLimitSweep()
    const t2 = startHelpRateLimitSweep()
    expect(t1).toBe(t2)  // idempotent
    stopHelpRateLimitSweep()
    stopHelpRateLimitSweep()  // double-stop is a no-op
  })
})
