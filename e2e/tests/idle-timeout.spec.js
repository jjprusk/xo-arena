// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Idle-timeout subsystem — end-to-end coverage for the SSE+POST rebuild.
 *
 * What this proves:
 *   1. After a move, the per-(userId, tableId) idle warn timer arms with
 *      `game.idleWarnSeconds` from SystemConfig.
 *   2. When the warn fires, the server appends a `kind: 'warning'` event on
 *      `user:<id>:idle`; the client's `useGameSDK.onIdleWarning` translates
 *      it; `IdleWarnOverlay` mounts the "Still there?" modal.
 *   3. Clicking the overlay POSTs `/rt/tables/:slug/idle/pong`, which
 *      re-arms the timer (no second warn during the next warn window).
 *   4. With no pong, the grace timer fires `applyForfeit({ reason: 'idle' })`
 *      and the table transitions to COMPLETED with the opposite mark as
 *      winner. The forfeit event lands on `table:<id>:state`.
 *
 * Tuning: the admin endpoint enforces a 10s minimum on idle warn/grace,
 * which would balloon this test. We bypass it by writing SystemConfig
 * directly via Prisma in beforeAll/afterAll (3s warn, 3s grace). The
 * server reads SystemConfig fresh on each `arm()` call, so the tune takes
 * effect immediately.
 *
 * Prereqs:
 *   Frontend (landing) : http://localhost:5174
 *   Backend            : http://localhost:3000
 *   Tunable SystemConfig keys: game.idleWarnSeconds, game.idleGraceSeconds
 */

import { test, expect } from '@playwright/test'
import { execSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchAuthToken } from './helpers.js'
import { netCleanupByEmailPrefix } from './dbScript.js'

// Email prefix for every test user this spec creates. The afterAll net
// cleanup sweeps anything left over by this prefix.
const EMAIL_PREFIX = 'idle+'

const LANDING_URL = process.env.LANDING_URL || 'http://localhost:5174'
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000'

// SignInModal anti-bot 3s submit guard. Mirror guide-onboarding.spec.js so
// the signup helper here behaves the same on the same modal.
const SUBMIT_GUARD_MS = 3500

// Tuned values for this spec (seconds). Both must be small to keep wall
// time reasonable; both must be > 1 so the move-then-wait cycle has
// enough headroom to not race the warn.
const TEST_WARN_SEC  = 3
const TEST_GRACE_SEC = 3

function freshEmail() {
  const ts = Date.now().toString(36)
  const r  = Math.random().toString(36).slice(2, 8)
  return `idle+${ts}-${r}@dev.local`
}

/**
 * Prisma-via-docker helper, modeled after guide-onboarding.spec.js. The
 * admin endpoint refuses idleWarnSeconds < 10, so we write SystemConfig
 * directly. Silent-fail by design: if docker isn't reachable, the test
 * still surfaces its own assertion errors clearly.
 */
function runCleanupScript(body) {
  const script = `(async () => {
    process.stdout.write('CLEANUP_START\\n');
    try {
      const db = (await import('/app/backend/src/lib/db.js')).default;
      ${body}
      process.stdout.write('CLEANUP_END\\n');
      await new Promise(r => setTimeout(r, 100));
      process.exit(0);
    } catch (e) {
      process.stdout.write('CLEANUP_ERROR ' + e.message + '\\n');
      await new Promise(r => setTimeout(r, 100));
      process.exit(0);
    }
  })()`
  const dir = mkdtempSync(join(tmpdir(), 'e2e-idle-'))
  const localPath = join(dir, 'cleanup.mjs')
  writeFileSync(localPath, script)
  const remotePath = '/tmp/e2e-idle-cleanup.mjs'
  try {
    execSync(`docker compose cp "${localPath}" backend:${remotePath}`, {
      stdio: 'pipe', timeout: 15_000, cwd: '/Users/joe/Desktop/xo-arena',
    })
    const out = execSync(`docker compose exec -T backend node ${remotePath}`, {
      stdio: 'pipe', timeout: 30_000, cwd: '/Users/joe/Desktop/xo-arena',
    })
    console.log('[idle cleanup ok]', (out?.toString() || '').trim() || '(no output)')
  } catch (e) {
    console.log('[idle cleanup FAILED]', e.message)
    if (e.stdout) console.log('[idle cleanup stdout]', e.stdout.toString())
    if (e.stderr) console.log('[idle cleanup stderr]', e.stderr.toString())
  }
}

