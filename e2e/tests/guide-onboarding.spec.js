// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Intelligent Guide v1 — single-user end-to-end onboarding walkthrough.
 *
 * Walks the WHOLE journey for one fresh user in one Playwright session:
 *
 *   Step 1 — Hook: PvAI to end                        (~30s)
 *   Step 2 — Hook: demo-table watch + +20 TC           (~30-60s)
 *   Step 3 — Curriculum: Quick Bot create              (instant)
 *   Step 4 — Curriculum: Train Guided — real Q-Learning
 *            ~30k-episode run + finalize (botModelType
 *            flips minimax → qlearning)                (~5-10s)
 *   Step 5 — Curriculum: Spar (easy tier)              (~5s)
 *   Step 6 — Curriculum: Curriculum Cup clone          (~5s)
 *   Step 7 — Curriculum: Cup completes + +50 TC reward (~30-60s)
 *
 * Total wall time: ~3-4 minutes on local dev. Generous timeout for CI.
 *
 * This spec mirrors `V1_Acceptance.md` Stages 1-5. Stages 6-10 are not
 * automated — they need real ML training, real tournaments, or admin-UI
 * keystrokes. Run those manually via the V1_Acceptance script.
 *
 * The existing `guide-hook.spec.js` and `guide-curriculum.spec.js` cover
 * each phase in isolation; this spec is the *bridge* check — it verifies the
 * journey progresses cleanly across both phase boundaries (Hook→Curriculum
 * at step 2, Curriculum→Specialize at step 7) for a single user.
 *
 * Prerequisites:
 *   Frontend (landing) : http://localhost:5174
 *   Backend            : http://localhost:3000
 *   Tournament service : reachable through landing dev proxy
 */

import { test, expect } from '@playwright/test'
import { execSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchAuthToken } from './helpers.js'

const LANDING_URL = process.env.LANDING_URL || 'http://localhost:5174'
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000'

// SignInModal anti-bot 3s submit guard.
const SUBMIT_GUARD_MS = 3500

function freshEmail() {
  const ts = Date.now().toString(36)
  const r  = Math.random().toString(36).slice(2, 8)
  return `onb+${ts}-${r}@dev.local`
}

async function dismissWelcomeOnLoad(page) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem('aiarena_guest_welcome_seen', '1') } catch {}
  })
}

/**
 * Pre-seed the guest-mode journey state in localStorage so that signup posts
 * guest-credit with a Hook step 1 timestamp. Mirrors the real Phase 0 flow
 * (V1_Acceptance.md Stage 1): a guest finishes a PvAI, the client writes the
 * timestamp to `guideGuestJourney`, and SignInModal posts it to
 * `/api/v1/guide/guest-credit` after signup.
 */
async function seedGuestHookStep1(page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem(
        'guideGuestJourney',
        JSON.stringify({ hookStep1CompletedAt: new Date().toISOString() })
      )
    } catch {}
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

async function fetchProgress(request, token) {
  const res = await request.get(`${BACKEND_URL}/api/v1/guide/preferences`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok()) return { completedSteps: [], creditsTc: null }
  const body = await res.json()
  return {
    completedSteps: body?.preferences?.journeyProgress?.completedSteps
                 ?? body?.journeyProgress?.completedSteps
                 ?? [],
  }
}

async function fetchCreditsTc(request, token, userId) {
  if (!userId) return null
  const res = await request.get(`${BACKEND_URL}/api/v1/users/${userId}/credits`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok()) return null
  const body = await res.json()
  return body?.creditsTc ?? body?.tc ?? null
}

async function pollForStep(request, token, stepIndex, deadlineMs) {
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    const { completedSteps } = await fetchProgress(request, token)
    if (completedSteps.includes(stepIndex)) return completedSteps
    await new Promise(r => setTimeout(r, 1500))
  }
  return (await fetchProgress(request, token)).completedSteps
}

async function createDemoTable(request, token) {
  const res = await request.post(`${BACKEND_URL}/api/v1/tables/demo`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok()) throw new Error(`demo create failed: ${res.status()} ${await res.text()}`)
  return await res.json()
}

async function createQuickBot(request, token, displayName) {
  const res = await request.post(`${BACKEND_URL}/api/v1/bots/quick`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data:    { name: displayName, persona: 'aggressive' },
  })
  if (!res.ok()) throw new Error(`bots/quick failed: ${res.status()} ${await res.text()}`)
  return (await res.json()).bot
}

