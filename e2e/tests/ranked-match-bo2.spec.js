// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Ranked match best-of-2 end-to-end (A2 / Connect_Four_Implementation_Plan A2.7).
 *
 * Drives the full BO2 flow from a fresh signed-in user:
 *   1. /play?action=ranked-bot mints a Match + opens game 1 on a private HvB table
 *   2. MatchProgressBanner shows "Best of 2 · Game 1 of 2"
 *   3. After game 1 finishes the server fires match.gameComplete + rematches
 *      the table in place; the banner advances to "Game 2 of 2"
 *   4. After game 2 finishes match.completed fires and MatchCompletePanel
 *      renders with the "Play again" CTA
 *
 * The minimax bot beats a naive "first empty cell" heuristic at easy, so we
 * settle for "game ends — either side wins or draws" as the per-game signal
 * and assert on the banner/panel transitions, not on who won. The match-level
 * ELO update is exercised in the backend unit tests; this spec is about the
 * UI plumbing.
 *
 * Prerequisites:
 *   Landing : http://localhost:5174
 *   Backend : http://localhost:3000
 */

import { test, expect } from '@playwright/test'

const LANDING_URL = process.env.LANDING_URL || 'http://localhost:5174'

const SUBMIT_GUARD_MS = 3500

function freshEmail() {
  const ts = Date.now().toString(36)
  const r  = Math.random().toString(36).slice(2, 8)
  return `ranked+${ts}-${r}@dev.local`
}

function uniqueName(label) {
  return `${label} ${Math.random().toString(36).slice(2, 8)}`
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

const boardLocator = (page) => page.locator('[aria-label="Tic-tac-toe board"]')

/**
 * Click empty cells until the *next* game is signaled — either the match
 * progress banner advances past `currentRound` (game N completed and the
 * server rolled forward to game N+1) or the banner disappears entirely
 * (match-complete = the panel takes over).
 *
 * Per-game terminal statuses ("You win" / "Opponent wins") are wiped
 * within milliseconds by the in-place rematch, so polling them is racy.
 * The banner sequence is the only durable signal that game N has ended.
 *
 * Does not click Rematch — ranked rematches happen server-side.
 */
async function playOneGameToEnd(page, currentRound) {
  const banner = page.getByTestId('match-progress-banner')
  const advanced = () => banner
    .filter({ hasText: new RegExp(`Game (?!${currentRound} )`) })
    .first()

  for (let i = 0; i < 9; i++) {
    // Banner gone (match-complete) or sequence past currentRound → done.
    if (!(await banner.isVisible().catch(() => false))) return
    if (await advanced().isVisible().catch(() => false)) return

    const turn = page.getByText('Your turn')
    try {
      await Promise.race([
        turn.waitFor({ state: 'visible', timeout: 12_000 }),
        advanced().waitFor({ state: 'visible', timeout: 12_000 }),
        banner.waitFor({ state: 'hidden', timeout: 12_000 }),
      ])
    } catch { /* fall through and re-check below */ }

    if (!(await banner.isVisible().catch(() => false))) return
    if (await advanced().isVisible().catch(() => false)) return
    if (!(await turn.isVisible().catch(() => false))) return

    const cells = page.getByRole('button', { name: /^Cell \d+$/ })
    if (await cells.count() === 0) return
    await cells.first().click()
    await page.waitForTimeout(300)
  }
}

test.describe('Ranked best-of-2 — UI plumbing', () => {
  test.setTimeout(180_000)

  test('banner advances Game 1 → Game 2 → MatchCompletePanel', async ({ page }) => {
    await dismissWelcomeOnLoad(page)
    const email    = freshEmail()
    const password = 'ranked-test-pw-1234'
    await signUp(page, { email, password, displayName: uniqueName('Ranked BO2') })

    // Land on the ranked-bot route. Server mints the Match + opens game 1.
    await page.goto('/play?action=ranked-bot')

    // ── Game 1 ────────────────────────────────────────────────────────────
    await boardLocator(page).waitFor({ state: 'visible', timeout: 20_000 })

    const banner = page.getByTestId('match-progress-banner')
    await expect(banner).toBeVisible({ timeout: 5_000 })
    // "Best of 2 · Game 1 of 2"
    await expect(banner).toContainText(/Best of 2/)
    await expect(banner).toContainText(/Game 1 of 2/)

    await playOneGameToEnd(page, 1)

    // ── Game 2 ────────────────────────────────────────────────────────────
    // Server fires match.gameComplete + rematches the table in place.
    // The banner sequence bumps to 2 before the table re-renders the board.
    await expect(banner).toContainText(/Game 2 of 2/, { timeout: 15_000 })
    await boardLocator(page).waitFor({ state: 'visible', timeout: 10_000 })

    await playOneGameToEnd(page, 2)

    // ── Match complete ────────────────────────────────────────────────────
    const panel = page.getByTestId('match-complete-panel')
    await expect(panel).toBeVisible({ timeout: 15_000 })
    await expect(panel.getByRole('link', { name: /play again/i })).toBeVisible()
    await expect(panel.getByRole('link', { name: /done/i })).toBeVisible()
  })
})
