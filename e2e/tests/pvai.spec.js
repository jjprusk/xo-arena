import { test, expect } from '@playwright/test'
import { startPvAIGame, playPvAIToEnd } from './helpers.js'

/**
 * E2E-01: Full PvAI game flow
 *
 * Requires: frontend running at localhost:5173, backend at localhost:3000
 */

const boardLocator = (page) => page.locator('[aria-label="Tic-tac-toe board"]')

test.describe('PvAI game flow', () => {
  // Each test creates a guest HvB table that the server keeps around (so
  // Rematch works in-session). At the end of the test we explicitly close
  // that table so the next test's `room:create:hvb` doesn't have to race
  // the prior table's lingering cleanup. Clicking Leave Table / confirming
  // Forfeit both emit the socket event that the server handles
  // synchronously — much more deterministic than relying on page.close
  // → socket.disconnect → backend housekeeping timing.
  test.afterEach(async ({ page }) => {
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
        // Confirm in the dialog (second Forfeit button inside).
        const confirm = page.getByRole('button', { name: 'Forfeit' }).last()
        await confirm.click({ timeout: 2_000 }).catch(() => {})
      }
    } catch { /* best-effort */ }
  })

  test('can start a game and play moves', async ({ page }) => {
    await startPvAIGame(page, { difficulty: 'easy', mark: 'X' })

    // Board should appear
    await expect(boardLocator(page)).toBeVisible()

    // X goes first — player's turn
    await expect(page.getByText('Your turn')).toBeVisible()

    // Play cell 1
    await page.getByRole('button', { name: 'Cell 1' }).click()
    await expect(page.getByRole('button', { name: 'Cell 1, X' })).toBeVisible()

    // Wait for AI to respond then player's turn again
    await expect(page.getByText('Your turn')).toBeVisible({ timeout: 10_000 })
  })

  test('shows end state with a Rematch button', async ({ page }) => {
    await startPvAIGame(page, { difficulty: 'easy', mark: 'X' })
    await expect(boardLocator(page)).toBeVisible()

    const result = await playPvAIToEnd(page)
    expect(result).not.toBeNull()

    // "New Game" was removed in Phase 3.4 — the game ends with Rematch only;
    // leaving a finished game happens via the back button in the nav chrome.
    await expect(page.getByRole('button', { name: 'Rematch' })).toBeVisible()
  })

  test('rematch resets the board', async ({ page }) => {
    await startPvAIGame(page, { difficulty: 'easy', mark: 'X' })
    await expect(boardLocator(page)).toBeVisible()

    await playPvAIToEnd(page)

    const rematchBtn = page.getByRole('button', { name: 'Rematch' })
    await rematchBtn.click()

    // Rematch is async: the client briefly unmounts the XOGame while the
    // session transitions from 'finished' through 'waiting' back to 'playing'
    // for the new game. The board reappears once the server confirms the
    // fresh state. Marks alternate, so round 2 may start with the bot to
    // move — give "Your turn" generous headroom for the bot move + network
    // round trips on a cold dev stack.
    await expect(rematchBtn).toBeHidden({ timeout: 10_000 })
    await expect(boardLocator(page)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Your turn')).toBeVisible({ timeout: 15_000 })
  })

  test('forfeit ends the game', async ({ page }) => {
    await startPvAIGame(page, { difficulty: 'easy', mark: 'X' })
    await expect(boardLocator(page)).toBeVisible()

    await page.getByRole('button', { name: 'Forfeit' }).click()
    await expect(page.getByRole('heading', { name: 'Forfeit game?' })).toBeVisible()
    await page.getByRole('button', { name: 'Forfeit' }).last().click()

    // Post-forfeit: the server marks the opponent (bot) as the winner;
    // the GameComponent renders "Opponent wins!" instead of the legacy
    // "Forfeited." banner removed in Phase 3.4.
    await expect(page.getByText(/Opponent wins!?/i)).toBeVisible()
  })
})
