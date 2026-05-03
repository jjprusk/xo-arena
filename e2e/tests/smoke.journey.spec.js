import { test, expect } from '@playwright/test'
import { signIn, fetchAuthToken } from './helpers.js'

/**
 * Journey smoke — onboarding regression guards.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ LEGACY TEST — SKIPPED during Intelligent Guide v1 transition.           │
 * │                                                                          │
 * │ This test was written against the legacy 7-step journey (step 1 = auto  │
 * │ Welcome, step 3 = "Play your first game", step 7 = dismiss tutorial).   │
 * │ The v1 rewrite changed every step's meaning and trigger:                │
 * │   - Step 1 "Play a quick PvAI game" — no longer auto-completes on       │
 * │     hydration; fires server-side when the user completes a PvAI game    │
 * │   - Step 3 "Create your first bot" — no longer "Play your first game"   │
 * │   - Step 7 "See your bot's first tournament result" — no longer a       │
 * │     tutorial-modal dismissal                                            │
 * │                                                                          │
 * │ This test will be rewritten as `guide-hook.spec.js` and                 │
 * │ `guide-curriculum.spec.js` in Sprint 3 + Sprint 4 when the new Guide    │
 * │ UI (JourneyCard phases, hero+checklist rendering) ships. See            │
 * │ Intelligent_Guide_Implementation_Plan.md §7 (V1.1 sprint plan,          │
 * │ Sprint 3 Testing Requirements).                                         │
 * │                                                                          │
 * │ Until then: every test in this file is `.skip()`ed so CI stays green.   │
 * │ DO NOT remove the file — the helpers (signIn, fetchAuthToken, etc.)     │
 * │ are reused by the Sprint 3 replacement specs.                           │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

const LANDING_URL = process.env.LANDING_URL || 'http://localhost:5174'
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000'
const haveUser    = !!process.env.TEST_USER_EMAIL && !!process.env.TEST_USER_PASSWORD

const bearerHdr = (token) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' })

async function resetJourney(request, landingUrl, token) {
  const res = await request.post(`${landingUrl}/api/v1/guide/journey/restart`, { headers: bearerHdr(token) })
  if (!res.ok()) throw new Error(`Journey reset failed (${res.status()}): ${await res.text()}`)
}

// Directly set completedSteps on the server. Bypasses completeStep so the
// terminal-step TC reward doesn't accidentally fire during setup. Used to
// fast-forward past the steps that aren't relevant to the test.
async function setCompletedSteps(request, landingUrl, token, steps) {
  const res = await request.patch(`${landingUrl}/api/v1/guide/preferences`, {
    headers: bearerHdr(token),
    data: { journeyProgress: { completedSteps: steps, dismissedAt: null } },
  })
  if (!res.ok()) throw new Error(`Prefs patch failed (${res.status()}): ${await res.text()}`)
}

async function recordHvaGame(request, landingUrl, token) {
  // HVA win with minimum viable fields. Backend games.js:106 fires
  // completeStep(user.id, 3) on this path.
  const res = await request.post(`${landingUrl}/api/v1/games`, {
    headers: bearerHdr(token),
    data: {
      mode: 'HVA',
      outcome: 'PLAYER1_WIN',
      difficulty: 'novice',
      totalMoves: 5,
      durationMs: 3000,
      startedAt: new Date().toISOString(),
    },
  })
  if (!res.ok()) throw new Error(`Record game failed (${res.status()}): ${await res.text()}`)
}

// Ensure the Guide panel is open. The panel auto-opens on hydrate when the
// journey is incomplete; only click the orb if that hasn't happened. The
// "Your Journey" heading is rendered both pre-completion ("Next: ...") and
// at completion ("Onboarding Complete!"), so it's the stable signal.
const JOURNEY_OPEN_MARKER = /Your Journey|Onboarding Complete|Next:/
async function ensureGuideOpen(page) {
  try {
    await page.getByText(JOURNEY_OPEN_MARKER).first().waitFor({ state: 'visible', timeout: 4_000 })
    return
  } catch { /* panel not open yet — click the orb (aria-label flips when open, match both) */ }
  await page.getByRole('button', { name: /(Open|Close) Guide/ }).click({ force: true })
  await page.getByText(JOURNEY_OPEN_MARKER).first().waitFor({ state: 'visible', timeout: 10_000 })
}

