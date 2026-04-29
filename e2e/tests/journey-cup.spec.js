// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Curriculum step 6 — UI dropoff regression.
 *
 * Why this exists: the prior journey specs (`guide-curriculum.spec.js`)
 * proved the API path — POST /api/tournaments/curriculum-cup/clone returns
 * 201, step 6 fires through the participant:joined publish, the cup runs
 * to completion. None of that exercised the journey CTA the user actually
 * clicks.
 *
 * The CTA in journeySteps.js points at `/profile?action=cup`. Until this
 * commit's pair fix, ProfilePage had no handler — clicking "Enter Curriculum
 * Cup" parked the user on a blank /profile page with no progress, no error,
 * and no clue what to do next. The full curriculum loop silently broke at
 * step 6 in production while the API + bridge tests stayed green.
 *
 * What this spec does:
 *   1. Direct-URL regression: visit `/profile?action=cup` with one bot.
 *      Must redirect to `/tournaments/<id>` quickly (NOT stay on /profile),
 *      "Curriculum Cup" must be visible on the destination, step 6 must
 *      land server-side. The "Couldn't start" error banner must not show.
 *   2. From-Guide UI flow: spar via API → poll for step 5 → navigate home →
 *      click the "Enter Curriculum Cup" link inside the Guide panel →
 *      assert navigation to `/tournaments/<id>` and step 6 credit. This
 *      exercises the actual user click path, end to end.
 *   3. Zero-bot edge: a fresh user with no bots visiting `/profile?action=
 *      cup` must bounce to the QuickBotWizard rather than 500-ing on the
 *      cup-clone POST or stranding the user on /profile.
 *
 * Prereqs:
 *   Frontend (landing) : http://localhost:5174
 *   Backend            : http://localhost:3000
 */

import { test, expect } from '@playwright/test'
import { fetchAuthToken } from './helpers.js'
import { netCleanupByEmailPrefix } from './dbScript.js'
import { snapshotJourney, assertJourneyTransition } from './journeyAssert.js'

const EMAIL_PREFIX  = 'cup+'
const BACKEND_URL   = process.env.BACKEND_URL || 'http://localhost:3000'
const SUBMIT_GUARD_MS = 3500

function freshEmail() {
  const ts = Date.now().toString(36)
  const r  = Math.random().toString(36).slice(2, 8)
  return `${EMAIL_PREFIX}${ts}-${r}@dev.local`
}

async function dismissWelcomeOnLoad(page) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem('aiarena_guest_welcome_seen', '1') } catch {}
  })
}

async function signUp(page, { email, password, displayName }) {
  await page.goto('/')
  await page.getByRole('button', { name: /build your own bot/i }).click()
  await expect(page.getByRole('heading', { name: /build your first bot/i })).toBeVisible()
  await page.getByPlaceholder(/^display name$/i).fill(displayName)
  await page.getByPlaceholder(/^email$/i).fill(email)
  await page.getByPlaceholder(/min\. 8/i).fill(password)
  await page.getByPlaceholder(/confirm password/i).fill(password)
  await page.waitForTimeout(SUBMIT_GUARD_MS)
  await page.getByRole('button', { name: /create account/i }).click()
  await expect(page.getByRole('heading', { name: /build your first bot/i }))
    .toBeHidden({ timeout: 10_000 })
}

async function createQuickBot(request, token, displayName) {
  const res = await request.post(`${BACKEND_URL}/api/v1/bots/quick`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data:    { name: displayName, persona: 'aggressive' },
  })
  if (!res.ok()) throw new Error(`bots/quick failed: ${res.status()}`)
  return (await res.json()).bot
}

async function fetchUserId(request, token) {
  const sync = await request.post(`${BACKEND_URL}/api/v1/users/sync`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!sync.ok()) throw new Error(`users/sync failed: ${sync.status()}`)
  return (await sync.json())?.user?.id ?? null
}

async function fetchJourney(request, token) {
  const res = await request.get(`${BACKEND_URL}/api/v1/guide/preferences`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok()) return []
  const body = await res.json()
  return body?.preferences?.journeyProgress?.completedSteps
      ?? body?.journeyProgress?.completedSteps
      ?? []
}

