/**
 * Shared helpers for XO Arena E2E tests.
 *
 * Prerequisites — full stack must be running before `npm run test:e2e`:
 *   Frontend : http://localhost:5173
 *   Backend  : http://localhost:3000
 *   Postgres : localhost:5432
 *   Redis    : localhost:6379  (optional — Socket.io falls back to in-memory)
 *
 * Quick start:
 *   docker compose up          # start infra + app
 *   npm run test:e2e           # run Playwright
 */

import { expect } from '@playwright/test'

/**
 * Play through a PvAI game on `page` until it ends (win, AI win, or draw).
 * Returns the end-state text found ('You win', 'AI wins', or 'Draw').
 */
export async function playPvAIToEnd(page) {
  const endTexts = ['You win', 'AI wins', 'Draw']

  for (let i = 0; i < 9; i++) {
    // Check if already over
    for (const txt of endTexts) {
      if (await page.getByText(txt, { exact: false }).isVisible().catch(() => false)) {
        return txt
      }
    }

    // Wait for player's turn then click first available empty cell
    await expect(page.getByText('Your turn')).toBeVisible({ timeout: 10_000 })
    const cells = page.getByRole('button', { name: /^Cell \d+$/ })
    if (await cells.count() === 0) break
    await cells.first().click()
    await page.waitForTimeout(800) // allow AI to respond
  }

  for (const txt of endTexts) {
    if (await page.getByText(txt, { exact: false }).isVisible().catch(() => false)) {
      return txt
    }
  }
  return null
}

/**
 * Navigate to /play and wait for the auto-created room invite URL to appear.
 * Returns the invite URL string.
 */
export async function getInviteUrl(page) {
  await page.goto('/play')
  // The "Invite a Friend" card shows a readonly input once the auto-room is ready
  const input = page.locator('input[readonly]').first()
  await expect(input).not.toHaveValue('', { timeout: 15_000 })
  return input.inputValue()
}

/**
 * Start a PvAI game from /play. Expands the AI panel, selects difficulty and mark,
 * then clicks the start button.
 */
export async function startPvAIGame(page, { difficulty = 'easy', mark = 'X' } = {}) {
  await page.goto('/play')
  // Expand the "Play vs AI" accordion — the toggle button
  await page.locator('button').filter({ hasText: 'Play vs AI' }).first().click()
  await expect(page.getByRole('button', { name: difficulty, exact: true })).toBeVisible()
  await page.getByRole('button', { name: difficulty, exact: true }).click()
  await page.getByRole('button', { name: mark, exact: true }).click()
  // Start button is the one inside the expanded panel with exactly this label
  await page.locator('button').filter({ hasText: /^Play vs AI$/ }).click()
}
