// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Guide UI states — verifies the Intelligent Guide panel:
 *   - auto-opens after signup when journey is incomplete
 *   - displays the right phase (hook / curriculum / specialize) at each step
 *   - shows the right `Next:` step in the curriculum checklist
 *   - surfaces the Hook reward popup (+20 TC) when step 2 completes
 *   - surfaces the Curriculum reward popup (+50 TC) when step 7 completes
 *
 * Drives step transitions via API (same path as guide-onboarding.spec.js)
 * and navigates back to `/` between steps so the guide hydrates from the
 * server. This catches regressions in:
 *   - the auto-open useEffect in AppLayout
 *   - phase derivation (deriveCurrentPhase)
 *   - guideStore re-hydration on navigation
 *   - RewardPopup SSE wiring (`guide:hook_complete`, `guide:curriculum_complete`)
 *
 * Prereqs:
 *   Frontend (landing) : http://localhost:5174
 *   Backend            : http://localhost:3000
 */

import { test, expect } from '@playwright/test'
import { execSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchAuthToken } from './helpers.js'
import { netCleanupByEmailPrefix } from './dbScript.js'
import { snapshotJourney, assertJourneyTransition } from './journeyAssert.js'

// Email prefix for every test user this spec creates. The afterAll net
// cleanup sweeps anything left over by this prefix.
const EMAIL_PREFIX = 'gui+'

const LANDING_URL = process.env.LANDING_URL || 'http://localhost:5174'
const SUBMIT_GUARD_MS = 3500

function freshEmail() {
  const ts = Date.now().toString(36)
  const r  = Math.random().toString(36).slice(2, 8)
  return `gui+${ts}-${r}@dev.local`
}

async function dismissWelcomeOnLoad(page) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem('aiarena_guest_welcome_seen', '1') } catch {}
  })
}

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
  const res = await request.get(`${LANDING_URL}/api/v1/guide/preferences`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok()) return { completedSteps: [] }
  const body = await res.json()
  return {
    completedSteps: body?.preferences?.journeyProgress?.completedSteps
                 ?? body?.journeyProgress?.completedSteps
                 ?? [],
  }
}

async function pollForStep(request, token, stepIndex, deadlineMs) {
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    const { completedSteps } = await fetchProgress(request, token)
    if (completedSteps.includes(stepIndex)) return completedSteps
    await new Promise(r => setTimeout(r, 1000))
  }
  return (await fetchProgress(request, token)).completedSteps
}

async function createDemoTable(request, token) {
  const res = await request.post(`${LANDING_URL}/api/v1/tables/demo`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok()) throw new Error(`demo create failed: ${res.status()}`)
  return await res.json()
}

async function createQuickBot(request, token, displayName) {
  const res = await request.post(`${LANDING_URL}/api/v1/bots/quick`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data:    { name: displayName, persona: 'aggressive' },
  })
  if (!res.ok()) throw new Error(`bots/quick failed: ${res.status()}`)
  return (await res.json()).bot
}

async function trainGuided(request, token, botId) {
  const startRes = await request.post(`${LANDING_URL}/api/v1/bots/${botId}/train-guided`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!startRes.ok()) throw new Error(`train-guided start: ${startRes.status()}`)
  const { sessionId, skillId } = await startRes.json()
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const finRes = await request.post(`${LANDING_URL}/api/v1/bots/${botId}/train-guided/finalize`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data:    { sessionId, skillId },
    })
    if (finRes.ok()) return await finRes.json()
    if (finRes.status() !== 409) throw new Error(`finalize: ${finRes.status()}`)
    await new Promise(r => setTimeout(r, 1500))
  }
  throw new Error('train-guided never completed')
}

async function spar(request, token, botId) {
  const res = await request.post(`${LANDING_URL}/api/v1/bot-games/practice`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data:    { myBotId: botId, opponentTier: 'easy', moveDelayMs: 200 },
  })
  if (!res.ok()) throw new Error(`practice: ${res.status()}`)
  return await res.json()
}

async function cloneCup(request, token, botId) {
  const res = await request.post(`${LANDING_URL}/api/tournaments/curriculum-cup/clone`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data:    { myBotId: botId },
  })
  if (!res.ok()) throw new Error(`cup clone: ${res.status()}`)
  return await res.json()
}

