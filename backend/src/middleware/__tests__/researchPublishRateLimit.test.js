// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Tests for the Research-Log publish rate limiter (Sprint 2 §158).
 * Mirrors the helpRateLimit test pattern — minimal req/res shims, clock
 * injected via _now.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  researchPublishRateLimit,
  RESEARCH_PUBLISH_PER_WEEK_LIMIT,
  _resetResearchPublishRateLimitState,
  _peekResearchPublishRateLimitBucket,
} from '../researchPublishRateLimit.js'

function makeReq({ userId = 'u-1', cliBypass = false } = {}) {
  return { auth: cliBypass ? { userId: 'cli', cliBypass: true } : { userId } }
}

function makeRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(c) { this.statusCode = c; return this },
    json(b)  { this.body = b; return this },
    setHeader(k, v) { this.headers[k] = v },
  }
}

function runOnce(mw, opts = {}) {
  const req  = makeReq(opts)
  const res  = makeRes()
  const next = vi.fn()
  mw(req, res, next)
  return { req, res, next }
}

describe('researchPublishRateLimit', () => {
  beforeEach(() => _resetResearchPublishRateLimitState())

  it('allows up to the weekly cap then 429s the next request', () => {
    let now = 1_700_000_000_000
    const mw = researchPublishRateLimit({ _now: () => now })
    for (let i = 0; i < RESEARCH_PUBLISH_PER_WEEK_LIMIT; i++) {
      const { res, next } = runOnce(mw)
      expect(next).toHaveBeenCalled()
      expect(res.statusCode).toBeNull()
      now += 60 * 1000 // 1 minute apart
    }
    const { res, next } = runOnce(mw)
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(429)
    expect(res.body).toMatchObject({ error: 'rate_limited', scope: 'week' })
    expect(res.body.limit).toBe(RESEARCH_PUBLISH_PER_WEEK_LIMIT)
    expect(res.headers['Retry-After']).toBeDefined()
  })

  it('replenishes after the rolling 7-day window elapses', () => {
    let now = 1_700_000_000_000
    const mw = researchPublishRateLimit({ _now: () => now })
    for (let i = 0; i < RESEARCH_PUBLISH_PER_WEEK_LIMIT; i++) {
      runOnce(mw)
      now += 60 * 1000
    }
    // Past the 7-day window — oldest entries should be pruned and we get a slot.
    now += 8 * 24 * 60 * 60 * 1000
    const { res, next } = runOnce(mw)
    expect(next).toHaveBeenCalled()
    expect(res.statusCode).toBeNull()
  })

  it('keeps per-user buckets independent', () => {
    let now = 1_700_000_000_000
    const mw = researchPublishRateLimit({ _now: () => now })
    for (let i = 0; i < RESEARCH_PUBLISH_PER_WEEK_LIMIT; i++) {
      runOnce(mw, { userId: 'alice' })
      now += 1000
    }
    // alice is at cap; bob is fresh
    const { res: aliceRes } = runOnce(mw, { userId: 'alice' })
    expect(aliceRes.statusCode).toBe(429)
    const { res: bobRes, next } = runOnce(mw, { userId: 'bob' })
    expect(next).toHaveBeenCalled()
    expect(bobRes.statusCode).toBeNull()
  })

  it('skips the limiter when req.auth.cliBypass is set', () => {
    let now = 1_700_000_000_000
    const mw = researchPublishRateLimit({ _now: () => now })
    for (let i = 0; i < RESEARCH_PUBLISH_PER_WEEK_LIMIT + 5; i++) {
      const { next, res } = runOnce(mw, { cliBypass: true })
      expect(next).toHaveBeenCalled()
      expect(res.statusCode).toBeNull()
      now += 1000
    }
    // bypass'd users should not have a bucket created
    expect(_peekResearchPublishRateLimitBucket('cli')).toBeNull()
  })

  it('falls through silently when req.auth.userId is missing', () => {
    const mw = researchPublishRateLimit()
    const req = { auth: {} }
    const res = makeRes()
    const next = vi.fn()
    mw(req, res, next)
    expect(next).toHaveBeenCalled()
    expect(res.statusCode).toBeNull()
  })

  it('returns retryAfter that points at the oldest entry expiry', () => {
    let now = 1_700_000_000_000
    const mw = researchPublishRateLimit({ _now: () => now })
    for (let i = 0; i < RESEARCH_PUBLISH_PER_WEEK_LIMIT; i++) {
      runOnce(mw)
      now += 1000
    }
    const { res } = runOnce(mw)
    // We pushed 50 entries 1s apart starting at t0; oldest is t0; expiry =
    // t0 + 7days; now ~ t0 + 50s. retryAfter ~ 7days - 50s ~ 604750 seconds.
    expect(res.body.retryAfter).toBeGreaterThan(7 * 24 * 60 * 60 - 60)
    expect(res.body.retryAfter).toBeLessThanOrEqual(7 * 24 * 60 * 60)
  })
})
