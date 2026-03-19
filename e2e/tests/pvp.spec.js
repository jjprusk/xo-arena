import { test, expect } from '@playwright/test'

/**
 * E2E-02: Full PvP game flow
 * E2E-03: Spectator flow
 *
 * Uses two (or three) browser contexts to simulate multiple players/spectators.
 * Requires: frontend at localhost:5173, backend at localhost:3000 (with Redis).
 */

test.describe('PvP game flow', () => {
  test('host creates room and guest joins via invite link', async ({ browser }) => {
    const hostCtx = await browser.newContext()
    const guestCtx = await browser.newContext()
    const hostPage = await hostCtx.newPage()
    const guestPage = await guestCtx.newPage()

    try {
      // Host: create room
      await hostPage.goto('/play')
      await hostPage.getByRole('button', { name: 'vs Player' }).click()
      await hostPage.getByRole('button', { name: 'Create Room' }).click()

      // Host sees lobby with room name and invite link
      await expect(hostPage.getByText('Your room')).toBeVisible()
      await expect(hostPage.getByText('Waiting for opponent…')).toBeVisible()

      // Extract invite URL from the readonly input
      const inviteInput = hostPage.locator('input[readonly]')
      await expect(inviteInput).toBeVisible()
      const inviteUrl = await inviteInput.inputValue()
      expect(inviteUrl).toContain('/play?join=mt-')

      // Guest: navigate to invite link
      await guestPage.goto(inviteUrl)

      // Both should transition to the game board
      await expect(hostPage.getByRole('grid', { name: 'Tic-tac-toe board' })).toBeVisible({ timeout: 10_000 })
      await expect(guestPage.getByRole('grid', { name: 'Tic-tac-toe board' })).toBeVisible({ timeout: 10_000 })

      // One side shows "Your turn", the other "Opponent's turn"
      const hostTurn = await hostPage.getByText("Your turn").isVisible().catch(() => false)
      const guestTurn = await guestPage.getByText("Your turn").isVisible().catch(() => false)
      expect(hostTurn || guestTurn).toBe(true)
      expect(hostTurn && guestTurn).toBe(false) // only one player goes first
    } finally {
      await hostCtx.close()
      await guestCtx.close()
    }
  })

  test('players can make moves and game reaches a conclusion', async ({ browser }) => {
    const hostCtx = await browser.newContext()
    const guestCtx = await browser.newContext()
    const hostPage = await hostCtx.newPage()
    const guestPage = await guestCtx.newPage()

    try {
      // Setup room
      await hostPage.goto('/play')
      await hostPage.getByRole('button', { name: 'vs Player' }).click()
      await hostPage.getByRole('button', { name: 'Create Room' }).click()
      await expect(hostPage.getByText('Waiting for opponent…')).toBeVisible()

      const inviteUrl = await hostPage.locator('input[readonly]').inputValue()
      await guestPage.goto(inviteUrl)

      // Wait for both to see the board
      await expect(hostPage.getByRole('grid', { name: 'Tic-tac-toe board' })).toBeVisible({ timeout: 10_000 })
      await expect(guestPage.getByRole('grid', { name: 'Tic-tac-toe board' })).toBeVisible({ timeout: 10_000 })

      // Play alternating moves until game ends (max 9 moves)
      const pages = [hostPage, guestPage]
      const endTexts = ['You win', 'Opponent wins', 'Draw']

      for (let move = 0; move < 9; move++) {
        // Find whose turn it is
        let activePage = null
        for (const p of pages) {
          if (await p.getByText('Your turn').isVisible().catch(() => false)) {
            activePage = p
            break
          }
        }
        if (!activePage) break

        // Click an empty cell
        const emptyCells = activePage.getByRole('button', { name: /^Cell \d+$/ })
        const count = await emptyCells.count()
        if (count === 0) break
        await emptyCells.first().click()

        // Wait for move to propagate to both browsers
        await hostPage.waitForTimeout(400)

        // Check if game ended on either page
        let ended = false
        for (const p of pages) {
          for (const txt of endTexts) {
            if (await p.getByText(txt, { exact: false }).isVisible().catch(() => false)) {
              ended = true
              break
            }
          }
          if (ended) break
        }
        if (ended) break
      }

      // Verify game concluded — both pages should see result + Rematch button
      for (const p of pages) {
        await expect(p.getByRole('button', { name: 'Rematch' })).toBeVisible({ timeout: 5_000 })
      }
    } finally {
      await hostCtx.close()
      await guestCtx.close()
    }
  })

  test('host can cancel the room before guest joins', async ({ page }) => {
    await page.goto('/play')
    await page.getByRole('button', { name: 'vs Player' }).click()
    await page.getByRole('button', { name: 'Create Room' }).click()

    await expect(page.getByText('Waiting for opponent…')).toBeVisible()

    // Cancel
    await page.getByRole('button', { name: 'Cancel room' }).click()

    // Returns to mode selection
    await expect(page.getByRole('button', { name: 'vs AI' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'vs Player' })).toBeVisible()
  })
})

test.describe('Spectator flow', () => {
  test('spectator can join an active game and see moves', async ({ browser }) => {
    const hostCtx = await browser.newContext()
    const guestCtx = await browser.newContext()
    const spectatorCtx = await browser.newContext()
    const hostPage = await hostCtx.newPage()
    const guestPage = await guestCtx.newPage()
    const spectatorPage = await spectatorCtx.newPage()

    try {
      // Host creates room
      await hostPage.goto('/play')
      await hostPage.getByRole('button', { name: 'vs Player' }).click()
      await hostPage.getByRole('button', { name: 'Create Room' }).click()
      await expect(hostPage.getByText('Waiting for opponent…')).toBeVisible()

      const inviteUrl = await hostPage.locator('input[readonly]').inputValue()

      // Guest joins
      await guestPage.goto(inviteUrl)
      await expect(hostPage.getByRole('grid', { name: 'Tic-tac-toe board' })).toBeVisible({ timeout: 10_000 })

      // Spectator also navigates to the same invite URL
      await spectatorPage.goto(inviteUrl)
      await expect(spectatorPage.getByRole('grid', { name: 'Tic-tac-toe board' })).toBeVisible({ timeout: 10_000 })

      // Spectator badge should appear
      await expect(spectatorPage.getByText('Spectating')).toBeVisible()

      // Board cells should be disabled for the spectator (cannot play)
      const spectatorCell = spectatorPage.getByRole('button', { name: 'Cell 1' })
      await expect(spectatorCell).toBeDisabled()

      // Host/guest see spectator count ≥ 1
      // (spectator count badge: "👁 1")
      await expect(hostPage.getByText(/👁/)).toBeVisible({ timeout: 5_000 })

      // Make a move as the active player — spectator should see it
      for (const p of [hostPage, guestPage]) {
        if (await p.getByText('Your turn').isVisible().catch(() => false)) {
          await p.getByRole('button', { name: 'Cell 5' }).click()
          break
        }
      }

      // Spectator sees the move (Cell 5 should now show a mark)
      await expect(spectatorPage.getByRole('button', { name: /Cell 5, [XO]/ })).toBeVisible({ timeout: 5_000 })
    } finally {
      await hostCtx.close()
      await guestCtx.close()
      await spectatorCtx.close()
    }
  })
})
