// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * MIXED tournament — minimal UI smoke test.
 *
 * Verifies that when a registered user visits a started MIXED tournament:
 *   1. Their "Your match is ready!" card with a Play Match button renders.
 *   2. Clicking Play Match navigates to /play with the expected query params
 *      (botUserId, tournamentMatch, tournamentId) and the XO board renders.
 *
 * Everything else (state transitions, match completion, bracket advancement)
 * is covered by tournament-mixed.spec.js (pure API). This spec guards against
 * the three regressions we've actually hit:
 *   - AdminControls / MixedMatchReadyCard not rendered on the page
 *   - Seeded bots missing betterAuthId → Play Match button disabled
 *   - Navigation /play URL missing params so the board never mounts
 *
 * Required env (from qa.env via scripts/run-qa.sh):
 *   TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD
 *   TEST_USER_EMAIL  / TEST_USER_PASSWORD
 */

import { test, expect, request as playwrightRequest } from '@playwright/test'
import { signIn, fetchAuthToken, tournamentApi } from './helpers.js'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000'
const LANDING_URL = process.env.LANDING_URL || 'http://localhost:5174'

const haveAdmin = !!(process.env.TEST_ADMIN_EMAIL && process.env.TEST_ADMIN_PASSWORD)
const haveUser  = !!(process.env.TEST_USER_EMAIL  && process.env.TEST_USER_PASSWORD)

test.describe('MIXED tournament — UI smoke', () => {
  test.setTimeout(45_000)

  test('registered user sees Play Match card and lands on /play with board', async ({ browser }) => {
    test.skip(!haveAdmin, 'Set TEST_ADMIN_EMAIL + TEST_ADMIN_PASSWORD')
    test.skip(!haveUser,  'Set TEST_USER_EMAIL  + TEST_USER_PASSWORD')

    // ── API setup (admin path) ──────────────────────────────────────────────
    const adminCtx = await playwrightRequest.newContext({ baseURL: LANDING_URL })
    const adminPageLike = { context: () => ({ request: adminCtx }) }
    await signIn(adminPageLike, process.env.TEST_ADMIN_EMAIL, process.env.TEST_ADMIN_PASSWORD, LANDING_URL)
    const adminToken = await fetchAuthToken(adminCtx, LANDING_URL)

    const api = tournamentApi(LANDING_URL)
    const uniq = `ui-${Date.now()}`
    const tournament = await api.create({ request: adminCtx, token: adminToken }, {
      name: `E2E UI ${uniq}`, description: `UI smoke (${uniq})`,
      game: 'xo', mode: 'MIXED', format: 'PLANNED', bracketType: 'SINGLE_ELIM',
      bestOfN: 1, minParticipants: 2, maxParticipants: 4,
      startMode: 'MANUAL', allowSpectators: true,
    })
    const tid = tournament.id

    // One bot is enough — with 1 user + 1 bot the user plays in round 1.
    await api.addSeededBot({ request: adminCtx, token: adminToken }, tid, {
      difficulty: 'novice', displayName: 'E2E UI Bot',
    })
    await api.publish({ request: adminCtx, token: adminToken }, tid)

    // ── User path (browser) ─────────────────────────────────────────────────
    const userBrowserCtx = await browser.newContext()
    const userPage = await userBrowserCtx.newPage()
    userPage.on('console', m => {
      if (m.type() === 'error') console.log('[ui console error]', m.text())
    })

    try {
      await signIn(userPage, process.env.TEST_USER_EMAIL, process.env.TEST_USER_PASSWORD, LANDING_URL)
      const userToken = await fetchAuthToken(userBrowserCtx.request, LANDING_URL)

      // Register the user via API (UI registration is a separate concern).
      await api.register({ request: userBrowserCtx.request, token: userToken }, tid, {})

      // Admin starts the tournament — the user's round-1 match is now PENDING.
      await api.start({ request: adminCtx, token: adminToken }, tid)

      // Navigate AFTER start so the initial page fetch sees IN_PROGRESS —
      // avoids the known "page doesn't always re-render on tournament:started"
      // socket timing issue.
      await userPage.goto(`${LANDING_URL}/tournaments/${tid}`)

      // ── Assertion 1: Play Match button renders and is enabled ─────────────
      const playBtn = userPage.getByRole('button', { name: /^Play Match$/ })
      await expect(playBtn).toBeVisible({ timeout: 15_000 })
      await expect(playBtn).toBeEnabled()

      // ── Assertion 2: clicking it lands on /play with expected params ──────
      // Force-click: the Guide sidebar may be layered over the main content
      // on a freshly-loaded page; we're testing navigation, not layering.
      await playBtn.click({ force: true })
      await userPage.waitForURL(/\/play/, { timeout: 10_000 })
      const url = new URL(userPage.url())
      expect(url.pathname).toBe('/play')
      expect(url.searchParams.get('tournamentId'),  `got url=${userPage.url()}`).toBe(tid)
      expect(url.searchParams.get('tournamentMatch')).toBeTruthy()
      expect(url.searchParams.get('botUserId')).toBeTruthy()

      // ── Assertion 3: XO board renders (Cell 1 is an aria-label on XOGame) ──
      await expect(userPage.getByLabel(/^Cell 1/)).toBeVisible({ timeout: 20_000 })
    } finally {
      await userBrowserCtx.close()
      // Cancel the tournament so it doesn't linger in REGISTRATION/IN_PROGRESS.
      await api.cancel({ request: adminCtx, token: adminToken }, tid).catch(() => {})
      await adminCtx.dispose()
    }
  })
})
