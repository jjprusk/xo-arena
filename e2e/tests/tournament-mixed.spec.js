// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * MIXED tournament end-to-end — API-only edition.
 *
 * This test exercises the full backend/tournament-service flow without any
 * UI rendering. It runs in ~10 seconds and catches the regressions we've
 * been hitting during MIXED-tournament work:
 *
 *   - Tournament creation + seeded-bot registration
 *   - DRAFT → REGISTRATION_OPEN → IN_PROGRESS state transitions
 *   - Bracket generation with 4 participants (user + 3 bots)
 *   - Admin can complete a bot-vs-bot match
 *   - User can complete their own match via the backend proxy
 *     (POST /api/v1/tournament-matches/:id/complete — participant auth check)
 *   - Bracket advancement produces a final-round match
 *   - Tournament completion assigns finalPosition to all participants
 *   - Seeded bots retain their displayNames after completion (no "TBD" regression)
 *
 * UI flakiness — socket delivery timing, Guide sidebar overlay, XOGame render
 * — is deliberately excluded. A separate lightweight UI smoke test can verify
 * that "Play Match" renders when expected.
 *
 * Required env (loaded by scripts/run-qa.sh from qa.env):
 *   TEST_ADMIN_EMAIL  / TEST_ADMIN_PASSWORD  — user with ADMIN or TOURNAMENT_ADMIN role
 *   TEST_USER_EMAIL   / TEST_USER_PASSWORD   — regular test user
 *
 * Run:
 *   ./scripts/run-qa.sh tournament-mixed
 */

import { test, expect, request as playwrightRequest } from '@playwright/test'
import { signIn, fetchAuthToken, tournamentApi } from './helpers.js'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000'
const LANDING_URL = process.env.LANDING_URL || 'http://localhost:5174'
const API_BASE    = LANDING_URL  // landing dev server proxies /api/tournaments to tournament service

const haveAdmin = !!(process.env.TEST_ADMIN_EMAIL && process.env.TEST_ADMIN_PASSWORD)
const haveUser  = !!(process.env.TEST_USER_EMAIL  && process.env.TEST_USER_PASSWORD)

