// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * MIXED tournament — two humans both claim their HvH match seat.
 *
 * Regression guard for a prod report 2026-05-09: in a MIXED tournament with
 * two human participants paired in round 1, the second human's "Play Match"
 * click returned "Table closed due to inactivity" — the client side of a 404
 * from `POST /api/v1/rt/tournaments/matches/:id/table`.
 *
 * The 404 source is `tournamentMatchService.joinMatchTable` line ~75:
 *
 *   const pending = getPendingPvpMatch(matchId)
 *   if (!pending) throw new TournamentMatchError('NOT_FOUND', ...)
 *
 * `_pendingPvpMatches` is an in-memory per-process Map seeded by the
 * `tournament:match:ready` Redis event (`backend/src/lib/tournamentBridge.js`).
 * It evicts on a 2h TTL, on backend restart, and is per-machine — so a
 * multi-machine deploy can land the second human's POST on a backend that
 * never saw the event (or whose entry was overwritten by the first claim
 * landing on a different machine).
 *
 * This test asserts the basic single-machine path: both humans complete the
 * claim flow, both receive a slug, and the second receives the SAME slug.
 *
 * Required env (loaded by scripts/run-qa.sh from qa.env):
 *   TEST_ADMIN_EMAIL   / TEST_ADMIN_PASSWORD    — user with TOURNAMENT_ADMIN
 *   TEST_USER_EMAIL    / TEST_USER_PASSWORD     — first human player
 *   TEST_USER2_EMAIL   / TEST_USER2_PASSWORD    — second human player
 *
 * Run:
 *   ./scripts/run-qa.sh tournament-2human-match-claim
 */

import { test, expect, request as playwrightRequest } from '@playwright/test'
import { signIn, fetchAuthToken, tournamentApi } from './helpers.js'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000'
const LANDING_URL = process.env.LANDING_URL || 'http://localhost:5174'

const haveAdmin = !!(process.env.TEST_ADMIN_EMAIL  && process.env.TEST_ADMIN_PASSWORD)
const haveUser1 = !!(process.env.TEST_USER_EMAIL   && process.env.TEST_USER_PASSWORD)
const haveUser2 = !!(process.env.TEST_USER2_EMAIL  && process.env.TEST_USER2_PASSWORD)

/**
 * Open an SSE stream for the given APIRequestContext and resolve with its
 * minted sseSessionId. The caller MUST invoke `close()` at the end of the
 * test — sseSessions evicts ~3s after the connection drops.
 *
 * `/api/v1/events/stream` uses cookie session auth (optionalSessionCookie),
 * so we lift cookies out of the Playwright context into a Cookie header for
 * Node's global fetch.
 */
