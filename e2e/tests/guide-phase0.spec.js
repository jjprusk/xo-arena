// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Phase 0 — Visitor → Registered User funnel (Intelligent Guide v1, §3.5).
 *
 * Three scenarios:
 *
 *   1. Hero CTAs render for guests — DemoArena present, three-CTA ladder
 *      visible, "Build your own bot" opens SignInModal with build-bot copy.
 *      Pure UI, no auth/network — fast and deterministic.
 *
 *   2. Signup defers email verification — fresh signup logs the user in
 *      immediately (no verify-email wall) and surfaces the soft
 *      EmailVerifyBanner across the top of the app.
 *
 *   3. Guest progress is credited on signup — pre-seed the guideGuestJourney
 *      localStorage entry, sign up, then assert the new user's journey
 *      progress includes Hook steps 1 and 2.
 *
 * Prerequisites:
 *   Frontend  : http://localhost:5174 (landing)
 *   Backend   : http://localhost:3000
 *
 * No external test accounts required — each run creates a fresh email of
 * the form `phase0+<timestamp>-<rand>@dev.local` so signups don't collide.
 */

import { test, expect } from '@playwright/test'
import { fetchAuthToken } from './helpers.js'

const LANDING_URL = process.env.LANDING_URL || 'http://localhost:5174'

// SignInModal has a 3-second submit-too-fast guard (anti-bot). Real users wait
// at least that long while reading the form; Playwright fills it in <100ms, so
// tests must sleep before submit.
const SUBMIT_GUARD_MS = 3500

function freshEmail() {
  const ts = Date.now().toString(36)
  const r  = Math.random().toString(36).slice(2, 8)
  return `phase0+${ts}-${r}@dev.local`
}

// Pre-dismiss the GuestWelcomeModal that otherwise overlays the page on a
// fresh context. Without this, clicks on the hero CTAs are intercepted.
async function dismissWelcomeOnLoad(page) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem('aiarena_guest_welcome_seen', '1') } catch {}
  })
}

test.describe('Phase 0 — hero CTAs for guests', () => {
  test('renders DemoArena and the three progressive CTAs', async ({ page }) => {
    await dismissWelcomeOnLoad(page)
    await page.goto('/')

    // Live demo arena is the hero
    await expect(page.getByLabel(/Live demo: two bots/i)).toBeVisible()

    // Three CTAs in the progressive ladder
    await expect(page.getByRole('button', { name: /watch another bot match/i })).toBeVisible()
    await expect(page.getByRole('link',   { name: /play against a bot/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /build your own bot/i })).toBeVisible()
  })

  test('"Build your own bot" opens SignInModal with build-bot copy', async ({ page }) => {
    await dismissWelcomeOnLoad(page)
    await page.goto('/')

    await page.getByRole('button', { name: /build your own bot/i }).click()

    // Modal heading switches to the contextual variant
    await expect(page.getByRole('heading', { name: /build your first bot/i })).toBeVisible()
    // …and the supporting copy mentions tournaments
    await expect(page.getByText(/competes in tournaments/i)).toBeVisible()
  })
})

test.describe('Phase 0 — deferred email verification on signup', () => {
  test.setTimeout(60_000)

  test('signup completes without verify-email wall and shows soft banner', async ({ page }) => {
    await dismissWelcomeOnLoad(page)
    await page.goto('/')

    await page.getByRole('button', { name: /build your own bot/i }).click()
    await expect(page.getByRole('heading', { name: /build your first bot/i })).toBeVisible()

    const email    = freshEmail()
    const password = 'phase0-test-pw-1234'

    await page.getByPlaceholder(/^display name$/i).fill('Phase Zero')
    await page.getByPlaceholder(/^email$/i).fill(email)
    await page.getByPlaceholder(/min\. 8/i).fill(password)
    await page.getByPlaceholder(/confirm password/i).fill(password)

    // Wait past the 3s anti-bot guard before submitting.
    await page.waitForTimeout(SUBMIT_GUARD_MS)
    await page.getByRole('button', { name: /create account/i }).click()

    // Modal must close — the legacy "Check your email" wall must NOT appear.
    await expect(page.getByRole('heading', { name: /build your first bot/i }))
      .toBeHidden({ timeout: 10_000 })
    await expect(page.getByText(/check your email/i)).toHaveCount(0)

    // Soft banner is visible across the top of the app.
    await expect(page.getByRole('status', { name: /email verification reminder/i }))
      .toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/verify your email to enter tournaments/i)).toBeVisible()
  })
})

test.describe('Phase 0 — guest progress credits to new account', () => {
  test.setTimeout(60_000)

  test('localStorage guest journey is credited on signup', async ({ page, context }) => {
    // Pre-seed the guide-guest-journey snapshot the way DemoArena +
    // PlayPage would, *before* the page loads. clearGuestJourney runs
    // post-signup, so we can confirm the credit went through by checking
    // the new user's server-side journey progress.
    const hookStep1At = '2026-04-24T12:00:00.000Z'
    const hookStep2At = '2026-04-24T12:05:00.000Z'
    await page.addInitScript(({ s1, s2 }) => {
      try {
        window.localStorage.setItem('aiarena_guest_welcome_seen', '1')
        window.localStorage.setItem('guideGuestJourney', JSON.stringify({
          hookStep1CompletedAt: s1,
          hookStep2CompletedAt: s2,
        }))
      } catch {}
    }, { s1: hookStep1At, s2: hookStep2At })

    await page.goto('/')
    await page.getByRole('button', { name: /build your own bot/i }).click()
    await expect(page.getByRole('heading', { name: /build your first bot/i })).toBeVisible()

    const email    = freshEmail()
    const password = 'phase0-test-pw-1234'

    await page.getByPlaceholder(/^display name$/i).fill('Guest Credit')
    await page.getByPlaceholder(/^email$/i).fill(email)
    await page.getByPlaceholder(/min\. 8/i).fill(password)
    await page.getByPlaceholder(/confirm password/i).fill(password)

    await page.waitForTimeout(SUBMIT_GUARD_MS)
    await page.getByRole('button', { name: /create account/i }).click()

    // Wait for the modal to close — i.e., signup succeeded and guest-credit
    // had a chance to fire.
    await expect(page.getByRole('heading', { name: /build your first bot/i }))
      .toBeHidden({ timeout: 10_000 })

    // localStorage should be cleared after a successful credit.
    const remaining = await page.evaluate(() =>
      window.localStorage.getItem('guideGuestJourney')
    )
    expect(remaining).toBeNull()

    // Server-side: pull the JWT and read journey preferences. Steps 1 and 2
    // must be present in completedSteps.
    const token = await fetchAuthToken(context.request, LANDING_URL)
    const res   = await context.request.get(`${LANDING_URL}/api/v1/guide/preferences`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    const completed = body?.preferences?.journeyProgress?.completedSteps
                   ?? body?.journeyProgress?.completedSteps
                   ?? []
    expect(completed).toEqual(expect.arrayContaining([1, 2]))
  })
})
