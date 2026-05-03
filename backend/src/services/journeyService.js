// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Journey service — the 7-step Hook + Curriculum onboarding spec per
 * Intelligent_Guide_Requirements.md §4.
 *
 * All triggers are server-detectable — no more client-posted step events.
 *
 *  Phase / Step                     Trigger                                  Reward
 *  ───────────────────────────────  ──────────────────────────────────────  ──────────
 *   1  Hook:        Play PvAI      first completed PvAI game for user       —
 *   2  Hook:        Watch bots     demo-table spectated ≥ 2 min (§5.1)      +20 TC
 *   3  Curriculum:  Create a bot   user-owned bot created                   —
 *   4  Curriculum:  Train bot      first training run / Quick Bot bump      —
 *   5  Curriculum:  Spar           user bot plays casual match (§5.2)       —
 *   6  Curriculum:  Enter tourney  tournament participant row with own bot  —
 *   7  Curriculum:  See result     tournament COMPLETED + finalPosition     +50 TC
 *
 * On step 2: awards Hook TC + emits `guide:hook_complete`.
 * On step 7: awards Curriculum TC + emits `guide:curriculum_complete` and
 *            `guide:specialize_start` (single transition, two events so clients
 *            can distinguish "just finished Curriculum" from "now in Specialize").
 *
 * Phase derivation (§3 of requirements):
 *   Hook        — 0 or 1 of steps {1, 2} done, step 2 not yet done
 *   Curriculum  — step 2 done, step 7 not yet done
 *   Specialize  — step 7 done
 *
 * Reward amounts are admin-tunable via SystemConfig keys:
 *   `guide.rewards.hookComplete`       default 20
 *   `guide.rewards.curriculumComplete` default 50
 */

import db from '../lib/db.js'
import logger from '../logger.js'
import { experimentVariant } from './experimentService.js'
import { appendToStream } from '../lib/eventStream.js'

export const TOTAL_STEPS      = 7
export const HOOK_STEPS       = [1, 2]
export const CURRICULUM_STEPS = [3, 4, 5, 6, 7]
const HOOK_REWARD_STEP         = 2
const CURRICULUM_REWARD_STEP   = 7

export const STEP_TITLES = {
  1: 'Play a quick game',
  2: 'Watch two bots battle',
  3: 'Create your first bot',
  4: 'Train your bot',
  5: 'Spar with your bot',
  6: 'Enter a tournament',
  7: 'See your bot’s first result',
}

const DEFAULT_HOOK_REWARD_TC       = 20
const DEFAULT_CURRICULUM_REWARD_TC = 50

// ── Internal helpers ────────────────────────────────────────────────────────

async function _getSystemConfig(key, defaultValue) {
  const row = await db.systemConfig.findUnique({ where: { key } })
  if (!row) return defaultValue
  try { return JSON.parse(row.value) } catch { return row.value }
}

async function _getUser(userId) {
  return db.user.findUnique({
    where: { id: userId },
    select: { id: true, preferences: true },
  })
}

async function _getPrefs(userId) {
  const user = await _getUser(userId)
  return user ? (user.preferences ?? {}) : null
}

