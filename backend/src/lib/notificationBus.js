// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Notification bus — single dispatch() entry point for all notification events.
 */
import db from './db.js'
import logger from '../logger.js'

let _io = null
export function initBus(io) { _io = io }
export function emitToRoom(room, event, payload) { if (_io) _io.to(room).emit(event, payload) }

// ── Dispatch counters (for monitoring) ───────────────────────────────────────
const _dispatchCounters = {}
export function getDispatchCounters() { return { ..._dispatchCounters } }

// ── Event registry ────────────────────────────────────────────────────────────
// mode: 'personal' | 'cohort' | 'broadcast'
// persist: 'ephemeral' | 'persistent'
// ttlMs: optional default TTL in ms from creation; null = never expires
const REGISTRY = {
  'tournament.published':            { mode: 'broadcast', persist: 'persistent', email: false, ttlMs: 24 * 60 * 60 * 1000 }, // 24h
  'tournament.flash_announced':      { mode: 'broadcast', persist: 'ephemeral',  email: false, ttlMs: null },
  'tournament.registration_closing': { mode: 'cohort',    persist: 'persistent', email: false, ttlMs:  2 * 60 * 60 * 1000 },  // 2h
  'tournament.starting_soon':        { mode: 'cohort',    persist: 'persistent', email: false, ttlMs:  3 * 60 * 60 * 1000 },  // 3h
  'tournament.started':              { mode: 'cohort',    persist: 'persistent', email: false, ttlMs: 24 * 60 * 60 * 1000 },  // 24h
  'tournament.cancelled':            { mode: 'cohort',    persist: 'persistent', email: true,  ttlMs:  7 * 24 * 60 * 60 * 1000 },  // 7d
  'tournament.completed':            { mode: 'cohort',    persist: 'persistent', email: true,  ttlMs:  7 * 24 * 60 * 60 * 1000 },  // 7d
  'match.ready':                     { mode: 'personal',  persist: 'persistent', email: true,  ttlMs:  6 * 60 * 60 * 1000, systemCritical: true },  // 6h
  'match.result':                    { mode: 'personal',  persist: 'persistent', email: false, ttlMs:  7 * 24 * 60 * 60 * 1000 },  // 7d
  'achievement.tier_upgrade':        { mode: 'personal',  persist: 'persistent', email: false, ttlMs: null },
  'achievement.milestone':           { mode: 'personal',  persist: 'persistent', email: false, ttlMs: null },
  'admin.announcement':              { mode: 'broadcast', persist: 'persistent', email: false, ttlMs: null },
  'system.alert':                    { mode: 'personal',  persist: 'persistent', email: false, ttlMs: null, systemCritical: true },
  'system.alert.cleared':            { mode: 'personal',  persist: 'persistent', email: false, ttlMs: null, systemCritical: true },

  // ── Tables (Phase 3.1) ─────────────────────────────────────────────────────
  // Live updates for the Tables page and table-detail views. All ephemeral —
  // the truth lives in the Table row, the bus just nudges the UI.
  'table.created':                   { mode: 'broadcast', persist: 'ephemeral',  email: false, ttlMs: null }, // appears in public list
  'player.joined':                   { mode: 'broadcast', persist: 'ephemeral',  email: false, ttlMs: null }, // someone took a seat — list + detail pages both refresh
  'player.left':                     { mode: 'broadcast', persist: 'ephemeral',  email: false, ttlMs: null }, // someone vacated a seat — list + detail pages both refresh
  'spectator.joined':                { mode: 'cohort',    persist: 'ephemeral',  email: false, ttlMs: null }, // someone is watching (Phase 3.1 presence)
  'table.empty':                     { mode: 'cohort',    persist: 'ephemeral',  email: false, ttlMs: null }, // last seat vacated while still FORMING
  'table.started':                   { mode: 'broadcast', persist: 'ephemeral',  email: false, ttlMs: null }, // all seats filled, game beginning — clients clear stale seat-change notifs
  'table.completed':                 { mode: 'broadcast', persist: 'ephemeral',  email: false, ttlMs: null }, // game finished (normal end or idle timeout) — remove from active list
  'table.deleted':                   { mode: 'broadcast', persist: 'ephemeral',  email: false, ttlMs: null }, // creator deleted; remove from list
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
  // Tables (Phase 3.1) — UI nudges only, no email.
  'table.created':                   { inApp: true,  email: false },
  'player.joined':                   { inApp: true,  email: false },
  'player.left':                     { inApp: true,  email: false },
  'spectator.joined':                { inApp: true,  email: false },
  'table.empty':                     { inApp: true,  email: false },
  'table.started':                   { inApp: true,  email: false },
  'table.completed':                 { inApp: true,  email: false },
  'table.deleted':                   { inApp: true,  email: false },
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
export async function dispatch({ type, targets, payload = {}, expiresAt: explicitExpiresAt }) {
  try {
    // Increment dispatch counter for monitoring
    _dispatchCounters[type] = (_dispatchCounters[type] ?? 0) + 1

    const entry = REGISTRY[type]
    if (!entry) {
      logger.warn({ type }, 'dispatch(): unknown event type — skipping')
      return
    }

    // Compute expiresAt: explicit override > REGISTRY ttlMs > null
    const expiresAt = explicitExpiresAt
      ? new Date(explicitExpiresAt)
      : entry.ttlMs
        ? new Date(Date.now() + entry.ttlMs)
        : null
    const expiresAtIso = expiresAt?.toISOString() ?? null

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
        _io.emit('guide:notification', { type, payload, expiresAt: expiresAtIso })
      }
      if (entry.persist !== 'persistent') return  // ephemeral broadcast done
    } else if (targets?.cohort) {
      userIds = targets.cohort.filter(Boolean)
    } else if (targets?.userId) {
      userIds = [targets.userId]
    }

    if (userIds.length === 0) return

    // For broadcast+persistent: respect preferences, use createMany for efficiency,
    // then mark rows as delivered for users who are currently connected. Without this,
    // the reconnect flush in user:subscribe re-delivers rows that were already received
    // live via the _io.emit() broadcast above, producing duplicate notifications.
    if (targets?.broadcast && entry.persist === 'persistent') {
      const optedOut = await db.notificationPreference.findMany({
        where: { userId: { in: userIds }, eventType: type, inApp: false },
        select: { userId: true },
      })
      const optedOutSet = new Set(optedOut.map(r => r.userId))
      const eligible = userIds.filter(id => !optedOutSet.has(id))
      if (eligible.length > 0) {
        await db.userNotification.createMany({
          data: eligible.map(userId => ({ userId, type, payload, ...(expiresAt && { expiresAt }) })),
          skipDuplicates: true,
        })
        if (_io) {
          const now = new Date()
          const connected = await Promise.all(
            eligible.map(async (userId) => {
              const sockets = await _io.in(`user:${userId}`).fetchSockets()
              return sockets.length > 0 ? userId : null
            })
          )
          const connectedIds = connected.filter(Boolean)
          if (connectedIds.length > 0) {
            await db.userNotification.updateMany({
              where: { userId: { in: connectedIds }, type, deliveredAt: null },
              data: { deliveredAt: now },
            })
          }
        }
      }
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
        let notifId = null
        if (entry.persist === 'persistent') {
          const dedupFilter = buildDedupFilter(type, payload)
          const existing = await db.userNotification.findFirst({
            where: { userId, type, deliveredAt: null, ...dedupFilter },
          })
          if (existing) return
          const notif = await db.userNotification.create({ data: { userId, type, payload, ...(expiresAt && { expiresAt }) } })
          notifId = notif.id
        }

        // Emit to socket room; mark delivered immediately if the user is connected
        // so the reconnect flush doesn't re-send what was already received live.
        if (_io) {
          const sockets = await _io.in(`user:${userId}`).fetchSockets()
          if (sockets.length > 0) {
            _io.to(`user:${userId}`).emit('guide:notification', { type, payload, expiresAt: expiresAtIso })
            if (notifId) {
              await db.userNotification.update({
                where: { id: notifId },
                data:  { deliveredAt: new Date() },
              })
            }
          }
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