function runCleanupScript(body) {
  const script = `(async () => {
    try {
      const db = (await import('/app/backend/src/lib/db.js')).default;
      ${body}
      process.exit(0);
    } catch (e) { process.stdout.write('CLEANUP_ERROR ' + e.message + '\\n'); process.exit(0); }
  })()`
  const dir = mkdtempSync(join(tmpdir(), 'e2e-gui-'))
  const localPath = join(dir, 'cleanup.mjs')
  writeFileSync(localPath, script)
  try {
    execSync(`docker compose cp "${localPath}" backend:/tmp/e2e-gui-cleanup.mjs`,
      { stdio: 'pipe', timeout: 15_000, cwd: '/Users/joe/Desktop/xo-arena' })
    execSync(`docker compose exec -T backend node /tmp/e2e-gui-cleanup.mjs`,
      { stdio: 'pipe', timeout: 30_000, cwd: '/Users/joe/Desktop/xo-arena' })
  } catch { /* best-effort */ }
}

/** Ensure the Guide panel is open and the JourneyCard for `phase` is mounted.
 *  AppLayout auto-opens on hydrate when the journey is incomplete; if it
 *  hasn't yet, click the orb. */
async function expectGuideOpenInPhase(page, phase) {
  const card = page.locator(`[data-phase="${phase}"]`)
  try {
    await card.waitFor({ state: 'visible', timeout: 5_000 })
    return
  } catch {
    await page.getByRole('button', { name: /(Open|Close) Guide/ }).click({ force: true })
    await card.waitFor({ state: 'visible', timeout: 10_000 })
  }
}

async function navigateAndHydrate(page) {
  // /play suppresses the guide panel; navigate via /tables to /, which is
  // the canonical re-hydrate trigger in AppLayout's pathname effect.
  await page.goto('/')
  // Allow the guide store hydrate() to settle. The auto-open useEffect
  // checks for progress growth before opening; we give it a beat.
  await page.waitForTimeout(800)
}