async function quickTrain(request, token, botId) {
  const res = await request.post(`${BACKEND_URL}/api/v1/bots/${botId}/train-quick`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok()) throw new Error(`train-quick failed: ${res.status()} ${await res.text()}`)
  return await res.json()
}

/**
 * Step 4 — real Q-Learning training. POST /train-guided to kick off, then
 * poll-finalize until the trainingSession reaches COMPLETED (returns 409
 * SESSION_NOT_COMPLETE while still running). On success the backend swaps
 * `bot.botModelId` to the new skill UUID and `botModelType` to 'qlearning',
 * then fires `completeStep(caller.id, 4)`. ~5-10s in dev.
 */
async function trainGuided(request, token, botId) {
  const startRes = await request.post(`${BACKEND_URL}/api/v1/bots/${botId}/train-guided`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!startRes.ok()) throw new Error(`train-guided start failed: ${startRes.status()} ${await startRes.text()}`)
  const { sessionId, skillId } = await startRes.json()
  if (!sessionId || !skillId) throw new Error('train-guided returned no sessionId/skillId')

  const deadline = Date.now() + 60_000
  let lastErr = null
  while (Date.now() < deadline) {
    const finRes = await request.post(`${BACKEND_URL}/api/v1/bots/${botId}/train-guided/finalize`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data:    { sessionId, skillId },
    })
    if (finRes.ok()) return await finRes.json()
    if (finRes.status() === 409) {
      // SESSION_NOT_COMPLETE — keep polling.
      lastErr = `${finRes.status()} ${await finRes.text()}`
      await new Promise(r => setTimeout(r, 1500))
      continue
    }
    throw new Error(`train-guided finalize failed: ${finRes.status()} ${await finRes.text()}`)
  }
  throw new Error(`train-guided finalize never completed within 60s; last: ${lastErr}`)
}

async function spar(request, token, botId) {
  const res = await request.post(`${BACKEND_URL}/api/v1/bot-games/practice`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data:    { myBotId: botId, opponentTier: 'easy', moveDelayMs: 200 },
  })
  if (!res.ok()) throw new Error(`bot-games/practice failed: ${res.status()} ${await res.text()}`)
  return await res.json()
}

async function cloneCup(request, token, botId) {
  const res = await request.post(`${LANDING_URL}/api/tournaments/curriculum-cup/clone`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data:    { myBotId: botId },
  })
  if (!res.ok()) throw new Error(`cup clone failed: ${res.status()} ${await res.text()}`)
  return await res.json()
}

