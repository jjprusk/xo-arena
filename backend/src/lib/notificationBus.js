/**
 * Notification bus — single dispatch() entry point for all notification events.
 */
import db from './db.js'
import logger from '../logger.js'

let _io = null
export function initBus(io) { _io = io }

// ── Dispatch counters (for monitoring) ───────────────────────────────────────
const _dispatchCounters = {}
export function getDispatchCounters() { return { ..._dispatchCounters } }

// ── Event registry ────────────────────────────────────────────────────────────
// mode: 'personal' | 'cohort' | 'broadcast'
// persist: 'ephemeral' | 'persistent'
const REGISTRY = {
  'tournament.published':            { mode: 'broadcast', persist: 'ephemeral',  email: false },
  'tournament.flash_announced':      { mode: 'broadcast', persist: 'ephemeral',  email: false },
  'tournament.registration_closing': { mode: 'cohort',    persist: 'persistent', email: false },
  'tournament.starting_soon':        { mode: 'cohort',    persist: 'persistent', email: false },
  'tournament.started':              { mode: 'cohort',    persist: 'persistent', email: false },
  'tournament.cancelled':            { mode: 'cohort',    persist: 'persistent', email: true  },
  'tournament.completed':            { mode: 'cohort',    persist: 'persistent', email: true  },
  'match.ready':                     { mode: 'personal',  persist: 'persistent', email: true,  systemCritical: true },
  'match.result':                    { mode: 'personal',  persist: 'persistent', email: false },
  'achievement.tier_upgrade':        { mode: 'personal',  persist: 'persistent', email: false },
  'achievement.milestone':           { mode: 'personal',  persist: 'persistent', email: false },
  'admin.announcement':              { mode: 'broadcast', persist: 'persistent', email: false },
  'system.alert':                    { mode: 'personal',  persist: 'persistent', email: false, systemCritical: true },
  'system.alert.cleared':            { mode: 'personal',  persist: 'persistent', email: false, systemCritical: true },
}

// ── Default preferences (used when no NotificationPreference row exists) ──────
const PREF_DEFAULTS = {
  'tournament.published':            { inApp: true,  email: false },
  'tournament.flash_announced':      { inApp: true,  email: false },
  'tournament.registration_closing': { inApp: true,  email: false },
  'tournament.starting_soon':        { inApp: true,  email: false },
  'tournament.started':              { inApp: true,  email: false },
  'tournament.cancelled':            { inApp: true,  email: true  },
  'tournament.completed':            { inApp: true,  email: true  },
  'match.ready':                     { inApp: true,  email: true  },
  'match.result':                    { inApp: true,  email: false },
  'achievement.tier_upgrade':        { inApp: true,  email: false },
  'achievement.milestone':           { inApp: true,  email: false },
  'admin.announcement':              { inApp: true,  email: false },
  'system.alert':                    { inApp: true,  email: false },
  'system.alert.cleared':            { inApp: true,  email: false },
}

/**
 * dispatch({ type, targets, payload })
 *
 * targets: { userId: string }
 *        | { cohort: string[] }
 *        | { broadcast: true }
 *
 * Never throws — all errors are caught and logged.
 */
export async function dispatch({ type, targets, payload = {} }) {
  try {
    // Increment dispatch counter for monitoring
    _dispatchCounters[type] = (_dispatchCounters[type] ?? 0) + 1

    const entry = REGISTRY[type]
    if (!entry) {
      logger.warn({ type }, 'dispatch(): unknown event type — skipping')
      return
    }

    // Resolve target user IDs
    let userIds = []
    if (targets?.broadcast) {
      if (entry.persist === 'persistent') {
        // All authenticated users — for broadcast+persistent (e.g. admin.announcement)
        const users = await db.user.findMany({ select: { id: true } })
        userIds = users.map(u => u.id)
      }
      // Emit to all sockets regardless
      if (_io) {
        _io.emit('guide:notification', { type, payload })
      }
      if (entry.persist !== 'persistent') return  // ephemeral broadcast done
    } else if (targets?.cohort) {
      userIds = targets.cohort.filter(Boolean)
    } else if (targets?.userId) {
      userIds = [targets.userId]
    }

    if (userIds.length === 0) return

    // For broadcast+persistent: use createMany for efficiency
    if (targets?.broadcast && entry.persist === 'persistent') {
      await db.userNotification.createMany({
        data: userIds.map(userId => ({ userId, type, payload })),
        skipDuplicates: true,
      })
      return
    }

    // Load preferences in bulk
    const prefRows = await db.notificationPreference.findMany({
      where: { userId: { in: userIds }, eventType: type },
    })
    const prefMap = {}
    for (const row of prefRows) prefMap[row.userId] = row

    // Per-user delivery
    await Promise.all(userIds.map(async (userId) => {
      try {
        const pref = prefMap[userId] ?? PREF_DEFAULTS[type] ?? { inApp: true, email: false }

        // Skip non-critical events for opted-out users
        if (!pref.inApp && !entry.systemCritical) return

        // Dedup: skip if undelivered row already exists for same type+key
        if (entry.persist === 'persistent') {
          const dedupFilter = buildDedupFilter(type, payload)
          const existing = await db.userNotification.findFirst({
            where: { userId, type, deliveredAt: null, ...dedupFilter },
          })
          if (existing) return
          await db.userNotification.create({ data: { userId, type, payload } })
        }

        // Emit to socket room
        if (_io) {
          _io.to(`user:${userId}`).emit('guide:notification', { type, payload })
        }

        // TODO: email delivery (Phase 4 — notificationService.js refactor will wire this)
      } catch (err) {
        logger.warn({ err, userId, type }, 'dispatch(): per-user delivery failed (non-fatal)')
      }
    }))
  } catch (err) {
    logger.warn({ err, type }, 'dispatch(): unexpected error (non-fatal)')
  }
}

function buildDedupFilter(type, payload) {
  if (type === 'achievement.tier_upgrade') {
    return { payload: { path: ['tier'], equals: payload.tier } }
  }
  if (type === 'achievement.milestone') {
    return { payload: { path: ['score'], equals: payload.score } }
  }
  return {}
}

export function getRegistryKeys() { return Object.keys(REGISTRY) }