test.describe('MIXED tournament — API end-to-end', () => {
  test.setTimeout(60_000)

  test('admin seeds + user registers + both complete matches + tournament completes with champion', async () => {
    test.skip(!haveAdmin, 'Set TEST_ADMIN_EMAIL + TEST_ADMIN_PASSWORD')
    test.skip(!haveUser,  'Set TEST_USER_EMAIL  + TEST_USER_PASSWORD')

    // Two cookie jars — admin + user sessions don't leak into each other.
    const adminCtx = await playwrightRequest.newContext({ baseURL: LANDING_URL })
    const userCtx  = await playwrightRequest.newContext({ baseURL: LANDING_URL })

    try {
      // signIn wants a `page`-like object with .context().request; fake it.
      const adminPageLike = { context: () => ({ request: adminCtx }) }
      const userPageLike  = { context: () => ({ request: userCtx  }) }

      // ── 1. Sign in (both contexts) + fetch JWTs ────────────────────────────
      await signIn(adminPageLike, process.env.TEST_ADMIN_EMAIL, process.env.TEST_ADMIN_PASSWORD, LANDING_URL)
      await signIn(userPageLike,  process.env.TEST_USER_EMAIL,  process.env.TEST_USER_PASSWORD,  LANDING_URL)
      const adminToken = await fetchAuthToken(adminCtx, LANDING_URL)
      const userToken  = await fetchAuthToken(userCtx,  LANDING_URL)

      const api = tournamentApi(API_BASE)
      const uniq = `e2e-${Date.now()}`

      // ── 2. Create MIXED best-of-1 tournament (bestOfN=1 keeps it snappy) ──
      const draft = await api.create({ request: adminCtx, token: adminToken }, {
        name:         `E2E Mixed ${uniq}`,
        description:  `Automated MIXED tournament QA (${uniq})`,
        game:         'xo',
        mode:         'MIXED',
        format:       'PLANNED',
        bracketType:  'SINGLE_ELIM',
        bestOfN:      1,
        minParticipants: 2,
        maxParticipants: 8,
        startMode:    'MANUAL',
        allowSpectators: true,
        isTest:       true,
      })
      expect(draft.status).toBe('DRAFT')
      const tid = draft.id

      // ── 3. Seed 3 bots ─────────────────────────────────────────────────────
      await api.addSeededBot({ request: adminCtx, token: adminToken }, tid, { difficulty: 'novice', displayName: 'E2E Bot A' })
      await api.addSeededBot({ request: adminCtx, token: adminToken }, tid, { difficulty: 'novice', displayName: 'E2E Bot B' })
      await api.addSeededBot({ request: adminCtx, token: adminToken }, tid, { difficulty: 'novice', displayName: 'E2E Bot C' })

      const seeded = await api.get({ request: adminCtx, token: adminToken }, tid)
      expect(seeded.participants.filter(p => p.user?.isBot).length).toBe(3)

      // ── 4. Publish — DRAFT → REGISTRATION_OPEN ─────────────────────────────
      const published = await api.publish({ request: adminCtx, token: adminToken }, tid)
      expect(published.status).toBe('REGISTRATION_OPEN')

      // ── 5. User registers (4 participants total) ───────────────────────────
      await api.register({ request: userCtx, token: userToken }, tid, {})
      const afterRegister = await api.get({ request: adminCtx, token: adminToken }, tid)
      expect(afterRegister.participants.length).toBe(4)
      const userParticipant = afterRegister.participants.find(p => !p.user?.isBot)
      expect(userParticipant).toBeTruthy()

      // ── 6. Admin starts → IN_PROGRESS, round-1 bracket generated ───────────
      const started = await api.start({ request: adminCtx, token: adminToken }, tid)
      expect(started.status).toBe('IN_PROGRESS')

      const r1 = await api.get({ request: adminCtx, token: adminToken }, tid)
      const round1Matches = (r1.rounds ?? []).find(rr => rr.roundNumber === 1)?.matches ?? []
      expect(round1Matches.length).toBe(2)
      // Every round-1 match is either PENDING (to be played) or COMPLETED (BYE auto-advance).
      // With 4 participants no BYEs — all should be PENDING.
      for (const m of round1Matches) {
        expect(['PENDING', 'IN_PROGRESS']).toContain(m.status)
        expect(m.participant1Id).toBeTruthy()
        expect(m.participant2Id).toBeTruthy()
      }

      // Identify the user's round-1 match and the bots' match.
      const userR1 = round1Matches.find(m =>
        m.participant1Id === userParticipant.id || m.participant2Id === userParticipant.id,
      )
      const botsR1 = round1Matches.find(m => m.id !== userR1.id)
      expect(userR1).toBeTruthy()
      expect(botsR1).toBeTruthy()

      // ── 7. User completes their own match (user wins) via backend proxy ───
      // p1/p2 Wins use the match's participant1Id / participant2Id order.
      const userIsP1 = userR1.participant1Id === userParticipant.id
      await api.completeMatchAsUser(
        { request: userCtx, token: userToken, backendBase: BACKEND_URL },
        userR1.id,
        {
          winnerId: userParticipant.id,
          p1Wins:   userIsP1 ? 1 : 0,
          p2Wins:   userIsP1 ? 0 : 1,
          drawGames: 0,
        },
      )

      // ── 8. Admin completes the bot-vs-bot match (participant1 wins) ────────
      await api.completeMatchAsAdmin({ request: adminCtx, token: adminToken }, botsR1.id, {
        winnerId: botsR1.participant1Id,
        p1Wins: 1, p2Wins: 0, drawGames: 0,
      })

      // Bracket advancement runs in a setImmediate on the tournament service —
      // poll briefly for the final-round match to appear.
      let finalMatch = null
      for (let i = 0; i < 20; i++) {
        const t = await api.get({ request: adminCtx, token: adminToken }, tid)
        const round2 = (t.rounds ?? []).find(rr => rr.roundNumber === 2)
        if (round2?.matches?.length) { finalMatch = round2.matches[0]; break }
        await new Promise(r => setTimeout(r, 250))
      }
      expect(finalMatch, 'final-round match never created — bracket advancement failed').toBeTruthy()

      // ── 9. Final match: user vs the winning bot. User wins again. ─────────
      const userIsFinalP1 = finalMatch.participant1Id === userParticipant.id
      await api.completeMatchAsUser(
        { request: userCtx, token: userToken, backendBase: BACKEND_URL },
        finalMatch.id,
        {
          winnerId: userParticipant.id,
          p1Wins:   userIsFinalP1 ? 1 : 0,
          p2Wins:   userIsFinalP1 ? 0 : 1,
          drawGames: 0,
        },
      )

      // ── 10. Poll until tournament completes, verify champion + standings ──
      let completed = null
      for (let i = 0; i < 20; i++) {
        const t = await api.get({ request: adminCtx, token: adminToken }, tid)
        if (t.status === 'COMPLETED') { completed = t; break }
        await new Promise(r => setTimeout(r, 250))
      }
      expect(completed, 'tournament never reached COMPLETED status').toBeTruthy()

      // Champion = user with finalPosition 1
      const champion = completed.participants.find(p => p.finalPosition === 1)
      expect(champion?.id).toBe(userParticipant.id)
      expect(champion?.user?.displayName).toBe(userParticipant.user.displayName)

      // Regression guard: seeded bots retain displayName even after tournament
      // completes. `cleanupSeededBots` used to nuke them, leaving "TBD" in the
      // historical bracket.
      for (const p of completed.participants) {
        expect(p.user?.displayName, `participant ${p.id} missing displayName`).toBeTruthy()
      }

      // Every non-bye round-1 match should be COMPLETED with a valid winner.
      const finalR1 = (completed.rounds ?? []).find(rr => rr.roundNumber === 1).matches
      for (const m of finalR1) {
        expect(m.status).toBe('COMPLETED')
        expect(m.winnerId).toBeTruthy()
      }
    } finally {
      await adminCtx.dispose()
      await userCtx.dispose()
    }
  })
})
