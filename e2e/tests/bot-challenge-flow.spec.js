// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Bot Challenge & Discovery — guest-path regression suite.
 *
 * The plan (doc/Bot_Challenge_Plan.md) treats the guest-friendly path as
 * load-bearing: every challenge surface must work for an unauthenticated
 * visitor (anonymous SSE seat → /rt/tables hvb → /play?join=<slug>).
 *
 * This spec covers the four guest entry points:
 *   1. /bots directory  → row challenge icon
 *   2. /bots/:id profile → Challenge section button
 *   3. /              home → Quick Match button (exercises /api/v1/bots/quick-match anonymous)
 *   4. /rankings        → bot row Play column challenge icon
 *
 * The create-table picker (Phase C.1) requires sign-in to open, so its
 * vitest coverage stands in for an e2e here.
 *
 * Lives in the QA suite — runs with `cd e2e && npm test`, not in the smoke
 * subset that gates every deploy.
 */
import { test, expect } from '@playwright/test'

const boardLocator = (page) => page.locator('[aria-label="Tic-tac-toe board"]')

// Pre-dismiss the first-visit guest welcome modal so it doesn't overlay
// the board on a fresh Playwright context (same trick startPvAIGame uses).
// Also pre-flip the rankings "show bots" toggle — guests default to off,
// which hides every challenge-button row on /rankings.
async function dismissGuestWelcome(page) {
  await page.addInitScript(() => {
    try {
      window.localStorage?.setItem('aiarena_guest_welcome_seen', '1')
      window.localStorage?.setItem('xo-leaderboard-show-bots', 'true')
    } catch {}
  })
}

async function expectLandedOnPlayBoard(page) {
  await expect(page).toHaveURL(/\/play\?join=/, { timeout: 15_000 })
  await expect(boardLocator(page)).toBeVisible({ timeout: 15_000 })
}

// Best-effort cleanup — Forfeit/Leave fire a server event that closes the
// hvb table synchronously, so the next test's table-create doesn't race.
async function cleanupTable(page) {
  try {
    if (!page.url().includes('/play')) return
    const leave = page.getByRole('button', { name: 'Leave Table' })
    if (await leave.isVisible().catch(() => false)) {
      await leave.click({ timeout: 2_000 }).catch(() => {})
      return
    }
    const forfeit = page.getByRole('button', { name: 'Forfeit' })
    if (await forfeit.isVisible().catch(() => false)) {
      await forfeit.click({ timeout: 2_000 }).catch(() => {})
      const confirm = page.getByRole('button', { name: 'Forfeit' }).last()
      await confirm.click({ timeout: 2_000 }).catch(() => {})
    }
  } catch { /* best-effort */ }
}

