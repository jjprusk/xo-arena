/**
 * Journey service — tracks and updates onboarding step completion.
 *
 * Step index  Title
 * ─────────────────────────────────────────────────────────────
 *    1        Welcome (auto-complete on first hydration)
 *    2        Read the FAQ (client-side trigger on /faq visit)
 *    3        Play your first game
 *    4        Explore AI Training Guide (client-side trigger)
 *    5        Create your first bot
 *    6        Train your bot (first training run > 0 episodes)
 *    7        Enter a tournament (first registration)
 *    8        Play in a tournament match
 *
 * On step 8 completion: +50 TC awarded; guide:notification emitted.
 */

import db from '../lib/db.js'
import logger from '../logger.js'

const TOTAL_STEPS = 8
const JOURNEY_COMPLETE_TC = 50

let _io = null
export function setIO(io) { _io = io }

// ── Internal helpers ────────────────────────────────────────────────────────

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
 * Idempotently marks a step complete.
 * Emits `guide:journeyStep` to the user's socket room.
 * On step 7: awards TC, emits `guide:notification`.
 *
 * Returns true if this call completed the step (false if already done).
 */
export async function completeStep(userId, stepIndex, io) {
  const ioRef = io ?? _io
  try {
    const prefs    = await _getPrefs(userId)
    if (!prefs) return false

    const progress = prefs.journeyProgress ?? { completedSteps: [], dismissedAt: null }
    if (progress.completedSteps.includes(stepIndex)) return false   // idempotent

    const completedSteps = [...progress.completedSteps, stepIndex]
    const updated        = { ...prefs, journeyProgress: { ...progress, completedSteps } }
    await _savePrefs(userId, updated)

    // Notify client of step completion
    if (ioRef) {
      ioRef.to(`user:${userId}`).emit('guide:journeyStep', {
        step:          stepIndex,
        completedSteps,
        totalSteps:    TOTAL_STEPS,
      })
    }

    logger.info({ userId, stepIndex, completedSteps }, 'Journey step completed')

    // Step 8 completion reward
    if (stepIndex === 8) {
      await _handleJourneyComplete(userId, ioRef)
    }

    return true
  } catch (err) {
    logger.warn({ err, userId, stepIndex }, 'Journey step completion failed (non-fatal)')
    return false
  }
}

/**
 * Resets journey progress (used by "Restart onboarding" in Settings).
 */
export async function restartJourney(userId) {
  const prefs = await _getPrefs(userId)
  if (!prefs) return
  const updated = { ...prefs, journeyProgress: { completedSteps: [], dismissedAt: null } }
  await _savePrefs(userId, updated)
  logger.info({ userId }, 'Journey restarted')
}

// ── Internal: step-7 completion reward ─────────────────────────────────────

async function _handleJourneyComplete(userId, ioRef) {
  try {
    // Award 50 TC
    await db.user.update({
      where:  { id: userId },
      data:   { creditsTc: { increment: JOURNEY_COMPLETE_TC } },
    })

    // Emit Guide notification
    if (ioRef) {
      ioRef.to(`user:${userId}`).emit('guide:notification', {
        id:        `journey-complete-${userId}`,
        type:      'admin',
        title:     'Onboarding Complete! 🎉',
        body:      `You earned +${JOURNEY_COMPLETE_TC} Tournament Credits. Welcome to the arena!`,
        createdAt: new Date().toISOString(),
        meta:      { journeyComplete: true },
      })
    }

    logger.info({ userId, tc: JOURNEY_COMPLETE_TC }, 'Journey complete — TC awarded')
  } catch (err) {
    logger.warn({ err, userId }, 'Journey completion reward failed (non-fatal)')
  }
}