async function dismissWelcomeOnLoad(page) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem('aiarena_guest_welcome_seen', '1') } catch {}
  })
}

async function signUp(page, { email, password, displayName }) {
  await page.goto('/')
  await page.getByRole('button', { name: /build your own bot/i }).click()
  await expect(page.getByRole('heading', { name: /build your first bot/i })).toBeVisible()
  await page.getByPlaceholder(/^display name$/i).fill(displayName)
  await page.getByPlaceholder(/^email$/i).fill(email)
  await page.getByPlaceholder(/min\. 8/i).fill(password)
  await page.getByPlaceholder(/confirm password/i).fill(password)
  await page.waitForTimeout(SUBMIT_GUARD_MS)
  await page.getByRole('button', { name: /create account/i }).click()
  await expect(page.getByRole('heading', { name: /build your first bot/i }))
    .toBeHidden({ timeout: 10_000 })
}

/** Make a single move on the board. Picks the first available cell.
 *  Resolves once the cell is marked (so the caller can start its timer). */
async function makeOneMove(page) {
  await expect(page.getByText('Your turn')).toBeVisible({ timeout: 10_000 })
  const cells = page.getByRole('button', { name: /^Cell \d+$/ })
  await cells.first().click()
}

test.describe('Idle timeout — warn + pong + forfeit', () => {
  // Per-test wall time: signup (~6s) + game start (~3s) + warn cycle (~5s)
  // + optional grace cycle (~5s) + teardown. Generous upper bound.
  test.setTimeout(120_000)

  const created = { userId: null, email: null }

  test.beforeAll(() => {
    // Tune SystemConfig down to 3s warn / 3s grace. The server's
    // skillService.getSystemConfig has a small in-process cache, but it's
    // read-through on miss and the keys aren't preloaded — first read
    // after this write picks up the new value.
    runCleanupScript(`
      await db.systemConfig.upsert({
        where:  { key: 'game.idleWarnSeconds' },
        create: { key: 'game.idleWarnSeconds',  value: ${TEST_WARN_SEC}  },
        update: { value: ${TEST_WARN_SEC} },
      })
      await db.systemConfig.upsert({
        where:  { key: 'game.idleGraceSeconds' },
        create: { key: 'game.idleGraceSeconds', value: ${TEST_GRACE_SEC} },
        update: { value: ${TEST_GRACE_SEC} },
      })
    `)
  })

  test.afterAll(() => {
    // Restore defaults so the rest of the suite runs against the production
    // values. Deleting the rows lets getSystemConfig() fall through to its
    // default arg (120 / 60).
    runCleanupScript(`
      await db.systemConfig.deleteMany({
        where: { key: { in: ['game.idleWarnSeconds', 'game.idleGraceSeconds'] } },
      }).catch(()=>{})
    `)
    // Net-sweep across every artifact this spec might have created. Backstop
    // for an afterEach that errored mid-tear-down.
    netCleanupByEmailPrefix(EMAIL_PREFIX, { tag: 'idle-after' })
  })

  test.afterEach(() => {
    const { userId, email } = created
    runCleanupScript(`
      ${userId ? `
        // Drop the test user's tables (idle test creates an HVB table).
        await db.table.deleteMany({ where: { createdById: '${userId}' } }).catch(()=>{})
        await db.game.deleteMany({ where: { OR: [{ player1Id: '${userId}' }, { player2Id: '${userId}' }] } }).catch(()=>{})
        await db.user.delete({ where: { id: '${userId}' } }).catch(()=>{})
      ` : ''}
      ${email ? `await db.baUser.deleteMany({ where: { email: '${email}' } }).catch(()=>{})` : ''}
    `)
    created.userId = created.email = null
  })

  test('overlay surfaces "Still there?" after warnSeconds and dismisses on click', async ({ page, context }) => {
    await dismissWelcomeOnLoad(page)
    const email = freshEmail()
    const password    = 'idle-test-pw-1234'
    const displayName = `Idle ${Math.random().toString(36).slice(2, 8)}`
    created.email = email
    await signUp(page, { email, password, displayName })

    // Sync to populate the application User row + capture the domain id for
    // teardown. /users/sync mirrors the BA user → app User on first auth.
    const token = await fetchAuthToken(context.request, BACKEND_URL)
    const syncRes = await context.request.post(`${BACKEND_URL}/api/v1/users/sync`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(syncRes.ok()).toBeTruthy()
    created.userId = (await syncRes.json())?.user?.id ?? null

    // Drop straight into a vs-community-bot game (HVB). The signed-in user
    // is the human seat, so the idle timer applies to them after each move.
    await page.goto('/play?action=vs-community-bot')
    await page.locator('[aria-label="Tic-tac-toe board"]').waitFor({ state: 'visible', timeout: 15_000 })

    // AppLayout's reopenSharedStream fires on user.id transition (guest →
    // signed-in) so the SSE re-registers with the new userId — without it,
    // per-user events (`user:<id>:idle`) are silently filtered server-side.
    // The warm-reopen has a 5s fallback (useEventStream.reopenSharedStream).
    // 1.5s is empirically enough for the new session frame to arrive on a
    // local dev box; bump if this flakes in CI.
    await page.waitForTimeout(1500)

    // First move arms the timer (warn=3s, grace=3s). Bot replies; user idle.
    await makeOneMove(page)

    // Warn should fire within warnSec + ~1s slack, then the overlay stays
    // up for graceSec. We give the visible-check the *full* warn+grace
    // window so a late SSE delivery still passes — the overlay only auto-
    // closes once the countdown reaches 0.
    // Wait for the heading. Use getByRole — the dialog is fully accessible
    // (role="dialog", h3 heading inside) once the click-arm guard prevents
    // a stale pointer event from auto-dismissing on first paint.
    await expect(page.getByRole('heading', { name: /still there\?/i }))
      .toBeVisible({ timeout: (TEST_WARN_SEC + TEST_GRACE_SEC + 2) * 1000 })

    // Clicking inside the dialog fires `sdk.idlePong()` which POSTs
    // /rt/tables/:slug/idle/pong → re-arms the timer. Click the explicit
    // CTA so we exercise the same path the user does.
    await page.getByRole('button', { name: /i'm still here/i }).click()
    await expect(page.getByRole('heading', { name: /still there\?/i }))
      .toBeHidden({ timeout: 2_000 })

    // After pong, the warn must NOT fire again sooner than warnSec from
    // *now*. Check the half-warn point — overlay still hidden. (We don't
    // wait the full warnSec here; the next test covers the forfeit edge.)
    await page.waitForTimeout(Math.floor(TEST_WARN_SEC * 1000 / 2))
    await expect(page.getByRole('heading', { name: /still there\?/i })).toBeHidden()
  })

  test('forfeit lands on the table after warn + grace with no pong', async ({ page, context }) => {
    await dismissWelcomeOnLoad(page)
    const email = freshEmail()
    const password    = 'idle-test-pw-1234'
    const displayName = `Idle ${Math.random().toString(36).slice(2, 8)}`
    created.email = email
    await signUp(page, { email, password, displayName })

    const token = await fetchAuthToken(context.request, BACKEND_URL)
    const syncRes = await context.request.post(`${BACKEND_URL}/api/v1/users/sync`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(syncRes.ok()).toBeTruthy()
    created.userId = (await syncRes.json())?.user?.id ?? null

    await page.goto('/play?action=vs-community-bot')
    await page.locator('[aria-label="Tic-tac-toe board"]').waitFor({ state: 'visible', timeout: 15_000 })
    // See test 1 for why we wait — give the SSE warm-reopen time to land on
    // the new userId so the warn isn't dropped.
    await page.waitForTimeout(1500)
    await makeOneMove(page)

    // Wait warn + grace + slack. The IdleWarnOverlay auto-dismisses at
    // countdown=0 and the forfeit lifecycle event flips the board into
    // its post-game state. The end-of-game UI varies by game variant; the
    // most stable signal is the absence of "Your turn" plus the presence
    // of either Rematch / Leave Table. We assert on Rematch which only
    // appears on a finished HVB game.
    const totalMs = (TEST_WARN_SEC + TEST_GRACE_SEC + 3) * 1000
    await expect(page.getByRole('button', { name: /^Rematch$/i }))
      .toBeVisible({ timeout: totalMs })

    // The signed-in user must NOT be the winner (they got force-forfeited).
    // The post-game banner shows the outcome; we tolerate either "Opponent
    // wins" / "You lose" / "Bot wins" wording the variant chose.
    const loseSignals = page.getByText(/opponent wins|you lose|bot wins|loss/i).first()
    await expect(loseSignals).toBeVisible({ timeout: 3_000 })
  })
})
