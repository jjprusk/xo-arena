// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Notification bus — single dispatch() entry point for all notification events.
 */
import db from './db.js'
import logger from '../logger.js'
import { appendToStream } from './eventStream.js'
import { sendToUser as pushToUser, buildPushPayload } from './pushService.js'
import * as sseBroker from './sseBroker.js'

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
  'tournament.starting_soon':        { mode: 'cohort',    persist: 'persistent', email: false, push: true, ttlMs:  3 * 60 * 60 * 1000 },  // 3h
  'tournament.started':              { mode: 'cohort',    persist: 'persistent', email: false, push: true, ttlMs: 24 * 60 * 60 * 1000 },  // 24h
  'tournament.cancelled':            { mode: 'cohort',    persist: 'persistent', email: true,  push: true, ttlMs:  7 * 24 * 60 * 60 * 1000 },  // 7d
  'tournament.completed':            { mode: 'cohort',    persist: 'persistent', email: true,  ttlMs:  7 * 24 * 60 * 60 * 1000 },  // 7d
  'match.ready':                     { mode: 'personal',  persist: 'persistent', email: true,  push: true, ttlMs:  6 * 60 * 60 * 1000, systemCritical: true },  // 6h
  'match.result':                    { mode: 'personal',  persist: 'persistent', email: false, ttlMs:  7 * 24 * 60 * 60 * 1000 },  // 7d
  'achievement.tier_upgrade':        { mode: 'personal',  persist: 'persistent', email: false, push: true, ttlMs: null },
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
  'tournament.published':            { inApp: true,  email: false, push: false },
  'tournament.flash_announced':      { inApp: true,  email: false, push: false },
  'tournament.registration_closing': { inApp: true,  email: false, push: false },
  'tournament.starting_soon':        { inApp: true,  email: false, push: false },
  'tournament.started':              { inApp: true,  email: false, push: false },
  'tournament.cancelled':            { inApp: true,  email: true,  push: false },
  'tournament.completed':            { inApp: true,  email: true,  push: false },
  'match.ready':                     { inApp: true,  email: true,  push: false },
  'match.result':                    { inApp: true,  email: false, push: false },
  'achievement.tier_upgrade':        { inApp: true,  email: false, push: false },
  'achievement.milestone':           { inApp: true,  email: false, push: false },
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
      // Tier 2 broadcast — SSE clients receive it live; the replay endpoint
      // covers reconnects up to the 5-min Redis stream horizon.
      appendToStream('guide:notification', { type, payload, expiresAt: expiresAtIso }, { userId: null })
        .catch(() => {})
      if (entry.persist !== 'persistent') return  // ephemeral broadcast done
    } else if (targets?.cohort) {
      userIds = targets.cohort.filter(Boolean)
    } else if (targets?.userId) {
      userIds = [targets.userId]
    }

    if (userIds.length === 0) return

    // Broadcast+persistent: write one UserNotification row per eligible user so
    // the REST bootstrap (/me/notifications) can surface it beyond the SSE
    // replay window. Opted-out users are excluded per their preference.
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
        if (entry.persist === 'persistent') {
          const dedupFilter = buildDedupFilter(type, payload)
          const existing = await db.userNotification.findFirst({
            where: { userId, type, deliveredAt: null, ...dedupFilter },
          })
          if (existing) return
          await db.userNotification.create({ data: { userId, type, payload, ...(expiresAt && { expiresAt }) } })
        }

        // Tier 2 personal stream — SSE broker fans out to the matching user's
        // live connection. Offline users get it from the DB via /me/notifications
        // on next sign-in.
        appendToStream('guide:notification', { type, payload, expiresAt: expiresAtIso }, { userId })
          .catch(() => {})

        // Tier 3 Web Push — fire only when the event is push-eligible in the
        // REGISTRY, the user has opted in, and they have no active SSE client
        // right now (push is a backup for offline — online users already got
        // the SSE entry above).
        if (entry.push && pref.push && sseBroker.clientCountForUser(userId) === 0) {
          const pushPayload = buildPushPayload(type, payload)
          if (pushPayload) {
            pushToUser(userId, pushPayload).catch(err =>
              logger.warn({ err, userId, type }, 'pushService.sendToUser failed (non-fatal)'),
            )
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
