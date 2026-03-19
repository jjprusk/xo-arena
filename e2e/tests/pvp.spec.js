import { test, expect } from '@playwright/test'

/**
 * E2E-02: Full PvP game flow
 * E2E-03: Spectator flow
 *
 * Uses two (or three) browser contexts to simulate multiple players/spectators.
 * Requires: frontend at localhost:5173, backend at localhost:3000 (with Redis).
 */

const boardLocator = (page) => page.locator('[aria-label="Tic-tac-toe board"]')
const emptyCells = (page) => page.locator('button[aria-label^="Cell "]:not([disabled])')

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

      await expect(hostPage.getByText('Your room')).toBeVisible()
      await expect(hostPage.getByText('Waiting for opponent…')).toBeVisible()

      // Extract invite URL
      const inviteInput = hostPage.locator('input[readonly]')
      await expect(inviteInput).toBeVisible()
      const inviteUrl = await inviteInput.inputValue()
      expect(inviteUrl).toContain('/play?join=mt-')

      // Guest joins
      await guestPage.goto(inviteUrl)

      // Both see the game board
      await expect(boardLocator(hostPage)).toBeVisible({ timeout: 10_000 })
      await expect(boardLocator(guestPage)).toBeVisible({ timeout: 10_000 })

      // Exactly one player has "Your turn"
      const hostTurn = await hostPage.getByText('Your turn').isVisible().catch(() => false)
      const guestTurn = await guestPage.getByText('Your turn').isVisible().catch(() => false)
      expect(hostTurn || guestTurn).toBe(true)
      expect(hostTurn && guestTurn).toBe(false)
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

      const inviteInput2 = hostPage.locator('input[readonly]')
      await expect(inviteInput2).not.toHaveValue('', { timeout: 10_000 })
      const inviteUrl = await inviteInput2.inputValue()
      await guestPage.goto(inviteUrl)

      await expect(boardLocator(guestPage)).toBeVisible({ timeout: 10_000 })
      await expect(boardLocator(hostPage)).toBeVisible({ timeout: 10_000 })

      const pages = [hostPage, guestPage]
      const endTexts = ['You win', 'Opponent wins', 'Draw']

      // Play out the game — find whose turn it is and click a cell
      for (let move = 0; move < 9; move++) {
        let activePage = null
        for (const p of pages) {
          if (await p.getByText('Your turn').isVisible().catch(() => false)) {
            activePage = p; break
          }
        }
        if (!activePage) {
          // Wait a moment and retry (move may still be propagating)
          await hostPage.waitForTimeout(500)
          for (const p of pages) {
            if (await p.getByText('Your turn').isVisible().catch(() => false)) {
              activePage = p; break
            }
          }
        }
        if (!activePage) break

        const cells = emptyCells(activePage)
        if (await cells.count() === 0) break
        await cells.first().click()
        await hostPage.waitForTimeout(400)

        // Check if game ended
        let ended = false
        for (const p of pages) {
          for (const txt of endTexts) {
            if (await p.getByText(txt, { exact: false }).isVisible().catch(() => false)) {
              ended = true; break
            }
          }
          if (ended) break
        }
        if (ended) break
      }

      // Both pages show Rematch button
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

      const inviteInput = hostPage.locator('input[readonly]')
      await expect(inviteInput).not.toHaveValue('', { timeout: 10_000 })
      const inviteUrl = await inviteInput.inputValue()

      // Guest joins → game starts
      await guestPage.goto(inviteUrl)
      // Wait for guest board first (confirms game:start fired on server)
      await expect(boardLocator(guestPage)).toBeVisible({ timeout: 15_000 })
      await expect(boardLocator(hostPage)).toBeVisible({ timeout: 15_000 })

      // Spectator joins same URL
      await spectatorPage.goto(inviteUrl)
      await expect(boardLocator(spectatorPage)).toBeVisible({ timeout: 10_000 })

      // Spectator badge
      await expect(spectatorPage.getByText('Spectating')).toBeVisible()

      // Spectator cannot click cells
      const spectatorCell = spectatorPage.locator('button[aria-label^="Cell "]:not([disabled])').first()
      expect(await spectatorCell.count()).toBe(0)

      // Host/guest see spectator count
      await expect(hostPage.getByText(/👁/)).toBeVisible({ timeout: 5_000 })

      // Active player makes a move — spectator sees it
      for (const p of [hostPage, guestPage]) {
        if (await p.getByText('Your turn').isVisible().catch(() => false)) {
          // Find center cell (Cell 5) or first available
          const c5 = p.locator('button[aria-label="Cell 5"]:not([disabled])')
          if (await c5.count() > 0) {
            await c5.click()
          } else {
            await emptyCells(p).first().click()
          }
          break
        }
      }

      // Spectator sees a mark appear on the board
      await expect(spectatorPage.locator('button[aria-label^="Cell "][aria-label$=", X"], button[aria-label^="Cell "][aria-label$=", O"]').first()).toBeVisible({ timeout: 5_000 })
    } finally {
      await hostCtx.close()
      await guestCtx.close()
      await spectatorCtx.close()
    }
  })
})