async function _savePrefs(userId, prefs) {
  await db.user.update({ where: { id: userId }, data: { preferences: prefs } })
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns { completedSteps, dismissedAt } for a user.
 */
export async function getJourneyProgress(userId) {
  const prefs = await _getPrefs(userId)
  if (!prefs) return { completedSteps: [], dismissedAt: null }
  return prefs.journeyProgress ?? { completedSteps: [], dismissedAt: null }
}

/**
 * Derives the current phase from a completedSteps array.
 * Pure function — safe to call anywhere.
 */
export function deriveCurrentPhase(completedSteps = []) {
  const done = new Set(completedSteps)
  if (done.has(CURRICULUM_REWARD_STEP)) return 'specialize'
  if (done.has(HOOK_REWARD_STEP))       return 'curriculum'
  return 'hook'
}

/**
 * Idempotently marks a step complete.
 *
 * Returns true if this call completed the step (false if already done or user
 * not found). Non-fatal on any error (logs a warn, returns false).
 *
 * Concurrency: the read-modify-write of `preferences.journeyProgress` runs
 * inside a transaction guarded by a per-user Postgres advisory lock
 * (`pg_advisory_xact_lock(hashtext(userId))`). Without this, two simultaneous
 * calls (multi-tab, or two backend pods reacting to the same Redis event)
 * would both pass the "already includes step" check and both fire the
 * phase-boundary reward — paying +20 / +50 TC twice. The lock auto-releases
 * at transaction end. SSE notifications and the reward grant are
 * intentionally outside the transaction: the `creditsTc.increment` is
 * already an atomic single-statement update, and SSE writes are
 * fire-and-forget.
 */
export async function completeStep(userId, stepIndex, _io) {
  if (!Number.isInteger(stepIndex) || stepIndex < 1 || stepIndex > TOTAL_STEPS) {
    logger.warn({ userId, stepIndex }, 'Journey step index out of range')
    return false
  }
  try {
    // Sprint 6 — V1 release gate. When the flag is off, journey credits
    // become a no-op (the rest of the platform — games, bots, tournaments
    // — keeps working). Default true: flag is opt-out for staging, opt-in
    // for the production rollout. Read fresh per call so admin can flip
    // without a restart; cost is one indexed lookup, dominated by the
    // user.findUnique that follows. Inside the try/catch so a SystemConfig
    // outage fails closed (returns false, no crash) — task #33 caught a
    // regression where this lookup propagated errors out and broke every
    // step-completion call site.
    const enabled = await _getSystemConfig('guide.v1.enabled', true)
    if (enabled === false) return false
    const completedSteps = await db.$transaction(async (tx) => {
      // Per-user advisory lock — second concurrent call for the same user
      // queues here until the first transaction commits and releases.
      // hashtext() returns int4; collisions just queue (correctness still
      // intact via the includes() dedup below).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`

      const user = await tx.user.findUnique({
        where:  { id: userId },
        select: { id: true, preferences: true },
      })
      if (!user) return null

      const prefs    = user.preferences ?? {}
      const progress = prefs.journeyProgress ?? { completedSteps: [], dismissedAt: null }
      if (progress.completedSteps.includes(stepIndex)) return null  // idempotent

      const next    = [...progress.completedSteps, stepIndex].sort((a, b) => a - b)
      const updated = { ...prefs, journeyProgress: { ...progress, completedSteps: next } }
      await tx.user.update({ where: { id: userId }, data: { preferences: updated } })
      return next
    })

    if (completedSteps === null) return false

    // Notify client of step completion
    const journeyStepPayload = {
      step:          stepIndex,
      completedSteps,
      totalSteps:    TOTAL_STEPS,
      phase:         deriveCurrentPhase(completedSteps),
    }
    appendToStream('guide:journeyStep', journeyStepPayload, { userId }).catch(() => {})

    logger.info({ userId, stepIndex, completedSteps }, 'Journey step completed')

    // Phase-boundary rewards
    if (stepIndex === HOOK_REWARD_STEP)       await _handleHookComplete(userId)
    if (stepIndex === CURRICULUM_REWARD_STEP) await _handleCurriculumComplete(userId)

    return true
  } catch (err) {
    logger.warn({ err, userId, stepIndex }, 'Journey step completion failed (non-fatal)')
    return false
  }
}

/**
 * Resets journey progress (used by "Restart onboarding" in Settings, and by
 * `um journey --reset`). Does NOT re-lock SlotGrid or revoke already-granted
 * TC — per requirements §9.3, earned shortcuts stay earned even on restart.
 */
export async function restartJourney(userId) {
  const prefs = await _getPrefs(userId)
  if (!prefs) return
  const updated = { ...prefs, journeyProgress: { completedSteps: [], dismissedAt: null } }
  await _savePrefs(userId, updated)
  logger.info({ userId }, 'Journey restarted')
}

// ── Internal: phase-boundary rewards ────────────────────────────────────────

async function _handleHookComplete(userId) {
  const reward = await _getSystemConfig('guide.rewards.hookComplete', DEFAULT_HOOK_REWARD_TC)
  // Sprint 6 — A/B surface (Sprint6_Kickoff §3.4 / Resume §2 #22). v1 has no
  // experiment defined so this returns 'control' for every user; v1.1 swaps in
  // a reward-amount split via the SystemConfig key
  // `guide.experiments.reward.amount.buckets`.
  const variant = await experimentVariant(userId, 'reward.amount', 'control')
  try {
    await db.user.update({
      where: { id: userId },
      data:  { creditsTc: { increment: reward } },
    })

    const hookPayload = {
      reward,
      message: `You earned +${reward} TC — welcome to the Arena.`,
    }
    appendToStream('guide:hook_complete', hookPayload, { userId }).catch(() => {})

    logger.info({ userId, reward, variant }, 'Hook complete — TC awarded')
  } catch (err) {
    logger.warn({ err, userId }, 'Hook-complete reward failed (non-fatal)')
  }
}

async function _handleCurriculumComplete(userId) {
  const reward  = await _getSystemConfig('guide.rewards.curriculumComplete', DEFAULT_CURRICULUM_REWARD_TC)
  const variant = await experimentVariant(userId, 'reward.amount', 'control')
  try {
    await db.user.update({
      where: { id: userId },
      data:  { creditsTc: { increment: reward } },
    })

    const curriculumPayload = {
      reward,
      message: `You earned +${reward} TC.`,
    }
    const specializePayload = {
      message: 'Welcome to Specialize — personalized recommendations unlocked.',
    }
    // Two distinct events — lets clients distinguish "just finished
    // Curriculum (celebrate)" from "now in Specialize (swap UI)".
    appendToStream('guide:curriculum_complete', curriculumPayload, { userId }).catch(() => {})
    appendToStream('guide:specialize_start',    specializePayload,  { userId }).catch(() => {})

    logger.info({ userId, reward, variant }, 'Curriculum complete — TC awarded + Specialize start emitted')
  } catch (err) {
    logger.warn({ err, userId }, 'Curriculum-complete reward failed (non-fatal)')
  }
}
