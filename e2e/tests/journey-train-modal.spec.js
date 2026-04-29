// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * TrainGuidedModal — end-to-end model-update verification.
 *
 * The other journey specs drive Curriculum step 4 by POSTing
 * `/api/v1/bots/:id/train-guided` + `/finalize` directly; that path passes
 * even when the modal itself is broken (the StrictMode-cancellation hang
 * that surfaced with status='starting' "Preparing self-play episodes…"
 * forever, with `setSessionId / setChannelPrefix` skipped).
 *
 * This spec walks the *UI* journey:
 *
 *   1. Sign up a fresh user.
 *   2. Create a quick bot (one API call — bot creation is not what we're
 *      testing here, and the journey CTA forwards single-bot users to
 *      /bots/<id> regardless).
 *   3. Hit `/profile?action=train-bot` so ProfilePage forwards us to
 *      `/bots/<id>?action=train-bot` and the spotlight lights the Train
 *      button.
 *   4. Click the Train button → opens TrainGuidedModal.
 *   5. Wait for the modal to reach the celebration state ("Bot trained!"
 *      heading + Continue button). A regression of the StrictMode bug
 *      would hang the modal at "Preparing self-play episodes…" forever
 *      and this assertion would time out.
 *   6. Snapshot bot state via `snapshotJourney` and assert the model
 *      actually flipped — same `qlearningBot` check journeyAssert.js
 *      already runs for the API-driven specs, but this one proves the
 *      transition holds when the user goes through the real modal.
 */

import { test, expect } from '@playwright/test'
import { fetchAuthToken } from './helpers.js'
import { netCleanupByEmailPrefix } from './dbScript.js'
import { snapshotJourney, assertJourneyTransition } from './journeyAssert.js'

const EMAIL_PREFIX  = 'tgm+'
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

test.describe('TrainGuidedModal — end-to-end', () => {
  // The modal flow itself is ~5 s of training + 2.5 s celebration + a bit
  // of network slack; combined with signup + quickbot create the spec runs
  // in ~25 s on a warm cache. Bump the timeout so it's never the limit.
  test.setTimeout(180_000)

  test.afterAll(() => {
    netCleanupByEmailPrefix(EMAIL_PREFIX, { tag: 'tgm-after' })
  })

  test('clicking the spotlit Train button trains the bot and flips the model server-side', async ({ page, context }) => {
    page.on('pageerror', (err) => console.log(`[browser:error] ${err.message}`))

    await dismissWelcomeOnLoad(page)
    const email       = freshEmail()
    const password    = 'tgm-test-pw-1234'
    const displayName = `Tgm ${Math.random().toString(36).slice(2, 8)}`
    await signUp(page, { email, password, displayName })

    const token  = await fetchAuthToken(context.request, BACKEND_URL)
    const userId = await fetchUserId(context.request, token)
    const bot    = await createQuickBot(context.request, token, `TgmBot ${Math.random().toString(36).slice(2, 6)}`)

    // Pre-modal snapshot: bot should still be a fresh minimax Quick Bot —
    // the post-modal assertion needs this baseline to compute Δ.
    const snapCtx = { backendUrl: BACKEND_URL, token, userId }
    const before  = await snapshotJourney(context.request, snapCtx)
    const beforeBot = before.bots.find(b => b.id === bot.id)
    expect(beforeBot, 'newly-created quick bot must appear in snapshot').toBeTruthy()
    expect(beforeBot.botModelType).toBe('minimax')
    expect(beforeBot.botModelId).toMatch(/^builtin:minimax:|^user:[^:]+:minimax:/)

    // Land on the journey CTA. ProfilePage forwards single-bot users to
    // /bots/<id>?action=train-bot and lights the Train button.
    await page.goto('/profile?action=train-bot')
    await page.waitForURL(/\/bots\/[^/?]+\?action=train-bot/, { timeout: 10_000 })

    const trainBtn = page.getByRole('button', { name: /train your bot/i })
    await expect(trainBtn).toBeVisible({ timeout: 10_000 })
    await expect(trainBtn).toHaveClass(/xo-spotlight-pulse/, { timeout: 6_000 })

    // ── Click → modal opens → wait for the "done" celebration ────────────
    await trainBtn.click()

    // Modal mounts immediately; first the header reads "Training <name>…".
    // Pre-fix, this was where the bug surfaced — status stayed 'starting'
    // forever and the "Continue" button never appeared.
    await expect(page.getByRole('dialog', { name: /training your bot/i }))
      .toBeVisible({ timeout: 5_000 })

    // Training is ~5 s + 2.5 s celebration timer; allow generous slack so
    // a slow CI host doesn't false-fail. The Continue button is the
    // canonical "we made it past 'finalizing'" signal.
    await expect(page.getByRole('heading', { name: /bot trained!/i }))
      .toBeVisible({ timeout: 60_000 })
    await expect(page.getByRole('button', { name: /^continue$/i })).toBeVisible()

    // ── Server-side model-swap verification ──────────────────────────────
    // This spec deliberately skips Hook + early Curriculum steps (1-3) to
    // keep the test focused on the *modal flow*, so we don't assert phase
    // or tcDelta — those are journey-ordering invariants the API-driven
    // guide-onboarding / guide-ui-states specs already cover end-to-end.
    // What this run uniquely proves: the user clicking the Train button
    // through the actual modal results in the same server-side bot row
    // mutation as the direct-API path (qlearning + UUID botModelId +
    // step 4 in completedSteps).
    const after = await snapshotJourney(context.request, snapCtx)
    assertJourneyTransition({
      prev: before, next: after,
      label: 'step4 via TrainGuidedModal UI',
      stepDone:     4,
      botsDelta:    0,
      qlearningBot: bot.id,
    })
  })
})
