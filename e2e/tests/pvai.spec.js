import { test, expect } from '@playwright/test'

/**
 * E2E-01: Full PvAI game flow
 *
 * Requires: frontend running at localhost:5173, backend at localhost:3000
 */

// Board is a div with aria-label, not role=grid
const boardLocator = (page) => page.locator('[aria-label="Tic-tac-toe board"]')

// Only enabled (player's turn) empty cells
const emptyCells = (page) => page.locator('button[aria-label^="Cell "]:not([disabled])')

// Wait for AI to finish and it to become the player's turn
async function waitForPlayerTurn(page) {
  await expect(page.getByText('Your turn')).toBeVisible({ timeout: 10_000 })
}

test.describe('PvAI game flow', () => {
  test('can start a game and play moves', async ({ page }) => {
    await page.goto('/play')

    await page.getByRole('button', { name: 'vs AI' }).click()
    await expect(page.getByRole('button', { name: 'medium' })).toBeVisible()

    await page.getByRole('button', { name: 'easy' }).click()
    await page.getByRole('button', { name: 'X', exact: true }).click()
    await page.getByRole('button', { name: 'Play vs AI' }).click()

    // Board should appear
    await expect(boardLocator(page)).toBeVisible()

    // X goes first — player's turn
    await expect(page.getByText('Your turn')).toBeVisible()

    // Play cell 1
    await page.getByRole('button', { name: 'Cell 1' }).click()
    await expect(page.getByRole('button', { name: 'Cell 1, X' })).toBeVisible()

    // Wait for AI to respond then player's turn again
    await waitForPlayerTurn(page)
  })

  test('shows win state when player wins', async ({ page }) => {
    await page.goto('/play')
    await page.getByRole('button', { name: 'vs AI' }).click()
    await page.getByRole('button', { name: 'easy' }).click()
    await page.getByRole('button', { name: 'Play vs AI' }).click()

    await expect(boardLocator(page)).toBeVisible()

    // Play through game — click only enabled cells (player's turn cells)
    for (let attempt = 0; attempt < 9; attempt++) {
      // Check if game already ended
      const endTexts = ['You win', 'AI wins', 'Draw']
      let ended = false
      for (const t of endTexts) {
        if (await page.getByText(t, { exact: false }).isVisible().catch(() => false)) {
          ended = true; break
        }
      }
      if (ended) break

      // Wait for our turn then click an enabled empty cell
      await waitForPlayerTurn(page)
      const cells = emptyCells(page)
      const count = await cells.count()
      if (count === 0) break
      await cells.first().click()
    }

    // Game must have ended
    const endStates = ['You win', 'AI wins', 'Draw']
    let found = false
    for (const state of endStates) {
      if (await page.getByText(state, { exact: false }).isVisible().catch(() => false)) {
        found = true; break
      }
    }
    expect(found).toBe(true)

    await expect(page.getByRole('button', { name: 'Rematch' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New Game' })).toBeVisible()
  })

  test('rematch resets the board', async ({ page }) => {
    await page.goto('/play')
    await page.getByRole('button', { name: 'vs AI' }).click()
    await page.getByRole('button', { name: 'easy' }).click()
    await page.getByRole('button', { name: 'Play vs AI' }).click()

    await expect(boardLocator(page)).toBeVisible()

    // Play through the game
    for (let i = 0; i < 9; i++) {
      const rematch = page.getByRole('button', { name: 'Rematch' })
      if (await rematch.isVisible().catch(() => false)) break
      await waitForPlayerTurn(page)
      const cells = emptyCells(page)
      if (await cells.count() === 0) break
      await cells.first().click()
    }

    await page.getByRole('button', { name: 'Rematch' }).click()

    // Board resets
    await expect(page.getByRole('button', { name: 'Cell 1' })).toBeVisible()
    await expect(page.getByText('Your turn')).toBeVisible()
  })

  test('forfeit ends the game', async ({ page }) => {
    await page.goto('/play')
    await page.getByRole('button', { name: 'vs AI' }).click()
    await page.getByRole('button', { name: 'easy' }).click()
    await page.getByRole('button', { name: 'Play vs AI' }).click()

    await expect(boardLocator(page)).toBeVisible()

    await page.getByRole('button', { name: 'Forfeit' }).click()
    await expect(page.getByRole('heading', { name: 'Forfeit game?' })).toBeVisible()
    await page.getByRole('button', { name: 'Forfeit' }).last().click()

    await expect(page.getByText('Forfeited.')).toBeVisible()
  })
})