test.describe.skip('Journey — step advancement [legacy — v1 rewrite pending, see header]', () => {
  test.setTimeout(45_000)

  test('finishing a game advances Next from step 3 to step 4', async ({ browser }) => {
    test.skip(!haveUser, 'Set TEST_USER_EMAIL + TEST_USER_PASSWORD in qa.env')

    const ctx  = await browser.newContext()
    const page = await ctx.newPage()
    try {
      await signIn(page, process.env.TEST_USER_EMAIL, process.env.TEST_USER_PASSWORD, LANDING_URL)
      const token = await fetchAuthToken(ctx.request, LANDING_URL)
      await resetJourney(ctx.request, LANDING_URL, token)

      // Hydrate on / (not /play, which skips hydrate) — GET /preferences
      // auto-completes step 1. Open the Guide, confirm step 3 is next.
      await page.goto('/')
      await ensureGuideOpen(page)
      await expect(page.getByText('Next:')).toBeVisible({ timeout: 10_000 })
      await expect(page.getByText('Play your first game')).toBeVisible()

      // Server-side: record a game. Backend marks step 3 complete.
      await recordHvaGame(ctx.request, LANDING_URL, token)

      // Simulate the real flow: user was on /play when the game finished,
      // then navigates back. The Guide must auto-reopen on /play → non-/play
      // transitions (AppLayout pathname effect) — no orb-click needed. The
      // assertion has a tight timeout so a regression that closes-and-stays-
      // closed fails loudly instead of being masked by the ensureGuideOpen
      // fallback.
      await page.goto('/play')
      await page.goto('/')
      await expect(page.getByText('Next:', { exact: false }).first())
        .toBeVisible({ timeout: 3_000 })
      await expect(page.getByText('Explore AI Training')).toBeVisible()

      // Step 3 should be crossed off in the step list, not the current target.
      const step3Row = page.getByText('Play your first game').first()
      await expect(step3Row).toHaveCSS('text-decoration-line', 'line-through')
    } finally {
      const token = await fetchAuthToken(ctx.request, LANDING_URL).catch(() => null)
      if (token) await resetJourney(ctx.request, LANDING_URL, token).catch(() => {})
      await ctx.close()
    }
  })

  test('visiting /tournaments shows the tutorial modal; dismissing it completes the journey', async ({ browser }) => {
    test.skip(!haveUser, 'Set TEST_USER_EMAIL + TEST_USER_PASSWORD in qa.env')

    const ctx  = await browser.newContext()
    const page = await ctx.newPage()
    try {
      await signIn(page, process.env.TEST_USER_EMAIL, process.env.TEST_USER_PASSWORD, LANDING_URL)
      const token = await fetchAuthToken(ctx.request, LANDING_URL)
      await resetJourney(ctx.request, LANDING_URL, token)

      // Fast-forward to [1..6] so the only gap is step 7 (the terminal step
      // we're exercising). Direct PATCH — bypasses completeStep so TC reward
      // doesn't misfire during setup.
      await setCompletedSteps(ctx.request, LANDING_URL, token, [1, 2, 3, 4, 5, 6])

      // Arrive on /tournaments. The page's useEffect should open the tutorial
      // modal once it sees step 7 is still missing from the hydrated store.
      await page.goto('/tournaments')
      const modal = page.getByRole('dialog', { name: /how tournaments work/i })
      await expect(modal).toBeVisible({ timeout: 10_000 })
      await expect(modal.getByRole('button', { name: /got it/i })).toBeVisible()

      // Dismissing must call triggerStep(7), mark step 7 done, and flip the
      // Guide to "Onboarding Complete!".
      await modal.getByRole('button', { name: /got it/i }).click()
      await expect(modal).toBeHidden({ timeout: 5_000 })

      await ensureGuideOpen(page)
      await expect(page.getByText(/Onboarding Complete/i)).toBeVisible({ timeout: 10_000 })

      // Revisiting /tournaments with step 7 already complete should NOT re-show
      // the modal (idempotency).
      await page.goto('/')
      await page.goto('/tournaments')
      await expect(page.getByRole('dialog', { name: /how tournaments work/i })).toHaveCount(0)
    } finally {
      const token = await fetchAuthToken(ctx.request, LANDING_URL).catch(() => null)
      if (token) await resetJourney(ctx.request, LANDING_URL, token).catch(() => {})
      await ctx.close()
    }
  })
})