async function openSseSession(ctx, landingUrl) {
  const state = await ctx.storageState()
  const host = new URL(landingUrl).hostname
  const cookieHeader = (state.cookies || [])
    .filter(c => host.endsWith(c.domain.replace(/^\./, '')))
    .map(c => `${c.name}=${c.value}`)
    .join('; ')

  const ac = new AbortController()
  const res = await fetch(`${landingUrl}/api/v1/events/stream`, {
    headers: { Cookie: cookieHeader, Accept: 'text/event-stream' },
    signal:  ac.signal,
  })
  if (!res.ok || !res.body) {
    ac.abort()
    throw new Error(`SSE open failed: ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const m = buf.match(/event: session\ndata: (\{[^\n]+\})/)
    if (m) {
      const { sseSessionId } = JSON.parse(m[1])
      // Drain heartbeats + subsequent events so backpressure doesn't pause
      // the server. The connection must stay alive for the duration of the
      // test — the session is disposed shortly after close.
      ;(async () => {
        try { while (true) { const r = await reader.read(); if (r.done) break } }
        catch {}
      })()
      return { sseSessionId, close: () => ac.abort() }
    }
  }
  ac.abort()
  throw new Error('SSE session event never arrived within 5s')
}

async function rtClaim({ ctx, token, sseSessionId, matchId }) {
  return ctx.post(`${LANDING_URL}/api/v1/rt/tournaments/matches/${matchId}/table`, {
    headers: {
      Authorization:   `Bearer ${token}`,
      'Content-Type':  'application/json',
      'X-SSE-Session': sseSessionId,
    },
    data: {},
  })
}

test.describe('MIXED tournament — two humans claim seats', () => {
  test.setTimeout(90_000)

  test('both humans claim the same Table without 404', async () => {
    test.skip(!haveAdmin, 'Set TEST_ADMIN_EMAIL + TEST_ADMIN_PASSWORD')
    test.skip(!haveUser1, 'Set TEST_USER_EMAIL + TEST_USER_PASSWORD')
    test.skip(!haveUser2, 'Set TEST_USER2_EMAIL + TEST_USER2_PASSWORD')

    const adminCtx = await playwrightRequest.newContext({ baseURL: LANDING_URL })
    const u1Ctx    = await playwrightRequest.newContext({ baseURL: LANDING_URL })
    const u2Ctx    = await playwrightRequest.newContext({ baseURL: LANDING_URL })

    let u1Sse = null
    let u2Sse = null
    try {
      const adminPg = { context: () => ({ request: adminCtx }) }
      const u1Pg    = { context: () => ({ request: u1Ctx    }) }
      const u2Pg    = { context: () => ({ request: u2Ctx    }) }

      // ── 1. Sign in everyone, fetch JWTs ───────────────────────────────────
      await signIn(adminPg, process.env.TEST_ADMIN_EMAIL, process.env.TEST_ADMIN_PASSWORD, LANDING_URL)
      await signIn(u1Pg,    process.env.TEST_USER_EMAIL,  process.env.TEST_USER_PASSWORD,  LANDING_URL)
      await signIn(u2Pg,    process.env.TEST_USER2_EMAIL, process.env.TEST_USER2_PASSWORD, LANDING_URL)
      const adminToken = await fetchAuthToken(adminCtx, LANDING_URL)
      const u1Token    = await fetchAuthToken(u1Ctx,    LANDING_URL)
      const u2Token    = await fetchAuthToken(u2Ctx,    LANDING_URL)

      const api  = tournamentApi(LANDING_URL)
      const uniq = `e2e-2h-${Date.now()}`

      // ── 2. Create a 2-seat MIXED tournament (manual start, isTest) ────────
      const draft = await api.create({ request: adminCtx, token: adminToken }, {
        name:            `E2E 2-human ${uniq}`,
        description:     `Two humans claim seats (${uniq})`,
        game:            'xo',
        mode:            'MIXED',
        format:          'PLANNED',
        bracketType:     'SINGLE_ELIM',
        bestOfN:         1,
        minParticipants: 2,
        maxParticipants: 2,
        startMode:       'MANUAL',
        allowSpectators: true,
        isTest:          true,
      })
      const tid = draft.id
      expect(draft.status).toBe('DRAFT')

      // ── 3. Publish + register both humans ────────────────────────────────
      const published = await api.publish({ request: adminCtx, token: adminToken }, tid)
      expect(published.status).toBe('REGISTRATION_OPEN')
      await api.register({ request: u1Ctx, token: u1Token }, tid, {})
      await api.register({ request: u2Ctx, token: u2Token }, tid, {})
      const seeded = await api.get({ request: adminCtx, token: adminToken }, tid)
      expect(seeded.participants.length).toBe(2)
      expect(seeded.participants.every(p => !p.user?.isBot)).toBe(true)

      // ── 4. Open SSE sessions BEFORE start ────────────────────────────────
      // The /rt/* endpoints require a live SSE session. We open it before
      // tournament:start so the bridge has the session registered when the
      // tournament:match:ready Redis event fans out.
      u1Sse = await openSseSession(u1Ctx, LANDING_URL)
      u2Sse = await openSseSession(u2Ctx, LANDING_URL)
      expect(u1Sse.sseSessionId).toBeTruthy()
      expect(u2Sse.sseSessionId).toBeTruthy()

      // ── 5. Start tournament + wait for round 1 to materialise ────────────
      const started = await api.start({ request: adminCtx, token: adminToken }, tid)
      expect(started.status).toBe('IN_PROGRESS')

      let matchId = null
      for (let i = 0; i < 40; i++) {
        const t  = await api.get({ request: adminCtx, token: adminToken }, tid)
        const r1 = (t.rounds ?? []).find(rr => rr.roundNumber === 1)
        if (r1?.matches?.[0]?.id) { matchId = r1.matches[0].id; break }
        await new Promise(r => setTimeout(r, 250))
      }
      expect(matchId, 'round-1 match never created').toBeTruthy()

      // tournament:match:ready is published asynchronously by the tournament
      // service and consumed by the backend bridge; allow a beat for the
      // _pendingPvpMatches map to populate.
      await new Promise(r => setTimeout(r, 750))

      // ── 6. User 1 claims seat — must succeed ─────────────────────────────
      const r1 = await rtClaim({ ctx: u1Ctx, token: u1Token, sseSessionId: u1Sse.sseSessionId, matchId })
      expect(r1.ok(), `user1 claim ${r1.status()}: ${await r1.text()}`).toBe(true)
      const j1 = await r1.json()
      expect(j1.action).toBe('created')
      expect(j1.slug).toBeTruthy()
      expect(j1.mark).toBe('X')
      expect(j1.matchId).toBe(matchId)

      // ── 7. User 2 claims seat — REGRESSION ASSERTION ─────────────────────
      // Pre-fix prod symptom: 404 NOT_FOUND → useGameSDK setAbandoned →
      // "Table closed due to inactivity". Both POSTs must succeed; the
      // second must be routed to the SAME Table the first created.
      const r2 = await rtClaim({ ctx: u2Ctx, token: u2Token, sseSessionId: u2Sse.sseSessionId, matchId })
      expect(r2.ok(), `user2 claim ${r2.status()}: ${await r2.text()}`).toBe(true)
      const j2 = await r2.json()
      expect(j2.action).toBe('joined')
      expect(j2.slug).toBe(j1.slug)
      expect(j2.mark).toBe('O')
      expect(j2.matchId).toBe(matchId)
    } finally {
      u1Sse?.close()
      u2Sse?.close()
      await adminCtx.dispose()
      await u1Ctx.dispose()
      await u2Ctx.dispose()
    }
  })
})
