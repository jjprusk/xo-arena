import { test, expect } from '@playwright/test'

/**
 * E2E-01: Full PvAI game flow
 *
 * Requires: frontend running at localhost:5173, backend at localhost:3000
 */

test.describe('PvAI game flow', () => {
  test('can start a game and play moves', async ({ page }) => {
    await page.goto('/play')

    // Select PvAI mode
    await page.getByRole('button', { name: 'vs AI' }).click()

    // Medium difficulty should be default — verify it exists
    await expect(page.getByRole('button', { name: 'medium' })).toBeVisible()

    // Select easy so we can play predictably
    await page.getByRole('button', { name: 'easy' }).click()

    // Play as X (default)
    await page.getByRole('button', { name: 'X', exact: true }).click()

    // Start game
    await page.getByRole('button', { name: 'Play vs AI' }).click()

    // Board should appear
    await expect(page.getByRole('grid', { name: 'Tic-tac-toe board' })).toBeVisible()

    // "Your turn" should be shown (X goes first)
    await expect(page.getByText('Your turn')).toBeVisible()

    // Play cell 1 (top-left)
    await page.getByRole('button', { name: 'Cell 1' }).click()

    // Cell should now show X
    await expect(page.getByRole('button', { name: 'Cell 1, X' })).toBeVisible()

    // Wait for AI response (it will take cell and update board)
    await expect(page.getByText('Your turn')).toBeVisible({ timeout: 10_000 })
  })

  test('shows win state when player wins', async ({ page }) => {
    await page.goto('/play')
    await page.getByRole('button', { name: 'vs AI' }).click()
    await page.getByRole('button', { name: 'easy' }).click()
    await page.getByRole('button', { name: 'Play vs AI' }).click()

    // Force a win by repeatedly playing until one side wins or draws.
    // On easy difficulty AI plays randomly so we may not control outcome —
    // but we can verify the end-game UI appears.
    // Play all available cells (game must end by move 9).
    const maxMoves = 9
    let gameOver = false

    for (let attempt = 0; attempt < maxMoves && !gameOver; attempt++) {
      // Check if game already ended
      const statusText = await page.locator('[style*="font-bold"]').allTextContents()
      if (
        statusText.some((t) => t.includes('win') || t.includes('Win') || t.includes('Draw'))
      ) {
        gameOver = true
        break
      }

      // Find an empty cell and click it
      const cells = page.getByRole('button', { name: /^Cell \d+$/ })
      const count = await cells.count()
      if (count === 0) { gameOver = true; break }
      await cells.first().click()

      // Wait for AI to respond before next move
      await page.waitForTimeout(800)
    }

    // Game must have ended — either win, AI win, or draw message visible
    const endStates = ['You win', 'AI wins', 'Draw', 'Forfeited']
    let found = false
    for (const state of endStates) {
      const el = page.getByText(state, { exact: false })
      if (await el.isVisible().catch(() => false)) { found = true; break }
    }
    expect(found).toBe(true)

    // Rematch and New Game buttons appear
    await expect(page.getByRole('button', { name: 'Rematch' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New Game' })).toBeVisible()
  })

  test('rematch resets the board', async ({ page }) => {
    await page.goto('/play')
    await page.getByRole('button', { name: 'vs AI' }).click()
    await page.getByRole('button', { name: 'easy' }).click()
    await page.getByRole('button', { name: 'Play vs AI' }).click()

    // Play through the game quickly
    for (let i = 0; i < 9; i++) {
      const cells = page.getByRole('button', { name: /^Cell \d+$/ })
      if (await cells.count() === 0) break
      await cells.first().click()
      await page.waitForTimeout(700)
      const rematch = page.getByRole('button', { name: 'Rematch' })
      if (await rematch.isVisible().catch(() => false)) break
    }

    // Click rematch
    await page.getByRole('button', { name: 'Rematch' }).click()

    // Board resets — all cells should be empty again
    await expect(page.getByRole('button', { name: 'Cell 1' })).toBeVisible()
    await expect(page.getByText('Your turn')).toBeVisible()
  })

  test('forfeit ends the game', async ({ page }) => {
    await page.goto('/play')
    await page.getByRole('button', { name: 'vs AI' }).click()
    await page.getByRole('button', { name: 'easy' }).click()
    await page.getByRole('button', { name: 'Play vs AI' }).click()

    // Click forfeit
    await page.getByRole('button', { name: 'Forfeit' }).click()

    // Confirmation dialog
    await expect(page.getByRole('heading', { name: 'Forfeit game?' })).toBeVisible()
    await page.getByRole('button', { name: 'Forfeit' }).last().click()

    // Game ends with forfeit state
    await expect(page.getByText('Forfeited.')).toBeVisible()
  })
})
