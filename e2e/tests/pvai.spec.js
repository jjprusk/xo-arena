import { test, expect } from '@playwright/test'
import { startPvAIGame, playPvAIToEnd } from './helpers.js'

/**
 * E2E-01: Full PvAI game flow
 *
 * Requires: frontend running at localhost:5173, backend at localhost:3000
 */

const boardLocator = (page) => page.locator('[aria-label="Tic-tac-toe board"]')

test.describe('PvAI game flow', () => {
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

  test('shows win state when player wins', async ({ page }) => {
    await startPvAIGame(page, { difficulty: 'easy', mark: 'X' })
    await expect(boardLocator(page)).toBeVisible()

    const result = await playPvAIToEnd(page)
    expect(result).not.toBeNull()

    await expect(page.getByRole('button', { name: 'Rematch' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New Game' })).toBeVisible()
  })

  test('rematch resets the board', async ({ page }) => {
    await startPvAIGame(page, { difficulty: 'easy', mark: 'X' })
    await expect(boardLocator(page)).toBeVisible()

    await playPvAIToEnd(page)

    await page.getByRole('button', { name: 'Rematch' }).click()

    // Board resets — all cells empty and player's turn
    await expect(page.getByRole('button', { name: 'Cell 1' })).toBeVisible()
    await expect(page.getByText('Your turn')).toBeVisible()
  })

  test('forfeit ends the game', async ({ page }) => {
    await startPvAIGame(page, { difficulty: 'easy', mark: 'X' })
    await expect(boardLocator(page)).toBeVisible()

    await page.getByRole('button', { name: 'Forfeit' }).click()
    await expect(page.getByRole('heading', { name: 'Forfeit game?' })).toBeVisible()
    await page.getByRole('button', { name: 'Forfeit' }).last().click()

    await expect(page.getByText('Forfeited.')).toBeVisible()
  })

  test('new game returns to mode selection', async ({ page }) => {
    await startPvAIGame(page, { difficulty: 'easy', mark: 'X' })
    await expect(boardLocator(page)).toBeVisible()

    await playPvAIToEnd(page)

    await page.getByRole('button', { name: 'New Game' }).click()

    // Mode selection is visible again — Play vs AI accordion toggle
    await expect(page.locator('button').filter({ hasText: 'Play vs AI' }).first()).toBeVisible()
  })
})
