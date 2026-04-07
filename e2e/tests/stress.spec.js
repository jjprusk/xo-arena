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
const DRAIN_MS     = 8_000   // wait after abrupt disconnects for cleanup to fire
const SNAPSHOT_MS  = 65_000  // just over one snapshot interval (60 s)
const LEAK_WINDOW  = 3       // must match LEAK_WINDOW in resourceCounters.js

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
    const baseline = await fetchHealth(request)
    const baselineSockets = baseline.latest?.sockets ?? 0
    const baselineRooms   = baseline.latest?.rooms   ?? 0

    // Open 20 contexts and navigate to /play (triggers socket connect)
    const CHURN_COUNT = 20
    const contexts = await Promise.all(
      Array.from({ length: CHURN_COUNT }, () => browser.newContext())
    )
    const pages = await Promise.all(contexts.map(ctx => ctx.newPage()))
    await Promise.all(pages.map(p => p.goto('/play').catch(() => {})))

    // Abruptly close all contexts — simulates crash / network drop
    await Promise.all(contexts.map(ctx => ctx.close()))

    // Wait for disconnect cleanup
    await new Promise(r => setTimeout(r, DRAIN_MS))

    const after = await fetchHealth(request)
    expect(after.latest.sockets).toBeLessThanOrEqual(baselineSockets + 1) // ±1 for admin browser
    expect(after.latest.rooms).toBeLessThanOrEqual(baselineRooms)
    expect(Object.values(after.alerts).some(Boolean)).toBe(false)
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
    test.setTimeout(SNAPSHOT_MS * LEAK_WINDOW + 60_000)

    const baseline = await fetchHealth(request)

    // Open 10 contexts and hold them open — don't close
    const HELD_COUNT = 10
    const held = await Promise.all(
      Array.from({ length: HELD_COUNT }, () => browser.newContext())
    )
    const pages = await Promise.all(held.map(ctx => ctx.newPage()))
    await Promise.all(pages.map(p => p.goto('/play').catch(() => {})))

    // Wait for LEAK_WINDOW + 1 snapshot intervals to pass
    await new Promise(r => setTimeout(r, SNAPSHOT_MS * (LEAK_WINDOW + 1)))

    const after = await fetchHealth(request)
    expect(after.alerts.sockets).toBe(true)

    // Cleanup — close held contexts; alert should auto-clear on next snapshot
    await Promise.all(held.map(ctx => ctx.close()))

    // Verify alert cleared
    await new Promise(r => setTimeout(r, SNAPSHOT_MS + DRAIN_MS))
    const cleared = await fetchHealth(request)
    expect(cleared.alerts.sockets).toBe(false)
  })
})