/**
 * Run a Prisma script inside the backend container. Used by beforeAll +
 * afterEach to do test-only cleanup that has no admin endpoint. Body is the
 * inside of an async IIFE — it has access to a `db` (Prisma) handle.
 *
 * The script is written to a tmpfile and copied into the container so we
 * avoid shell-escaping issues with multi-line template strings. Silent-fail
 * by design: if docker isn't reachable (CI may use a different stack), the
 * test surfaces its own assertion errors clearly.
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
  const dir = mkdtempSync(join(tmpdir(), 'e2e-cleanup-'))
  const localPath = join(dir, 'cleanup.mjs')
  writeFileSync(localPath, script)
  const remotePath = '/tmp/e2e-cleanup.mjs'
  try {
    execSync(`docker compose cp "${localPath}" backend:${remotePath}`, {
      stdio: 'pipe', timeout: 15_000, cwd: '/Users/joe/Desktop/xo-arena',
    })
    const out = execSync(`docker compose exec -T backend node ${remotePath}`, {
      stdio: 'pipe', timeout: 30_000, cwd: '/Users/joe/Desktop/xo-arena',
    })
    console.log('[cleanup ok]', (out?.toString() || '').trim() || '(no output)')
  } catch (e) {
    console.log('[cleanup FAILED]', e.message)
    if (e.stdout) console.log('[cleanup stdout]', e.stdout.toString())
    if (e.stderr) console.log('[cleanup stderr]', e.stderr.toString())
  }
}


test.describe('Intelligent Guide v1 — single-user onboarding (Stages 1-5)', () => {
  // 7 sequential phases × DB polls + bot games + cup completion. Generous
  // upper bound so a slow CI box still finishes; real wall time on local
  // dev is 3-4 minutes.
  test.setTimeout(480_000)

  // Track the per-run state we have to clean up so the test is re-runnable
  // and doesn't leak rows. afterEach reads these.
  const created = { userId: null, email: null, tournamentId: null, demoTableId: null, botId: null }

  // The Curriculum Cup name pool only has 8 names per tier. After a few re-
  // runs of this spec, the pool collides with previously-created cup bots
  // (UNIQUE constraint on lower(displayName)). Wipe cup bots before each
  // run so the test stays re-runnable on a non-fresh DB. No-op if docker
  // isn't reachable (CI may run via a different stack).
  test.beforeAll(() => {
    // Wipe everything this spec might have left behind on prior failed runs:
    // cup-bots, Curriculum Cup tournaments, demo tables, and "Onboard …"
    // test users. Without this the displayName pool / unique constraints
    // accumulate noise and trip later runs.
    runCleanupScript(`
      // 1. Cup tournaments + their games (Game.tournamentMatch FK is RESTRICT).
      const oldCups = await db.tournament.findMany({ where: { name: 'Curriculum Cup' }, select: { id: true } })
      const cupTournIds = oldCups.map(t => t.id)
      if (cupTournIds.length) {
        await db.game.deleteMany({ where: { tournamentId: { in: cupTournIds } } }).catch(()=>{})
        await db.tournament.deleteMany({ where: { id: { in: cupTournIds } } }).catch(()=>{})
      }
      // 2. Cup bots.
      const cupBots = await db.user.findMany({ where: { username: { startsWith: 'bot-cup-' } }, select: { id: true } })
      const ids = cupBots.map(b => b.id)
      if (ids.length) {
        await db.game.deleteMany({ where: { OR: [{ player1Id: { in: ids } }, { player2Id: { in: ids } }] } }).catch(()=>{})
        await db.tournamentParticipant.deleteMany({ where: { userId: { in: ids } } }).catch(()=>{})
      }
      const cupCount = await db.user.deleteMany({ where: { username: { startsWith: 'bot-cup-' } } })
      // 3. Demo tables left behind.
      await db.table.deleteMany({ where: { isDemo: true } }).catch(()=>{})
      // 4. Test users from prior runs of this spec (Onboard … displayName).
      const onb = await db.user.findMany({ where: { displayName: { startsWith: 'Onboard' } }, select: { id: true, betterAuthId: true } })
      const onbIds = onb.map(u => u.id)
      if (onbIds.length) {
        await db.game.deleteMany({ where: { OR: [{ player1Id: { in: onbIds } }, { player2Id: { in: onbIds } }] } }).catch(()=>{})
        // Also their bots (botOwnerId = the test user).
        const ownedBots = await db.user.findMany({ where: { botOwnerId: { in: onbIds } }, select: { id: true } })
        const botIds = ownedBots.map(b => b.id)
        if (botIds.length) {
          await db.game.deleteMany({ where: { OR: [{ player1Id: { in: botIds } }, { player2Id: { in: botIds } }] } }).catch(()=>{})
          // BotSkill.botId is a soft FK — clear bound skills (cascades training_sessions)
          // before deleting the bot user, otherwise rows leak between runs.
          await db.botSkill.deleteMany({ where: { botId: { in: botIds } } }).catch(()=>{})
          await db.user.deleteMany({ where: { id: { in: botIds } } }).catch(()=>{})
        }
        await db.user.deleteMany({ where: { id: { in: onbIds } } }).catch(()=>{})
        // Drop the matching BetterAuth rows by id (FK to User.betterAuthId).
        const baIds = onb.map(u => u.betterAuthId).filter(Boolean)
        if (baIds.length) await db.baUser.deleteMany({ where: { id: { in: baIds } } }).catch(()=>{})
      }
      console.log('beforeAll cleanup — cups', cupTournIds.length, 'cup-bots', cupCount.count, 'onb users', onbIds.length)
    `)
  })

  // Tear down everything the test created. The order matters: tournament
  // first (its participant rows FK to User), then the user (cascade-deletes
  // their bots, games, journey state, credits).
  test.afterEach(() => {
    const { userId, email, tournamentId, demoTableId, botId } = created
    runCleanupScript(`
      // FK ordering: Game.tournamentMatch is RESTRICT, so we have to clear
      // games before the Tournament cascade-deletes its matches.
      ${tournamentId ? `await db.game.deleteMany({ where: { tournamentId: '${tournamentId}' } }).catch(()=>{});
        await db.tournament.delete({ where: { id: '${tournamentId}' } }).catch(()=>{});` : ''}
      ${demoTableId ? `await db.table.delete({ where: { id: '${demoTableId}' } }).catch(()=>{});` : ''}
      // Sweep cup-bots before the test user — cup-bots may have games involving
      // the test user that still need clearing.
      const cupBots = await db.user.findMany({ where: { username: { startsWith: 'bot-cup-' } }, select: { id: true } });
      const cupIds = cupBots.map(b => b.id);
      if (cupIds.length) {
        await db.game.deleteMany({ where: { OR: [{ player1Id: { in: cupIds } }, { player2Id: { in: cupIds } }] } }).catch(()=>{});
        await db.tournamentParticipant.deleteMany({ where: { userId: { in: cupIds } } }).catch(()=>{});
      }
      const cupCount = await db.user.deleteMany({ where: { username: { startsWith: 'bot-cup-' } } });
      console.log('teardown — cup-bots removed', cupCount.count);
      ${botId ? `await db.game.deleteMany({ where: { OR: [{ player1Id: '${botId}' }, { player2Id: '${botId}' }] } }).catch(()=>{});
        // Drop BotSkill rows + cascaded TrainingSession rows the train-guided
        // step bound to this bot. BotSkill.botId is a soft FK (no @relation),
        // so User deletion would otherwise leak orphan skill rows.
        await db.botSkill.deleteMany({ where: { botId: '${botId}' } }).catch(()=>{});
        await db.user.delete({ where: { id: '${botId}' } }).catch(()=>{});` : ''}
      ${userId ? `await db.game.deleteMany({ where: { OR: [{ player1Id: '${userId}' }, { player2Id: '${userId}' }] } }).catch(()=>{});
        await db.user.delete({ where: { id: '${userId}' } }).catch(()=>{});` : ''}
      ${email ? `await db.baUser.deleteMany({ where: { email: '${email}' } }).catch(()=>{});` : ''}
    `)
    created.userId = created.email = created.tournamentId = created.demoTableId = created.botId = null
  })

  test('walks the full 7-step journey for one fresh user', async ({ page, context }) => {
    await dismissWelcomeOnLoad(page)
    // Phase 0: pretend the user played a guest PvAI before signing up. Signup
    // then posts guest-credit which credits Hook step 1 — same path a real
    // visitor takes per V1_Acceptance.md Stage 1.
    await seedGuestHookStep1(page)

    const email    = freshEmail()
    created.email  = email
    const password = 'onb-test-pw-1234'
    // Display name must be unique per run — /users/sync slugs displayName into
    // the username column, which has a UNIQUE constraint. A reused name here
    // causes the second run to fail sync and cascade through later steps.
    const displayName = `Onboard ${Math.random().toString(36).slice(2, 8)}`
    await signUp(page, { email, password, displayName })

    const token  = await fetchAuthToken(context.request, BACKEND_URL)

    // /users/sync mirrors the BetterAuth user → application User row. The UI
    // does this on first authenticated page load; in the API-only test path we
    // call it explicitly so subsequent endpoints can find the User row.
    const syncRes = await context.request.post(`${BACKEND_URL}/api/v1/users/sync`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(syncRes.ok()).toBeTruthy()
    const syncBody = await syncRes.json()
    created.userId = syncBody?.user?.id ?? null

    const tcAtStart = await fetchCreditsTc(context.request, token, created.userId)

    // ── Step 1: Phase 0 PvAI credit ───────────────────────────────────
    // Belt-and-suspenders: SignInModal *should* fire guest-credit on signup
    // when localStorage has hookStep1CompletedAt, but it depends on UI timing.
    // Hit the backend directly so the test is deterministic.
    const guestCreditRes = await context.request.post(`${BACKEND_URL}/api/v1/guide/guest-credit`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data:    { hookStep1CompletedAt: new Date().toISOString() },
    })
    expect(guestCreditRes.ok()).toBeTruthy()
    let completed = await pollForStep(context.request, token, 1, 15_000)
    expect(completed).toEqual(expect.arrayContaining([1]))

    // ── Step 2: demo-table watch + Hook reward (+20 TC) ───────────────
    const { tableId } = await createDemoTable(context.request, token)
    created.demoTableId = tableId
    await page.goto(`/tables/${tableId}`)
    completed = await pollForStep(context.request, token, 2, 120_000)
    expect(completed).toEqual(expect.arrayContaining([1, 2]))
    // Hook reward — TC should bump by guide.rewards.hookComplete (default 20).
    const tcAfterHook = await fetchCreditsTc(context.request, token, created.userId)
    if (tcAtStart != null && tcAfterHook != null) {
      // Allow exact 20 or higher (tester may pre-tune); the gate is "increased".
      expect(tcAfterHook).toBeGreaterThanOrEqual((tcAtStart ?? 0) + 20)
    }

    // ── Step 3: Quick Bot create ──────────────────────────────────────
    const bot = await createQuickBot(context.request, token, `QB ${Math.random().toString(36).slice(2, 8)}`)
    created.botId = bot.id
    completed = await pollForStep(context.request, token, 3, 30_000)
    expect(completed).toEqual(expect.arrayContaining([1, 2, 3]))

    // ── Step 4: Train Guided — real Q-Learning + finalize ─────────────
    // The user-facing journey-step-4 flow opens TrainGuidedModal which posts
    // /train-guided, watches the SSE win-rate sparkline climb, then posts
    // /train-guided/finalize on ml:complete. trainGuided() walks the same
    // server-side sequence (no UI assertions on the live chart — that's
    // covered separately in TrainGuidedModal unit tests).
    const finalizeRes = await trainGuided(context.request, token, bot.id)
    expect(finalizeRes?.bot?.botModelType).toBe('qlearning')
    expect(finalizeRes?.bot?.botModelId).not.toMatch(/^builtin:|^user:/)
    completed = await pollForStep(context.request, token, 4, 30_000)
    expect(completed).toEqual(expect.arrayContaining([1, 2, 3, 4]))

    // ── Step 5: Spar (easy tier) ──────────────────────────────────────
    await spar(context.request, token, bot.id)
    completed = await pollForStep(context.request, token, 5, 60_000)
    expect(completed).toEqual(expect.arrayContaining([1, 2, 3, 4, 5]))

    // ── Step 6: Curriculum Cup clone (participant:joined → step 6) ────
    const cupRes = await cloneCup(context.request, token, bot.id)
    expect(cupRes.tournament?.name).toMatch(/Curriculum Cup/i)
    expect(cupRes.participants).toHaveLength(4)
    expect(cupRes.participants[0].isCallerBot).toBe(true)
    completed = await pollForStep(context.request, token, 6, 30_000)
    expect(completed).toEqual(expect.arrayContaining([1, 2, 3, 4, 5, 6]))

    // ── Step 7: Cup completion + Curriculum reward (+50 TC) ───────────
    const tournamentId = cupRes.tournament.id
    created.tournamentId = tournamentId
    completed = await pollForStep(context.request, token, 7, 240_000)
    expect(completed).toEqual(expect.arrayContaining([1, 2, 3, 4, 5, 6, 7]))

    // Tournament itself reached COMPLETED.
    const tRes = await context.request.get(`${LANDING_URL}/api/tournaments/${tournamentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(tRes.ok()).toBeTruthy()
    expect((await tRes.json()).tournament.status).toBe('COMPLETED')

    // Curriculum-complete reward — +50 TC on top of the prior balance
    // (default guide.rewards.curriculumComplete; tolerate higher if tuned).
    const tcAtEnd = await fetchCreditsTc(context.request, token, created.userId)
    if (tcAfterHook != null && tcAtEnd != null) {
      expect(tcAtEnd).toBeGreaterThanOrEqual(tcAfterHook + 50)
    }

    // ── Phase derivation — should now be 'specialize' ─────────────────
    // (deriveCurrentPhase: step 7 done → 'specialize'). We surface this via
    // /guide/preferences indirectly — completedSteps includes 7 above is
    // the same condition. Final defensive read.
    const final = await fetchProgress(context.request, token)
    expect(final.completedSteps).toEqual(expect.arrayContaining([1, 2, 3, 4, 5, 6, 7]))
  })
})
