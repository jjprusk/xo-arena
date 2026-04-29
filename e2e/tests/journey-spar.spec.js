// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Spar via the Curriculum step-5 UI path.
 *
 * Without this spec the only spar coverage drove the API directly
 * (POST /api/v1/bot-games/practice → POST /api/v1/bot-games/<slug>/...),
 * which sidestepped the broken bit: the route was creating an in-memory
 * bot game but no Table row, so the spectator's
 * /rt/tables/<slug>/join 404'd, useGameSDK mapped that to
 * setAbandoned({reason:'stale'}), and PlayPage rendered "Table closed
 * due to inactivity" — even though the underlying bot game was
 * fine. End users only saw a stale error page after clicking Spar Now.
 *
 * What this spec does:
 *   1. Sign up + create a Quick Bot.
 *   2. Hit /profile?action=spar — ProfilePage forwards single-bot users
 *      to /bots/<id>?action=spar and the Spar Now button gets the
 *      <Spotlight /> pulse.
 *   3. Click "Spar now" → navigation to /play?join=<slug>&watch=1.
 *   4. Assert the spectate flow actually mounts (board / GameView is
 *      visible) AND the "Table closed due to inactivity" abandoned
 *      message does NOT appear within a generous window. A regression
 *      of the missing-Table-row bug fails this assertion within ~1s.
 *
 * Second test — post-spar journey transition (step 5 → step 6):
 *   The original spec proved we *land* on the spectate page; it never
 *   waited for the spar to finish, so it couldn't observe what happens
 *   when the match is over. In production, step 5 fired server-side but
 *   the Guide panel never reopened — the spectator stays on /play, where
 *   AppLayout's `guide:journeyStep` handler suppressed auto-open while on
 *   /play|/tables to keep the scrim off live boards. There was also no
 *   per-page table.released handler on PlayPage to reopen, so the user
 *   was stranded on a finished board with no path to step 6.
 *
 *   The fix: AppLayout carves out step 5 (which only fires after series
 *   completion — by definition the spar is over) so the panel opens even
 *   on /play. The backend also renamed the spar trigger from `game-end`
 *   to `spar-finish` and TableDetailPage opens on it, as defensive
 *   coverage for any future flow that lands the spectator on /tables.
 *
 *   This second test pre-fires steps 1-4 so the next step is 5; drives
 *   a fast spar via API (moveDelayMs: 50); spectates via the real
 *   /play?join=<slug>&watch=1 URL; waits for step 5 to credit; then
 *   asserts the Guide panel auto-opens with the step-6 ("Enter
 *   Curriculum Cup") CTA visible. A future regression of the AppLayout
 *   carve-out fails the panel-visible / CTA-visible assertions.
 */

import { test, expect } from '@playwright/test'
import { fetchAuthToken } from './helpers.js'
import { netCleanupByEmailPrefix } from './dbScript.js'

const EMAIL_PREFIX  = 'spr+'
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

async function startSpar(request, token, myBotId) {
  // moveDelayMs: 50 keeps the bot-vs-bot loop snappy so the spec runs in
  // ~1s of game time instead of ~15s; the production default is 1500.
  const res = await request.post(`${BACKEND_URL}/api/v1/bot-games/practice`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data:    { myBotId, opponentTier: 'easy', moveDelayMs: 50 },
  })
  if (!res.ok()) throw new Error(`bot-games/practice failed: ${res.status()}`)
  return res.json()
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
    await new Promise(r => setTimeout(r, 500))
  }
  return await fetchJourney(request, token)
}

