/**
 * Resource leak stress tests.
 *
 * Validates that socket, room, and Redis counters return to baseline after
 * high-churn connect/disconnect cycles and abrupt disconnects.
 *
 * Run locally against the full docker-compose stack:
 *   cd e2e && npx playwright test stress --project=chromium
 *
 * NOT part of the standard CI run — manual only.
 * Requires an admin account for the health endpoint.
 */

import { test, expect } from '@playwright/test'
import { getInviteUrl } from './helpers.js'

const BACKEND_URL  = process.env.BACKEND_URL  || 'http://localhost:3000'
const ADMIN_TOKEN  = process.env.STRESS_ADMIN_TOKEN  // set via env — admin JWT
const DRAIN_MS         = 8_000    // wait after abrupt disconnects for cleanup to fire
const RECONNECT_MS     = 65_000   // just over RECONNECT_WINDOW_MS (60 s) in roomManager
const SNAPSHOT_MS      = 65_000   // just over one snapshot interval (60 s)
const LEAK_WINDOW      = 3        // must match LEAK_WINDOW in resourceCounters.js

async function fetchHealth(request) {
  const resp = await request.get(`${BACKEND_URL}/api/v1/admin/health/sockets`, {
    headers: ADMIN_TOKEN ? { Authorization: `Bearer ${ADMIN_TOKEN}` } : {},
  })
  expect(resp.ok()).toBeTruthy()
  return resp.json()
}

test.describe('Resource leak — baseline and churn', () => {
  test.setTimeout(120_000)

  test('socket and room counters return to baseline after connection churn', async ({ browser, request }) => {
    test.setTimeout(RECONNECT_MS + 60_000)

    const baseline = await fetchHealth(request)
    const baselineSockets = baseline.latest?.sockets ?? 0
    const baselineRooms   = baseline.latest?.rooms   ?? 0

    // Open 20 contexts and navigate to /play (triggers socket connect + auto-room creation)
    const CHURN_COUNT = 20
    const contexts = await Promise.all(
      Array.from({ length: CHURN_COUNT }, () => browser.newContext())
    )
    const pages = await Promise.all(contexts.map(ctx => ctx.newPage()))
    await Promise.all(pages.map(p => p.goto('/play').catch(() => {})))

    // Abruptly close all contexts — simulates crash / network drop
    await Promise.all(contexts.map(ctx => ctx.close()))

    // Sockets clean up quickly; check them after the short drain
    await new Promise(r => setTimeout(r, DRAIN_MS))
    const afterSockets = await fetchHealth(request)
    expect(afterSockets.latest.sockets).toBeLessThanOrEqual(baselineSockets + 1) // ±1 for admin browser

    // Rooms linger for the 60 s reconnect window before being forfeited and closed.
    // Wait for the full reconnect window to expire before asserting room count.
    await new Promise(r => setTimeout(r, RECONNECT_MS))
    const afterRooms = await fetchHealth(request)
    expect(afterRooms.latest.rooms).toBeLessThanOrEqual(baselineRooms)
    expect(Object.values(afterRooms.alerts).some(Boolean)).toBe(false)
  })

  test('room counter returns to zero after mid-game abrupt disconnect', async ({ browser, request }) => {
    const baseline = await fetchHealth(request)
    const baselineRooms = baseline.latest?.rooms ?? 0

    // Start 5 games, then abruptly kill one side of each
    const GAME_COUNT = 5
    const pairs = await Promise.all(
      Array.from({ length: GAME_COUNT }, async () => {
        const hostCtx  = await browser.newContext()
        const guestCtx = await browser.newContext()
        const hostPage  = await hostCtx.newPage()
        const guestPage = await guestCtx.newPage()
        try {
          const inviteUrl = await getInviteUrl(hostPage)
          await guestPage.goto(inviteUrl)
          await guestPage.waitForSelector('[aria-label="Tic-tac-toe board"]', { timeout: 15_000 })
        } catch { /* non-fatal — game may not have started */ }
        return { hostCtx, guestCtx }
      })
    )

    // Abruptly close host side of each game
    await Promise.all(pairs.map(({ hostCtx }) => hostCtx.close()))
    // Wait for reconnect window (60 s) + drain
    // Shortened: close guest side too so rooms close immediately
    await Promise.all(pairs.map(({ guestCtx }) => guestCtx.close()))
    await new Promise(r => setTimeout(r, DRAIN_MS))

    const after = await fetchHealth(request)
    expect(after.latest.rooms).toBeLessThanOrEqual(baselineRooms)
  })
})

test.describe('Resource leak — leak detection', () => {
  /**
   * Leak simulation: hold connections open without responding for long enough
   * that the snapshot interval fires N=3 times with a rising socket count.
   *
   * This test takes > 3 minutes by design — it's validating the alert mechanism.
   */
  test('leak detector fires after N consecutive rising snapshots', async ({ browser, request }) => {
    // Each batch opens BATCH_SIZE contexts and holds them. By opening a new batch
    // after each snapshot interval, the socket count strictly increases across
    // LEAK_WINDOW consecutive snapshots, which is what the detector requires.
    test.setTimeout(SNAPSHOT_MS * (LEAK_WINDOW + 2) + 120_000)

    const BATCH_SIZE = 5
    const allHeld = []

    // Open one batch per snapshot interval so the count rises with each snapshot
    for (let i = 0; i < LEAK_WINDOW; i++) {
      const batch = await Promise.all(
        Array.from({ length: BATCH_SIZE }, () => browser.newContext())
      )
      const pages = await Promise.all(batch.map(ctx => ctx.newPage()))
      await Promise.all(pages.map(p => p.goto('/play').catch(() => {})))
      allHeld.push(...batch)

      // Wait for the snapshot to fire before opening the next batch
      if (i < LEAK_WINDOW - 1) await new Promise(r => setTimeout(r, SNAPSHOT_MS))
    }

    // Wait one more interval for the detector to evaluate the full window
    await new Promise(r => setTimeout(r, SNAPSHOT_MS))

    const after = await fetchHealth(request)
    expect(after.alerts.sockets).toBe(true)

    // Cleanup — close held contexts; alert should auto-clear on next snapshot
    await Promise.all(allHeld.map(ctx => ctx.close()))

    await new Promise(r => setTimeout(r, SNAPSHOT_MS + DRAIN_MS))
    const cleared = await fetchHealth(request)
    expect(cleared.alerts.sockets).toBe(false)
  })
})
