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
  test('play a game, then replay it with controls', async ({ page }) => {
    // ── Step 1: Play a PvAI game to completion ──────────────────────────────

    // Intercept the game record response to capture the game ID
    let gameId = null
    page.on('response', async (response) => {
      if (response.url().includes('/api/games/record') && response.request().method() === 'POST') {
        try {
          const body = await response.json()
          if (body?.game?.id) gameId = body.game.id
        } catch { /* ignore parse errors */ }
      }
    })

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