test.describe('Curriculum step 5 — Spar via UI', () => {
  test.setTimeout(120_000)

  test.afterAll(() => {
    netCleanupByEmailPrefix(EMAIL_PREFIX, { tag: 'spr-after' })
  })

  test('clicking Spar now lands on the spectate page (not the inactivity error)', async ({ page, context }) => {
    page.on('pageerror', (err) => console.log(`[browser:error] ${err.message}`))

    await dismissWelcomeOnLoad(page)
    const email       = freshEmail()
    const password    = 'spr-test-pw-1234'
    const displayName = `Spr ${Math.random().toString(36).slice(2, 8)}`
    await signUp(page, { email, password, displayName })

    const token = await fetchAuthToken(context.request, BACKEND_URL)
    await createQuickBot(context.request, token, `SprBot ${Math.random().toString(36).slice(2, 6)}`)

    await page.goto('/profile?action=spar')
    await page.waitForURL(/\/bots\/[^/?]+\?action=spar/, { timeout: 10_000 })

    const sparBtn = page.getByRole('button', { name: /^spar now$/i })
    await expect(sparBtn).toBeVisible({ timeout: 10_000 })
    await sparBtn.click()

    // Navigation is to /play?join=<slug>&watch=1; the slug is generated
    // server-side so we match the shape rather than a literal value.
    await page.waitForURL(/\/play\?join=[^&]+&watch=1/, { timeout: 10_000 })

    // ── The actual regression check ──────────────────────────────────────
    // Pre-fix, the rt /rt/tables/<slug>/join 404'd because no Table row
    // backed the slug. useGameSDK caught that as `status:404` and set
    // abandoned={reason:'stale'}, so PlayPage flipped to the inactivity
    // empty-state within a few hundred ms. Post-fix, the join finds the
    // Table row created by /practice and the spectate flow proceeds.
    await expect(page.getByText(/Table closed due to inactivity/i))
      .toBeHidden({ timeout: 8_000 })

    // The bot-vs-bot game should be running — board cells visible.
    // The XO board is a 3x3 grid of buttons with aria-labels "Cell 1..9".
    await expect(page.getByRole('button', { name: /^cell 1/i }))
      .toBeVisible({ timeout: 15_000 })
  })

  // ── 2. Post-spar journey transition (step 5 → step 6) ───────────────────
  // Drives a fast spar via API, spectates via the real /play URL, and
  // asserts that once step 5 credits server-side the Guide panel auto-opens
  // with the step-6 ("Enter Curriculum Cup") CTA visible. Pre-fix, the user
  // sat on a finished /play board with no nudge — the panel stayed closed
  // because AppLayout's guide:journeyStep handler suppressed auto-open on
  // /play and there was no per-page table.released handler to reopen.
  test('after spar finishes, Guide panel auto-opens with step-6 CTA', async ({ page, context }) => {
    page.on('pageerror', (err) => console.log(`[browser:error] ${err.message}`))

    await dismissWelcomeOnLoad(page)
    const email       = freshEmail()
    const password    = 'spr-test-pw-1234'
    const displayName = `SprX ${Math.random().toString(36).slice(2, 8)}`
    await signUp(page, { email, password, displayName })

    const token = await fetchAuthToken(context.request, BACKEND_URL)
    const bot   = await createQuickBot(context.request, token, `SprBot ${Math.random().toString(36).slice(2, 6)}`)

    // Pre-fire steps 1-4 so the JourneyCard's "first missing step" picker
    // (STEPS.find(s => !completedSteps.includes(s.index))) lands on step 5
    // before the spar runs and step 6 immediately after. Each preceding
    // step has its own dedicated spec; this test's contribution is the
    // step-5 → step-6 transition specifically.
    const patchRes = await context.request.patch(`${BACKEND_URL}/api/v1/guide/preferences`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data:    { journeyProgress: { completedSteps: [1, 2, 3, 4], dismissedAt: null } },
    })
    expect(patchRes.ok()).toBeTruthy()

    // Kick off the spar via API for speed (moveDelayMs: 50). The first
    // spec already proves the Spar Now click path works end-to-end.
    const { slug } = await startSpar(context.request, token, bot.id)
    expect(slug).toBeTruthy()

    // Spectate via the real production URL.
    await page.goto(`/play?join=${slug}&watch=1`)
    await expect(page.getByText(/Table closed due to inactivity/i))
      .toBeHidden({ timeout: 8_000 })

    // Wait for step 5 to credit server-side. With moveDelayMs=50 the spar
    // typically finishes in 1-2s, but allow a generous window for slow CI.
    const completed = await pollForStep(context.request, token, 5, 30_000)
    expect(completed).toEqual(expect.arrayContaining([5]))

    // ── The post-fix assertions ──────────────────────────────────────────
    // The Guide drawer renders as a role="dialog" with accessible name
    // "Guide". Pre-fix, this never appears post-spar because the panel
    // stays closed.
    const guidePanel = page.getByRole('dialog', { name: /^Guide$/i })
    await expect(guidePanel).toBeVisible({ timeout: 15_000 })

    // The step-6 CTA inside the panel — proves the JourneyCard advanced
    // to "Enter Curriculum Cup" once step 5 credited.
    const cupCta = guidePanel.getByRole('link', { name: /Enter Curriculum Cup/i })
    await expect(cupCta).toBeVisible({ timeout: 10_000 })
  })
})
