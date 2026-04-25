// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Discovery rewards — Sprint 5 (Intelligent_Guide_Requirements.md §5.7, §8.4).
 *
 * Four one-shot rewards that fire on detected behaviour outside the linear
 * 7-step journey. Each is idempotent — granted at most once per user, ever.
 *
 *   key                       default TC   trigger (server-detected)
 *   ────────────────────────  ──────────  ────────────────────────────────────
 *   firstSpecializeAction     10          first Specialize recommendation
 *                                          acted on (v1.1 — wired but no
 *                                          production caller in v1)
 *   firstRealTournamentWin    25          first tournament win where the
 *                                          tournament is NOT a Curriculum
 *                                          Cup clone
 *   firstNonDefaultAlgorithm  10          first bot trained with a non-
 *                                          default (non-minimax) algorithm
 *   firstTemplateClone        10          first tournament-template clone
 *                                          (v1.1 — wired but no production
 *                                          caller in v1; Curriculum Cup
 *                                          clones are deliberately excluded)
 *
 * Dedupe key: `user.preferences.discoveryRewardsGranted: string[]` — the
 * presence of a key in that array means the reward has been paid.
 *
 * Reward amounts are admin-tunable via SystemConfig keys
 * `guide.rewards.discovery.<key>` (e.g. `guide.rewards.discovery.firstRealTournamentWin`).
 */

import db from '../lib/db.js'
import logger from '../logger.js'

export const DISCOVERY_REWARDS = {
  firstSpecializeAction:    { defaultTc: 10, title: 'First specialization!',   body: 'The Guide is working for you — first Specialize action.' },
  firstRealTournamentWin:   { defaultTc: 25, title: 'First open-tourney win!', body: 'Your bot took an open tournament — nicely done.' },
  firstNonDefaultAlgorithm: { defaultTc: 10, title: 'New algorithm unlocked!', body: 'You trained with a non-default algorithm.' },
  firstTemplateClone:       { defaultTc: 10, title: 'First template clone!',   body: 'You spun up a tournament from a template.' },
}

export const DISCOVERY_REWARD_KEYS = Object.freeze(Object.keys(DISCOVERY_REWARDS))

let _io = null
export function setIO(io) { _io = io }

// ── Internal helpers ────────────────────────────────────────────────────────

async function _getSystemConfig(key, defaultValue) {
  const row = await db.systemConfig.findUnique({ where: { key } })
  if (!row) return defaultValue
  try { return JSON.parse(row.value) } catch { return row.value }
}

async function _getUser(userId) {
  return db.user.findUnique({
    where:  { id: userId },
    select: { id: true, preferences: true },
  })
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns the list of discovery-reward keys that have been granted to the
 * user. Empty array if user has none / not found.
 */
export async function getGrantedRewards(userId) {
  const user = await _getUser(userId)
  if (!user) return []
  const prefs = user.preferences ?? {}
  const granted = prefs.discoveryRewardsGranted
  return Array.isArray(granted) ? granted : []
}

/**
 * Idempotently grants a discovery reward.
 *
 * Returns true if this call newly granted the reward (false if already granted,
 * unknown key, user missing, or any error). Never throws — non-fatal on all
 * paths so a misfire from an event handler won't tank the originating action.
 */
export async function grantDiscoveryReward(userId, rewardKey, io) {
  const ioRef = io ?? _io
  const meta  = DISCOVERY_REWARDS[rewardKey]
  if (!meta) {
    logger.warn({ userId, rewardKey }, 'Unknown discovery-reward key — ignoring')
    return false
  }
  try {
    const user = await _getUser(userId)
    if (!user) return false

    const prefs   = user.preferences ?? {}
    const granted = Array.isArray(prefs.discoveryRewardsGranted)
      ? prefs.discoveryRewardsGranted
      : []
    if (granted.includes(rewardKey)) return false   // idempotent

    const reward = await _getSystemConfig(
      `guide.rewards.discovery.${rewardKey}`,
      meta.defaultTc
    )

    const updatedPrefs = {
      ...prefs,
      discoveryRewardsGranted: [...granted, rewardKey],
    }

    // Two writes (prefs + TC) — keep them sequential. Failure on the TC
    // write would otherwise leave the dedupe-key set without a payout, but
    // that's acceptable: re-running the action would not double-pay, and
    // the warning log surfaces it for ops.
    await db.user.update({
      where: { id: userId },
      data:  {
        preferences: updatedPrefs,
        creditsTc:   { increment: reward },
      },
    })

    if (ioRef) {
      ioRef.to(`user:${userId}`).emit('guide:discovery_reward', {
        rewardKey,
        reward,
        title: meta.title,
        body:  `+${reward} TC — ${meta.body}`,
      })
      ioRef.to(`user:${userId}`).emit('guide:notification', {
        id:        `discovery-${rewardKey}-${userId}`,
        type:      'reward',
        title:     meta.title,
        body:      `+${reward} Tournament Credits.`,
        createdAt: new Date().toISOString(),
        meta:      { discoveryReward: rewardKey, reward },
      })
    }

    logger.info({ userId, rewardKey, reward }, 'Discovery reward granted')
    return true
  } catch (err) {
    logger.warn({ err, userId, rewardKey }, 'Discovery reward grant failed (non-fatal)')
    return false
  }
}
