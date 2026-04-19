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
 *
 * Requires: backend running at localhost:3000 (via docker compose or directly).
 * If "Creating room…" persists and this times out, the backend socket is unavailable.
 */
export async function getInviteUrl(page) {
  await page.goto('/play')
  // The "Invite a Friend" card shows a readonly input once the auto-room is ready.
  // Wait for the element to appear first (clearer timeout message than .not.toHaveValue).
  const input = page.locator('input[readonly]').first()
  await input.waitFor({ state: 'visible', timeout: 15_000 })
  return input.inputValue()
}

/**
 * Sign in a user via the BetterAuth email endpoint and store the session in the
 * page's browser context. Subsequent page.goto() calls will be authenticated.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} email
 * @param {string} password
 * @param {string} backendUrl  e.g. 'http://localhost:3000'
 */
export async function signIn(page, email, password, backendUrl) {
  const res = await page.context().request.post(`${backendUrl}/api/auth/sign-in/email`, {
    data: { email, password },
  })
  if (!res.ok()) {
    const body = await res.text().catch(() => '')
    throw new Error(`Sign-in failed (${res.status()}): ${body}`)
  }
}

// Map legacy difficulty names to current select values
const DIFFICULTY_MAP = { easy: 'novice', medium: 'intermediate', hard: 'advanced', novice: 'novice', intermediate: 'intermediate', advanced: 'advanced', master: 'master' }

/**
 * Start a PvAI game from /play. Expands the AI panel, selects difficulty and mark,
 * then clicks the start button.
 */
export async function startPvAIGame(page, { difficulty = 'novice', mark = 'X' } = {}) {
  await page.goto('/play')
  // Expand the "Play vs AI" accordion
  await page.locator('button').filter({ hasText: 'Play vs AI' }).first().click()
  // Wait for the difficulty select to appear (Minimax tab is default)
  const difficultySelect = page.locator('select').filter({ has: page.locator('option[value="novice"]') })
  await difficultySelect.waitFor({ state: 'visible' })
  await difficultySelect.selectOption(DIFFICULTY_MAP[difficulty] ?? difficulty)
  // Select mark (X / O / alternate)
  await page.getByRole('button', { name: mark, exact: true }).click()
  // Click the "Play vs AI" start button inside the expanded panel
  await page.locator('button').filter({ hasText: /^Play vs AI$/ }).click()
}
