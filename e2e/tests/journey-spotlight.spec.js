// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Journey CTA spotlight — verifies that the reusable <Spotlight /> overlay
 * actually fires on the journey-step destinations.
 *
 * The journey routes the user to `/profile?action=<step>`. ProfilePage
 * forwards to `/bots/<id>?action=<step>` (single-bot case). BotProfilePage's
 * effect picks up the action= query and lights the matching CTA via the
 * shared <Spotlight /> component.
 *
 * Without an end-to-end check, every regression in this chain is silent:
 *   - ProfilePage forgets to forward a new action shape
 *   - BotProfilePage's effect doesn't recognise the action
 *   - <Spotlight> stops rendering the scrim or applying the pulse class
 *   - CSS class names get refactored without updating component callers
 *
 * Coverage: step 4 (`?action=train-bot`) + step 5 (`?action=spar`) — the
 * two destinations actually wired today. Steps 3 / 6 / 7 are documented
 * in `doc/Future_Ideas.md` as awaiting destination handlers.
 *
 * Prereqs:
 *   Frontend (landing) : http://localhost:5174
 *   Backend            : http://localhost:3000
 */

import { test, expect } from '@playwright/test'
import { fetchAuthToken } from './helpers.js'
import { netCleanupByEmailPrefix } from './dbScript.js'

const LANDING_URL   = process.env.LANDING_URL || 'http://localhost:5174'
const EMAIL_PREFIX  = 'spt+'
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
  const res = await request.post(`${LANDING_URL}/api/v1/bots/quick`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data:    { name: displayName, persona: 'aggressive' },
  })
  if (!res.ok()) throw new Error(`bots/quick failed: ${res.status()}`)
  return (await res.json()).bot
}

test.describe('Journey CTA spotlight', () => {
  test.setTimeout(120_000)

  test.afterAll(() => {
    netCleanupByEmailPrefix(EMAIL_PREFIX, { tag: 'spt-after' })
  })

  test('step 4 + step 5 light the matching CTA on /bots/:id', async ({ page, context }) => {
    page.on('pageerror', (err) => console.log(`[browser:error] ${err.message}`))

    await dismissWelcomeOnLoad(page)
    const email       = freshEmail()
    const password    = 'spt-test-pw-1234'
    const displayName = `Spt ${Math.random().toString(36).slice(2, 8)}`
    await signUp(page, { email, password, displayName })

    const token = await fetchAuthToken(context.request, LANDING_URL)
    const bot = await createQuickBot(context.request, token, `SptBot ${Math.random().toString(36).slice(2, 6)}`)

    // ── Step 4: ?action=train-bot ────────────────────────────────────────
    // ProfilePage forwards single-bot users to /bots/<id>?action=<action>;
    // we hit the /profile entry point so the forwarding gets exercised end
    // to end (a regression there is the most common breakage shape).
    await page.goto('/profile?action=train-bot')
    await page.waitForURL(/\/bots\/[^/?]+\?action=train-bot/, { timeout: 10_000 })

    const trainBtn = page.getByRole('button', { name: /train your bot/i })
    await expect(trainBtn).toBeVisible({ timeout: 10_000 })
    await expect(trainBtn).toHaveClass(/xo-spotlight-pulse/, { timeout: 6_000 })
    // Regression guard: the dimming-scrim was removed from <Spotlight> in
    // favour of pulse-only since the bot detail page has too much context
    // for a full-page dim. If a refactor reintroduces it, this fails.
    await expect(page.locator('.xo-spotlight-scrim')).toHaveCount(0)

    // ── Step 5: ?action=spar ─────────────────────────────────────────────
    await page.goto('/profile?action=spar')
    await page.waitForURL(/\/bots\/[^/?]+\?action=spar/, { timeout: 10_000 })

    const sparBtn = page.getByRole('button', { name: /^spar now$/i })
    await expect(sparBtn).toBeVisible({ timeout: 10_000 })
    await expect(sparBtn).toHaveClass(/xo-spotlight-pulse/, { timeout: 6_000 })
    await expect(page.locator('.xo-spotlight-scrim')).toHaveCount(0)
  })

  test('a non-spotlight URL leaves the bot page un-lit', async ({ page, context }) => {
    // Smoke check that the spotlight only fires for the recognised actions
    // — landing on the bot page directly must not pulse anything.
    await dismissWelcomeOnLoad(page)
    const email       = freshEmail()
    const password    = 'spt-test-pw-1234'
    const displayName = `Spt2 ${Math.random().toString(36).slice(2, 8)}`
    await signUp(page, { email, password, displayName })
    const token = await fetchAuthToken(context.request, LANDING_URL)
    const bot = await createQuickBot(context.request, token, `SptBot2 ${Math.random().toString(36).slice(2, 6)}`)

    await page.goto(`/bots/${bot.id}`)
    const trainBtn = page.getByRole('button', { name: /train your bot/i })
    await expect(trainBtn).toBeVisible({ timeout: 10_000 })
    // Nothing in the URL → no spotlight class, no scrim.
    await expect(trainBtn).not.toHaveClass(/xo-spotlight-pulse/)
    await expect(page.locator('.xo-spotlight-scrim')).toHaveCount(0)
  })
})