test.describe('Bot Challenge — guest entry points', () => {
  test.beforeEach(async ({ page }) => {
    await dismissGuestWelcome(page)
  })

  test.afterEach(async ({ page }) => {
    await cleanupTable(page)
  })

  test('/bots directory: guest can challenge the first listed bot', async ({ page }) => {
    await page.goto('/bots')
    // Wait for at least one bot row to render (built-in bots are seeded).
    await page.locator('[data-testid^="bot-directory-row-"]').first()
      .waitFor({ state: 'visible', timeout: 15_000 })
    await expect(page.getByTestId('bot-directory-guest-ribbon')).toBeVisible()

    const challengeBtn = page.getByTestId('challenge-button').first()
    await challengeBtn.click()

    await expectLandedOnPlayBoard(page)
  })

  test('/bots/:id profile: guest can challenge the bot from the profile page', async ({ page }) => {
    await page.goto('/bots')
    const firstRow = page.locator('[data-testid^="bot-directory-row-"]').first()
    await firstRow.waitFor({ state: 'visible', timeout: 15_000 })
    await firstRow.click()

    // We're now on /bots/:id — the Challenge section is visible to all viewers.
    await expect(page.getByTestId('bot-profile-challenge')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('bot-profile-challenge')
      .getByTestId('challenge-button')
      .click()

    await expectLandedOnPlayBoard(page)
  })

  test('home Quick Match: guest gets paired with a real bot and lands on the board', async ({ page }) => {
    await page.goto('/')
    const qm = page.getByTestId('quick-match-button')
    await qm.waitFor({ state: 'visible', timeout: 15_000 })
    await qm.click()

    await expectLandedOnPlayBoard(page)
  })

  // HomePage's "Play against a bot" CTA exercises the single-shot
  // `POST /api/v1/play/bot` collapse (Future_Ideas PlayVsBot CTA item 3).
  // The test pins the *structural* shape of the chain: exactly one /play/bot
  // POST, zero POSTs to the legacy /rt/tables create. If a regression sends
  // us back through the old chain, the assertion fires before the perf
  // numbers ever flag it.
  test('home "Play against a bot": exactly one POST /play/bot, zero /rt/tables creates', async ({ page }) => {
    const apiCalls = []
    page.on('request', req => {
      const url = req.url()
      const method = req.method()
      if (method !== 'POST') return
      if (/\/api\/v1\/play\/bot\b/.test(url))                  apiCalls.push('play-bot')
      else if (/\/api\/v1\/rt\/tables(\?|$)/.test(url))        apiCalls.push('rt-tables-create')
      else if (/\/api\/v1\/rt\/tables\/[^/]+\/join/.test(url)) apiCalls.push('rt-tables-join')
    })

    await page.goto('/')
    // The "Play against a bot" CTA is rendered as a Link (single render — no
    // tab/journey toggling), so a name-based locator is stable.
    const cta = page.getByRole('link', { name: /Play against a bot/i }).first()
    await cta.waitFor({ state: 'visible', timeout: 15_000 })
    await cta.click()

    // The collapsed flow keeps the URL on /play?action=vs-community-bot —
    // no `?join=<slug>` redirect since the table id is delivered in the
    // single-shot response.
    await expect(page).toHaveURL(/\/play\?action=vs-community-bot/, { timeout: 15_000 })
    await expect(boardLocator(page)).toBeVisible({ timeout: 15_000 })

    // Structural assertions: one /play/bot POST replaces the entire
    // /rt/tables create + join chain.
    const playBotPosts        = apiCalls.filter(k => k === 'play-bot').length
    const rtTablesCreatePosts = apiCalls.filter(k => k === 'rt-tables-create').length
    const rtTablesJoinPosts   = apiCalls.filter(k => k === 'rt-tables-join').length
    expect(playBotPosts).toBe(1)
    expect(rtTablesCreatePosts).toBe(0)
    expect(rtTablesJoinPosts).toBe(0)
  })

  test('/rankings: guest can challenge a bot row via the Play column', async ({ page, request }) => {
    // The leaderboard surfaces every historical bot — including ones
    // since deactivated — so picking "first row" is non-deterministic
    // on a long-lived dev DB. Pin to an *active* bot from the canonical
    // /api/v1/bots list (which the directory page also uses); that's
    // the bot population /rt/tables hvb actually accepts.
    const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:3000'
    const [botsRes, lbRes] = await Promise.all([
      request.get(`${backendUrl}/api/v1/bots`),
      request.get(`${backendUrl}/api/v1/leaderboard?period=all&mode=ALL&includeBots=true`),
    ])
    const { bots: activeBots = [] } = await botsRes.json()
    const { leaderboard = [] }      = await lbRes.json()
    const activeIds  = new Set(activeBots.map(b => b.id))
    const targetBotId = leaderboard.find(e => e.user.isBot && activeIds.has(e.user.id))?.user.id
    if (!targetBotId) test.skip(true, 'no active bot is on the leaderboard — skip')

    await page.goto('/rankings')
    // Look for the challenge button whose aria-label matches our target.
    const challengeBtn = page.locator(
      `[data-testid="challenge-button"][aria-label="Challenge ${targetBotId}"]`,
    )
    await challengeBtn.waitFor({ state: 'visible', timeout: 15_000 })
    await challengeBtn.click()

    await expectLandedOnPlayBoard(page)
  })
})
