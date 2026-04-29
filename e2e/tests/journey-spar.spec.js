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
})
