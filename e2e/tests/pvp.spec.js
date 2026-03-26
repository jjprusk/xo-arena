import { test, expect } from '@playwright/test'
import { getInviteUrl } from './helpers.js'

/**
 * E2E-02: Full PvP game flow
 * E2E-03: Spectator flow
 *
 * Uses two (or three) browser contexts to simulate multiple players/spectators.
 * Requires: frontend at localhost:5173, backend at localhost:3000 (with Redis).
 *
 * The app auto-creates a room when the host arrives at /play.
 * The invite URL appears in the readonly input in the "Invite a Friend" card.
 */

const boardLocator = (page) => page.locator('[aria-label="Tic-tac-toe board"]')
const emptyCells = (page) => page.locator('button[aria-label^="Cell "]:not([disabled])')

test.describe('PvP game flow', () => {
  test('host auto-room invite link allows guest to join', async ({ browser }) => {
    const hostCtx = await browser.newContext()
    const guestCtx = await browser.newContext()
    const hostPage = await hostCtx.newPage()
    const guestPage = await guestCtx.newPage()

    try {
      // Host: get the auto-created invite URL
      const inviteUrl = await getInviteUrl(hostPage)
      expect(inviteUrl).toContain('/play?join=mt-')

      // Guest joins via invite URL
      await guestPage.goto(inviteUrl)

      // Both see the game board
      await expect(boardLocator(hostPage)).toBeVisible({ timeout: 15_000 })
      await expect(boardLocator(guestPage)).toBeVisible({ timeout: 15_000 })

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
      const inviteUrl = await getInviteUrl(hostPage)
      await guestPage.goto(inviteUrl)

      await expect(boardLocator(guestPage)).toBeVisible({ timeout: 15_000 })
      await expect(boardLocator(hostPage)).toBeVisible({ timeout: 15_000 })

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

  test('room name is shown on the board', async ({ browser }) => {
    const hostCtx = await browser.newContext()
    const guestCtx = await browser.newContext()
    const hostPage = await hostCtx.newPage()
    const guestPage = await guestCtx.newPage()

    try {
      const inviteUrl = await getInviteUrl(hostPage)
      await guestPage.goto(inviteUrl)

      await expect(boardLocator(hostPage)).toBeVisible({ timeout: 15_000 })

      // Room display name (e.g. "Mt. Rainier") shown on both boards
      const roomName = await hostPage.locator('span').filter({ hasText: /^Mt\. / }).first().textContent()
      expect(roomName).toMatch(/^Mt\. /)
      await expect(guestPage.locator('span, h1').filter({ hasText: roomName })).toBeVisible({ timeout: 5_000 })
    } finally {
      await hostCtx.close()
      await guestCtx.close()
    }
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
      // Host gets invite URL from auto-room
      const inviteUrl = await getInviteUrl(hostPage)

      // Guest joins → game starts
      await guestPage.goto(inviteUrl)
      await expect(boardLocator(guestPage)).toBeVisible({ timeout: 15_000 })
      await expect(boardLocator(hostPage)).toBeVisible({ timeout: 15_000 })

      // Spectator joins same URL (room is now playing → joins as spectator)
      await spectatorPage.goto(inviteUrl)
      await expect(boardLocator(spectatorPage)).toBeVisible({ timeout: 10_000 })

      // Spectator badge is shown
      await expect(spectatorPage.getByText('Spectating')).toBeVisible()

      // Spectator cannot click any cells (all disabled)
      const spectatorCells = spectatorPage.locator('button[aria-label^="Cell "]:not([disabled])')
      expect(await spectatorCells.count()).toBe(0)

      // Host or guest sees spectator count badge
      await expect(hostPage.getByText(/👁/)).toBeVisible({ timeout: 5_000 })

      // Active player makes a move — spectator sees it update
      for (const p of [hostPage, guestPage]) {
        if (await p.getByText('Your turn').isVisible().catch(() => false)) {
          await emptyCells(p).first().click()
          break
        }
      }

      // Spectator sees a filled cell appear
      await expect(
        spectatorPage.locator('button[aria-label$=", X"], button[aria-label$=", O"]').first()
      ).toBeVisible({ timeout: 5_000 })
    } finally {
      await hostCtx.close()
      await guestCtx.close()
      await spectatorCtx.close()
    }
  })

  test('multiple spectators all see moves in real time', async ({ browser }) => {
    const hostCtx      = await browser.newContext()
    const guestCtx     = await browser.newContext()
    const spectator1Ctx = await browser.newContext()
    const spectator2Ctx = await browser.newContext()
    const spectator3Ctx = await browser.newContext()

    const hostPage      = await hostCtx.newPage()
    const guestPage     = await guestCtx.newPage()
    const spec1Page     = await spectator1Ctx.newPage()
    const spec2Page     = await spectator2Ctx.newPage()
    const spec3Page     = await spectator3Ctx.newPage()
    const spectatorPages = [spec1Page, spec2Page, spec3Page]

    try {
      const inviteUrl = await getInviteUrl(hostPage)

      // Guest joins → game starts
      await guestPage.goto(inviteUrl)
      await expect(boardLocator(guestPage)).toBeVisible({ timeout: 15_000 })
      await expect(boardLocator(hostPage)).toBeVisible({ timeout: 15_000 })

      // All 3 spectators join
      for (const spec of spectatorPages) {
        await spec.goto(inviteUrl)
        await expect(boardLocator(spec)).toBeVisible({ timeout: 10_000 })
        await expect(spec.getByText('Spectating')).toBeVisible()
      }

      // Players see spectator count = 3
      await expect(hostPage.getByText(/👁.*3|3.*👁/)).toBeVisible({ timeout: 8_000 })

      // Active player makes a move
      for (const p of [hostPage, guestPage]) {
        if (await p.getByText('Your turn').isVisible().catch(() => false)) {
          await emptyCells(p).first().click()
          break
        }
      }

      // All spectators see the filled cell
      const filledCell = 'button[aria-label$=", X"], button[aria-label$=", O"]'
      for (const spec of spectatorPages) {
        await expect(spec.locator(filledCell).first()).toBeVisible({ timeout: 5_000 })
      }

      // Active player makes a second move
      for (const p of [hostPage, guestPage]) {
        if (await p.getByText('Your turn').isVisible().catch(() => false)) {
          await emptyCells(p).first().click()
          break
        }
      }

      // All spectators see 2 filled cells
      for (const spec of spectatorPages) {
        await expect(spec.locator(filledCell)).toHaveCount(2, { timeout: 5_000 })
      }

      // Spectators still cannot interact with the board
      for (const spec of spectatorPages) {
        expect(await spec.locator('button[aria-label^="Cell "]:not([disabled])').count()).toBe(0)
      }
    } finally {
      await hostCtx.close()
      await guestCtx.close()
      await spectator1Ctx.close()
      await spectator2Ctx.close()
      await spectator3Ctx.close()
    }
  })
})
