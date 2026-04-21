import { test, expect } from '@playwright/test'
import { startPvAIGame, playPvAIToEnd } from './helpers.js'

/**
 * E2E-05: Replay a completed XO game end-to-end
 *
 * Plays a PvAI game to completion on the frontend, captures the game ID
 * from the record API response, then navigates to /replay/:id on the landing
 * app and verifies the replay controls are functional.
 *
 * Requires: full stack running (frontend :5173, landing :5174, backend :3000)
 */

const LANDING_URL = process.env.LANDING_URL || 'http://localhost:5174'
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000'

test.describe('Replay end-to-end', () => {
  // Phase 3 removed the client-initiated POST /api/games/record that this
  // test used to intercept — PvAI games are now recorded server-side only
  // (socketHandler.recordPvpGame), and the ID is never surfaced to the
  // guest client. Capturing it again requires signing in (qa-user) and
  // querying /api/v1/users/me/games?limit=1 after the match ends. Rewrite
  // deferred; see helpers.js for the shape to adopt.
  test.skip('play a game, then replay it with controls', async ({ page }) => {
    // ── Step 1: Play a PvAI game to completion ──────────────────────────────

    let gameId = null

    await startPvAIGame(page, { difficulty: 'novice', mark: 'X' })
    await expect(page.locator('[aria-label="Tic-tac-toe board"]')).toBeVisible()

    await playPvAIToEnd(page)

    // Wait for the record API call to complete and capture the ID
    await page.waitForTimeout(2000)

    expect(gameId, 'Game ID should be returned from /api/games/record').toBeTruthy()

    // ── Step 2: Navigate to the replay page ─────────────────────────────────

    await page.goto(`${LANDING_URL}/replay/${gameId}`)

    // ── Step 3: Verify replay controls are present ──────────────────────────

    // The board should appear (via lazy-loaded XO game component)
    await expect(page.locator('[aria-label="Tic-tac-toe board"]')).toBeVisible({ timeout: 15_000 })

    // Replay controls panel should be visible
    const scrubber = page.locator('input[type="range"]')
    await expect(scrubber).toBeVisible()

    // Play/pause button — shows ▶ initially (not playing)
    const playPauseBtn = page.locator('button').filter({ hasText: /▶|⏸/ }).first()
    await expect(playPauseBtn).toBeVisible()

    // Speed buttons (0.5×, 1×, 2×) should all be present
    await expect(page.locator('button').filter({ hasText: '1×' })).toBeVisible()
    await expect(page.locator('button').filter({ hasText: '2×' })).toBeVisible()

    // ── Step 4: Exercise step forward / step back ────────────────────────────

    // Scrubber starts at 0 (move 0)
    const initialValue = await scrubber.inputValue()
    expect(Number(initialValue)).toBe(0)

    // Click step forward — scrubber should advance
    await page.locator('button[title="Step forward"]').click()
    const afterStep = await scrubber.inputValue()
    expect(Number(afterStep)).toBeGreaterThan(0)

    // Click step back — scrubber should retreat
    await page.locator('button[title="Step back"]').click()
    const afterBack = await scrubber.inputValue()
    expect(Number(afterBack)).toBe(0)

    // ── Step 5: Exercise play / pause ────────────────────────────────────────

    // Click play — button should switch to pause icon
    await playPauseBtn.click()
    await expect(page.locator('button').filter({ hasText: '⏸' })).toBeVisible({ timeout: 3_000 })

    // Click pause
    await page.locator('button').filter({ hasText: '⏸' }).click()
    await expect(page.locator('button').filter({ hasText: '▶' }).first()).toBeVisible()
  })

  test('shows error state for unknown game ID', async ({ page }) => {
    await page.goto(`${LANDING_URL}/replay/nonexistent-game-id-12345`)

    // Should show not-found or error message — not a loading spinner
    await expect(page.locator('text=Game not found').or(page.locator('text=not found').or(page.locator('text=Failed to load'))))
      .toBeVisible({ timeout: 10_000 })
  })
})