async function pollForStep(request, token, stepIndex, deadlineMs = 30_000) {
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    const completed = await fetchJourney(request, token)
    if (completed.includes(stepIndex)) return completed
    await new Promise(r => setTimeout(r, 1000))
  }
  return await fetchJourney(request, token)
}

test.describe('Curriculum step 6 — UI dropoff regression', () => {
  test.setTimeout(180_000)

  test.afterAll(() => {
    netCleanupByEmailPrefix(EMAIL_PREFIX, { tag: 'cup-after' })
  })

  // ── 1. Direct URL regression ─────────────────────────────────────────────
  // Visiting `/profile?action=cup` must spawn a cup and navigate to its
  // detail page. Pre-fix, ProfilePage had no handler — the user landed on
  // /profile and nothing happened. The polled step-6 check below would have
  // failed within 30s, catching the regression in CI.
  test('direct /profile?action=cup → /tournaments/<id> + step 6 credited', async ({ page, context }) => {
    page.on('pageerror', (err) => console.log(`[browser:error] ${err.message}`))

    await dismissWelcomeOnLoad(page)
    const email       = freshEmail()
    const password    = 'cup-test-pw-1234'
    const displayName = `Cup ${Math.random().toString(36).slice(2, 8)}`
    await signUp(page, { email, password, displayName })

    const token  = await fetchAuthToken(context.request, BACKEND_URL)
    const userId = await fetchUserId(context.request, token)
    await createQuickBot(context.request, token, `CupBot ${Math.random().toString(36).slice(2, 6)}`)

    const before = await snapshotJourney(context.request, { backendUrl: BACKEND_URL, token, userId })
    expect(before.completedSteps.includes(6), 'step 6 must not be pre-credited').toBe(false)

    await page.goto('/profile?action=cup')

    // The handler POSTs the clone, then navigate('/tournaments/<id>?follow=
    // <callerBotId>', {replace:true}). 15s of slack — clone takes a moment
    // because it creates 3 ownerless bot User rows + bracket + initial
    // publishes. The `follow=<id>` query is what makes TournamentDetailPage
    // auto-open the live spectate modal on the user's round-1 match. Pre-
    // follow-fix, the user landed on a static bracket page; bot games
    // finish in 5-10 s so the round-1 matches were already done by the time
    // the user oriented — the cup felt skipped. The assertion below
    // requires the follow param specifically; bare /tournaments/<id> fails.
    await page.waitForURL(/\/tournaments\/[^/?]+\?follow=/, { timeout: 15_000 })

    await expect(page.getByRole('heading', { name: /Curriculum Cup/i })).toBeVisible({ timeout: 10_000 })

    // The error banner must NOT have shown — this would fire if cloneCup
    // 4xx/5xx'd or threw. It's a stronger signal than "we navigated" alone:
    // a future regression that swallows the error and soft-navigates would
    // get caught here.
    await expect(page.getByText(/Couldn't start the Curriculum Cup/i)).toBeHidden()

    // The follow effect should have opened the spectate modal on the
    // caller bot's round-1 match. The modal renders a "Following: <name>"
    // header. Pre-fix (when we navigated to bare /tournaments/<id>), no
    // modal opened and this assertion would time out. The mode may flip
    // from 'live' → 'ended' if the test arrives after the match completes
    // (1s pace, ~5 moves), so we only assert the Following header — which
    // is present in any of live / waiting / ended modes.
    await expect(page.getByText(/^Following:/)).toBeVisible({ timeout: 15_000 })

    // Step 6 fires server-side via tournament:participant:joined. Bridge
    // is fire-and-forget so allow a small grace window.
    const completed = await pollForStep(context.request, token, 6, 30_000)
    expect(completed).toEqual(expect.arrayContaining([6]))

    const after = await snapshotJourney(context.request, { backendUrl: BACKEND_URL, token, userId })
    assertJourneyTransition({
      prev: before, next: after,
      label: 'step 6 via /profile?action=cup',
      stepDone:  6,
      botsDelta: 0,
    })
  })

  // ── 2. From-Guide UI click path ──────────────────────────────────────────
  // Drive Hook + early Curriculum via API for speed (those paths have
  // their own UI tests). This spec's contribution is asserting that the
  // "Enter Curriculum Cup" link in the Guide panel actually lands on a
  // tournament page when clicked.
  test('clicking Enter Curriculum Cup in the Guide panel → /tournaments/<id>', async ({ page, context }) => {
    page.on('pageerror', (err) => console.log(`[browser:error] ${err.message}`))

    await dismissWelcomeOnLoad(page)
    const email       = freshEmail()
    const password    = 'cup-test-pw-1234'
    const displayName = `Cup2 ${Math.random().toString(36).slice(2, 8)}`
    await signUp(page, { email, password, displayName })

    const token  = await fetchAuthToken(context.request, BACKEND_URL)
    const userId = await fetchUserId(context.request, token)
    await createQuickBot(context.request, token, `CupBot2 ${Math.random().toString(36).slice(2, 6)}`)

    // Prefire steps 1-5 via PATCH /guide/preferences. The JourneyCard
    // renders the FIRST missing step's CTA (`STEPS.find(!completed)`), so
    // for the panel to show "Enter Curriculum Cup" the user must have
    // [1,2,3,4,5] complete. Driving each preceding step via its real
    // trigger would add ~30s of unrelated soak — those triggers have
    // their own dedicated specs (guide-onboarding, journey-train-modal,
    // journey-spar). What this spec uniquely proves is that *clicking*
    // the cup CTA from the rendered panel lands on a tournament page.
    const patchRes = await context.request.patch(`${BACKEND_URL}/api/v1/guide/preferences`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data:    { journeyProgress: { completedSteps: [1, 2, 3, 4, 5], dismissedAt: null } },
    })
    expect(patchRes.ok()).toBeTruthy()

    // Land on home; AppLayout hydrates the guide store on sign-in and
    // opens the panel when the journey isn't dismissed. The JourneyCard
    // computes nextStep from completedSteps and renders the step-6
    // ("Enter Curriculum Cup") CTA.
    await page.goto('/')

    // The Guide panel may take a beat to hydrate. Look for the CTA inside
    // the panel specifically — the page also renders generic tournament
    // copy that would false-match.
    const guidePanel = page.getByRole('dialog', { name: /^Guide$/i })
    await expect(guidePanel).toBeVisible({ timeout: 15_000 })

    const cupLink = guidePanel.getByRole('link', { name: /Enter Curriculum Cup/i })
    await expect(cupLink).toBeVisible({ timeout: 10_000 })

    const before = await snapshotJourney(context.request, { backendUrl: BACKEND_URL, token, userId })
    await cupLink.click()

    await page.waitForURL(/\/tournaments\/[^/?]+\?follow=/, { timeout: 15_000 })
    await expect(page.getByRole('heading', { name: /Curriculum Cup/i })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/Couldn't start the Curriculum Cup/i)).toBeHidden()
    // Spectate modal opened on the caller bot's match — same assertion as
    // test 1, applied here so the Guide-CTA path is also covered.
    await expect(page.getByText(/^Following:/)).toBeVisible({ timeout: 15_000 })

    const completed6 = await pollForStep(context.request, token, 6, 30_000)
    expect(completed6).toEqual(expect.arrayContaining([6]))

    const after = await snapshotJourney(context.request, { backendUrl: BACKEND_URL, token, userId })
    assertJourneyTransition({
      prev: before, next: after,
      label: 'step 6 via Guide-panel CTA click',
      stepDone:  6,
      botsDelta: 0,
    })
  })

  // ── 3. Zero-bot edge case ────────────────────────────────────────────────
  // The cup needs a bot to register. The handler bounces to the
  // QuickBotWizard rather than POSTing into a 4xx — proves we're not
  // ever stranding a no-bots user on /profile waiting for nothing.
  test('user with zero bots → bounces to ?action=quick-bot', async ({ page, context: _ctx }) => {
    await dismissWelcomeOnLoad(page)
    const email       = freshEmail()
    const password    = 'cup-test-pw-1234'
    const displayName = `Cup3 ${Math.random().toString(36).slice(2, 8)}`
    await signUp(page, { email, password, displayName })

    // Note: deliberately NOT creating a quick bot here.
    await page.goto('/profile?action=cup')
    await page.waitForURL(/\/profile\?action=quick-bot/, { timeout: 10_000 })
  })
})
