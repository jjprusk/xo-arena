// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * RUM (Real-User Monitoring) Web Vitals ingest.
 *
 * POST /api/v1/perf/vitals
 *
 * Body shape (all optional unless noted):
 *   {
 *     sessionId:       string,           // tab-scoped, NOT a user id
 *     deviceClass:     'desktop'|'mobile'|'unknown',
 *     effectiveType:   '4g'|'3g'|'2g'|'slow-2g'|'unknown',
 *     releaseVersion:  string|null,
 *     userAgent:       string,
 *     vitals: [{                         // required, non-empty array
 *       name:           'FCP'|'LCP'|'INP'|'CLS'|'TTFB',
 *       value:          number,
 *       rating?:        'good'|'needs-improvement'|'poor',
 *       id?:            string,
 *       navigationType?:string,
 *       route:          string,
 *     }]
 *   }
 *
 * Always returns 204 — beacons are best-effort and we don't want a
 * misbehaving client to retry on a non-2xx. Garbage rows are dropped
 * silently; the response code only signals "we got the request".
 *
 * Anonymous: we do not require auth, do not require an SSE session,
 * and do not store IPs or user ids. The only durable identifier is
 * `sessionId`, which the client mints fresh per tab via `crypto`.
 */
import { Router } from 'express'
import db from '../lib/db.js'
import logger from '../logger.js'

const router = Router()

const ALLOWED_NAMES   = new Set(['FCP', 'LCP', 'INP', 'CLS', 'TTFB'])
const ALLOWED_DEVICES = new Set(['desktop', 'mobile', 'unknown'])
const ALLOWED_RATINGS = new Set(['good', 'needs-improvement', 'poor'])
const ALLOWED_COHORTS = new Set(['first-visit', 'returning', 'unknown'])
const MAX_VITALS_PER_BEACON = 32

function s(val, max = 64) {
  if (val == null) return null
  return String(val).slice(0, max)
}

function deriveEnv() {
  // FLY_APP_NAME is set in production by Fly. We branch on that so the same
  // backend image can label vitals correctly per env without a dedicated
  // env var.
  const app = process.env.FLY_APP_NAME ?? ''
  if (app.includes('prod'))    return 'prod'
  if (app.includes('staging')) return 'staging'
  if (process.env.NODE_ENV === 'production') return 'prod'
  return 'local'
}

router.post('/vitals', async (req, res) => {
  // Always 204 — ack the beacon regardless of payload outcome.
  try {
    const body = req.body ?? {}
    const sessionId = s(body.sessionId, 64)
    if (!sessionId) return res.status(204).end()

    const vitals = Array.isArray(body.vitals) ? body.vitals : []
    if (vitals.length === 0 || vitals.length > MAX_VITALS_PER_BEACON) {
      return res.status(204).end()
    }

    const deviceClass   = ALLOWED_DEVICES.has(body.deviceClass) ? body.deviceClass : 'unknown'
    const effectiveType = s(body.effectiveType, 16)
    const releaseVersion = s(body.releaseVersion, 64)
    const userAgent      = s(body.userAgent, 200)
    const cohort         = ALLOWED_COHORTS.has(body.cohort) ? body.cohort : null
    const env            = deriveEnv()

    const rows = []
    for (const v of vitals) {
      if (!v || typeof v !== 'object') continue
      const name = s(v.name, 16)?.toUpperCase()
      if (!ALLOWED_NAMES.has(name)) continue
      // Strict type check first — `Infinity` JSON-serializes to `null`, and
      // `Number(null) === 0`, which would slip past a coerce-then-check guard.
      if (typeof v.value !== 'number') continue
      const value = v.value
      if (!Number.isFinite(value) || value < 0 || value > 1e7) continue
      const route = s(v.route, 200) ?? '/'
      const rating = ALLOWED_RATINGS.has(v.rating) ? v.rating : null
      rows.push({
        env,
        releaseVersion,
        sessionId,
        route,
        name,
        value,
        rating,
        navigationType: s(v.navigationType, 32),
        deviceClass,
        effectiveType,
        userAgent,
        cohort,
      })
    }
    if (rows.length === 0) return res.status(204).end()

    // createMany skips returning rows so it's the cheapest write path.
    await db.perfVital.createMany({ data: rows })
    return res.status(204).end()
  } catch (err) {
    // Don't surface — beacons should never appear as 5xx in browser console.
    logger.warn({ err: err.message }, 'POST /perf/vitals failed')
    return res.status(204).end()
  }
})

export default router