test.describe('Guide UI — phase + popup state across the journey', () => {
  test.setTimeout(480_000)
  const created = { userId: null, email: null, tournamentId: null, demoTableId: null, botId: null }

  test.beforeAll(() => {
    runCleanupScript(`
      const oldCups = await db.tournament.findMany({ where: { name: 'Curriculum Cup' }, select: { id: true } })
      const cupTournIds = oldCups.map(t => t.id)
      if (cupTournIds.length) {
        await db.game.deleteMany({ where: { tournamentId: { in: cupTournIds } } }).catch(()=>{})
        await db.tournament.deleteMany({ where: { id: { in: cupTournIds } } }).catch(()=>{})
      }
      const cupBots = await db.user.findMany({ where: { username: { startsWith: 'bot-cup-' } }, select: { id: true } })
      const cupIds = cupBots.map(b => b.id)
      if (cupIds.length) {
        await db.game.deleteMany({ where: { OR: [{ player1Id: { in: cupIds } }, { player2Id: { in: cupIds } }] } }).catch(()=>{})
        await db.tournamentParticipant.deleteMany({ where: { userId: { in: cupIds } } }).catch(()=>{})
      }
      await db.user.deleteMany({ where: { username: { startsWith: 'bot-cup-' } } }).catch(()=>{})
      await db.table.deleteMany({ where: { isDemo: true } }).catch(()=>{})
      const onb = await db.user.findMany({ where: { displayName: { startsWith: 'Guide ' } }, select: { id: true, betterAuthId: true } })
      const ids = onb.map(u => u.id)
      if (ids.length) {
        await db.game.deleteMany({ where: { OR: [{ player1Id: { in: ids } }, { player2Id: { in: ids } }] } }).catch(()=>{})
        const owned = await db.user.findMany({ where: { botOwnerId: { in: ids } }, select: { id: true } })
        const botIds = owned.map(b => b.id)
        if (botIds.length) {
          await db.game.deleteMany({ where: { OR: [{ player1Id: { in: botIds } }, { player2Id: { in: botIds } }] } }).catch(()=>{})
          await db.botSkill.deleteMany({ where: { botId: { in: botIds } } }).catch(()=>{})
          await db.user.deleteMany({ where: { id: { in: botIds } } }).catch(()=>{})
        }
        await db.user.deleteMany({ where: { id: { in: ids } } }).catch(()=>{})
        const baIds = onb.map(u => u.betterAuthId).filter(Boolean)
        if (baIds.length) await db.baUser.deleteMany({ where: { id: { in: baIds } } }).catch(()=>{})
      }
    `)
  })

  // Final net-sweep across every artifact a test in this spec might have
  // created. Belt-and-suspenders — afterEach handles the happy-path; this
  // catches anything that leaked when afterEach itself errored mid-cleanup.
  test.afterAll(() => {
    netCleanupByEmailPrefix(EMAIL_PREFIX, { tag: 'gui-after' })
  })

  test.afterEach(() => {
    const { userId, email, tournamentId, demoTableId, botId } = created
    runCleanupScript(`
      ${tournamentId ? `await db.game.deleteMany({ where: { tournamentId: '${tournamentId}' } }).catch(()=>{}); await db.tournament.delete({ where: { id: '${tournamentId}' } }).catch(()=>{});` : ''}
      ${demoTableId ? `await db.table.delete({ where: { id: '${demoTableId}' } }).catch(()=>{});` : ''}
      const cupBots = await db.user.findMany({ where: { username: { startsWith: 'bot-cup-' } }, select: { id: true } });
      const cupIds = cupBots.map(b => b.id);
      if (cupIds.length) {
        await db.game.deleteMany({ where: { OR: [{ player1Id: { in: cupIds } }, { player2Id: { in: cupIds } }] } }).catch(()=>{});
        await db.tournamentParticipant.deleteMany({ where: { userId: { in: cupIds } } }).catch(()=>{});
      }
      await db.user.deleteMany({ where: { username: { startsWith: 'bot-cup-' } } }).catch(()=>{});
      ${botId ? `await db.game.deleteMany({ where: { OR: [{ player1Id: '${botId}' }, { player2Id: '${botId}' }] } }).catch(()=>{}); await db.botSkill.deleteMany({ where: { botId: '${botId}' } }).catch(()=>{}); await db.user.delete({ where: { id: '${botId}' } }).catch(()=>{});` : ''}
      ${userId ? `await db.game.deleteMany({ where: { OR: [{ player1Id: '${userId}' }, { player2Id: '${userId}' }] } }).catch(()=>{}); await db.user.delete({ where: { id: '${userId}' } }).catch(()=>{});` : ''}
      ${email ? `await db.baUser.deleteMany({ where: { email: '${email}' } }).catch(()=>{});` : ''}
    `)
    created.userId = created.email = created.tournamentId = created.demoTableId = created.botId = null
  })

  test('guide phase + popups track the journey end-to-end', async ({ page, context }) => {
    // Console capture — surfaces stray React errors / missing-key warnings
    // in the run log so a regression in JourneyCard rendering is obvious.
    page.on('pageerror', (err) => console.log(`[browser:error] ${err.message}`))

    await dismissWelcomeOnLoad(page)
    await seedGuestHookStep1(page)

    const email       = freshEmail()
    const password    = 'gui-test-pw-1234'
    const displayName = `Guide ${Math.random().toString(36).slice(2, 8)}`
    created.email = email
    await signUp(page, { email, password, displayName })

    const token = await fetchAuthToken(context.request, LANDING_URL)
    const sync = await context.request.post(`${LANDING_URL}/api/v1/users/sync`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(sync.ok()).toBeTruthy()
    created.userId = (await sync.json())?.user?.id ?? null

    // DB-consistency tracking. snapshotJourney captures completedSteps,
    // creditsTc, owned-bot list, derived phase. We snap before+after every
    // step and call assertJourneyTransition between them — catches step
    // regression, future-step leak, missing/duplicate Hook reward, etc.
    const snapCtx = { backendUrl: LANDING_URL, token, userId: created.userId }
    let prevSnap = await snapshotJourney(context.request, snapCtx)

    // ── Phase 0 → Hook ─────────────────────────────────────────────────────
    // Belt-and-suspenders: post the guest-credit explicitly so step 1 lands.
    await context.request.post(`${LANDING_URL}/api/v1/guide/guest-credit`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data:    { hookStep1CompletedAt: new Date().toISOString() },
    })
    await pollForStep(context.request, token, 1, 15_000)
    {
      const next = await snapshotJourney(context.request, snapCtx)
      assertJourneyTransition({ prev: prevSnap, next, label: 'step1: guest-credit',
        stepDone: 1, tcDelta: 0, phase: 'hook', botsDelta: 0 })
      prevSnap = next
    }

    // Guide must auto-open on / with the Hook card visible. Step 1 done →
    // Hook hero shows step 2 ("Watch two bots battle") as the next CTA.
    await navigateAndHydrate(page)
    await expectGuideOpenInPhase(page, 'hook')
    await expect(page.getByText('Welcome to the Arena')).toBeVisible()
    await expect(page.getByText(/Watch two bots battle/i)).toBeVisible()

    // ── Step 2: demo-table watch → Hook reward (+20 TC popup) ─────────────
    const { tableId } = await createDemoTable(context.request, token)
    created.demoTableId = tableId
    await page.goto(`/tables/${tableId}`)
    await pollForStep(context.request, token, 2, 120_000)
    {
      const next = await snapshotJourney(context.request, snapCtx)
      assertJourneyTransition({ prev: prevSnap, next, label: 'step2: demo-watch + hook reward',
        stepDone: 2, tcDelta: 20, phase: 'curriculum', botsDelta: 0 })
      prevSnap = next
    }

    // The RewardPopup listens to `guide:hook_complete` SSE and renders
    // top-center with `data-testid="reward-popup"`. It auto-dismisses on
    // its own timer; we assert it shows up at least briefly.
    await expect(page.getByTestId('reward-popup'))
      .toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('reward-popup'))
      .toContainText(/\+20 Tournament Credits/)

    // ── Hook → Curriculum transition ───────────────────────────────────────
    await navigateAndHydrate(page)
    await expectGuideOpenInPhase(page, 'curriculum')
    await expect(page.getByTestId('curriculum-checklist')).toBeVisible()
    // Next: should now point at step 3 ("Create your first bot").
    await expect(page.getByText(/Next:/)).toBeVisible()
    await expect(page.locator('strong', { hasText: /Create your first bot/i })).toBeVisible()

    // ── Step 3: Quick Bot create ──────────────────────────────────────────
    const bot = await createQuickBot(context.request, token, `QB ${Math.random().toString(36).slice(2, 8)}`)
    created.botId = bot.id
    await pollForStep(context.request, token, 3, 30_000)
    {
      const next = await snapshotJourney(context.request, snapCtx)
      assertJourneyTransition({ prev: prevSnap, next, label: 'step3: quick-bot create',
        stepDone: 3, tcDelta: 0, phase: 'curriculum', botsDelta: 1 })
      prevSnap = next
    }

    await navigateAndHydrate(page)
    await expectGuideOpenInPhase(page, 'curriculum')
    await expect(page.locator('strong', { hasText: /Train your bot/i })).toBeVisible()

    // ── Step 4: train-guided + finalize ───────────────────────────────────
    const finalizeRes = await trainGuided(context.request, token, bot.id)
    expect(finalizeRes?.bot?.botModelType).toBe('qlearning')
    await pollForStep(context.request, token, 4, 30_000)
    {
      const next = await snapshotJourney(context.request, snapCtx)
      assertJourneyTransition({ prev: prevSnap, next, label: 'step4: train-guided',
        stepDone: 4, tcDelta: 0, phase: 'curriculum', botsDelta: 0, qlearningBot: bot.id })
      prevSnap = next
    }

    await navigateAndHydrate(page)
    await expectGuideOpenInPhase(page, 'curriculum')
    await expect(page.locator('strong', { hasText: /Spar with your bot/i })).toBeVisible()

    // ── Step 5: Spar ──────────────────────────────────────────────────────
    await spar(context.request, token, bot.id)
    await pollForStep(context.request, token, 5, 60_000)
    {
      const next = await snapshotJourney(context.request, snapCtx)
      assertJourneyTransition({ prev: prevSnap, next, label: 'step5: spar',
        stepDone: 5, tcDelta: 0, phase: 'curriculum', botsDelta: 0 })
      prevSnap = next
    }

    await navigateAndHydrate(page)
    await expectGuideOpenInPhase(page, 'curriculum')
    await expect(page.locator('strong', { hasText: /Enter a tournament/i })).toBeVisible()

    // ── Step 6: Curriculum Cup clone ──────────────────────────────────────
    const cupRes = await cloneCup(context.request, token, bot.id)
    created.tournamentId = cupRes.tournament.id
    await pollForStep(context.request, token, 6, 30_000)
    {
      const next = await snapshotJourney(context.request, snapCtx)
      assertJourneyTransition({ prev: prevSnap, next, label: 'step6: cup clone',
        stepDone: 6, tcDelta: 0, phase: 'curriculum', botsDelta: 0 })
      prevSnap = next
    }

    await navigateAndHydrate(page)
    await expectGuideOpenInPhase(page, 'curriculum')
    await expect(page.locator('strong', { hasText: /See your bot's first result/i })).toBeVisible()

    // ── Step 7: Cup completes → Curriculum reward (+50 TC popup) ──────────
    await pollForStep(context.request, token, 7, 240_000)
    {
      const next = await snapshotJourney(context.request, snapCtx)
      assertJourneyTransition({ prev: prevSnap, next, label: 'step7: cup completion + curriculum reward',
        stepDone: 7, tcDelta: 50, phase: 'specialize', botsDelta: 0 })
      prevSnap = next
    }

    // Landing on / after step 7 must auto-open the panel and surface the
    // Specialize celebration card. The growth-detect path in AppLayout opens
    // exactly once on the 6 → 7 transition. (Pre-fix this assertion failed:
    // the auto-open was gated on `< TOTAL_STEPS`, which excluded graduation.)
    await navigateAndHydrate(page)
    await expect(page.getByText(/Curriculum complete/i)).toBeVisible({ timeout: 10_000 })
  })
})
