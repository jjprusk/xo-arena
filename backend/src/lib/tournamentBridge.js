// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Tournament bridge — subscribes to Redis tournament events and:
 * 1. Appends events to the SSE stream for live UI updates
 * 2. Persists UserNotification rows via notificationBus.dispatch
 */
import Redis from 'ioredis'
import db from './db.js'
import logger from '../logger.js'
import { dispatch } from './notificationBus.js'
import { appendToStream } from './eventStream.js'
import { botGameRunner } from '../realtime/botGameRunner.js'
import { completeStep as completeJourneyStep } from '../services/journeyService.js'
import { grantDiscoveryReward } from '../services/discoveryRewardsService.js'
import { pickCoachingCard } from '../config/coachingCardRules.js'

// ─── Pending PVP match registry ───────────────────────────────────────────────
// Stores state for PVP tournament matches waiting for players to join the
// match table. matchId → { tournamentId, participant1UserId, participant2UserId,
// bestOfN, slug, expiresAt }. "slug" is null until the first player requests
// the match table via `tournament:table:join` (legacy: `tournament:room:join`)
// or POST /api/v1/rt/tournaments/matches/:id/table.
// Entries expire after PENDING_MATCH_TTL_MS to prevent unbounded growth.

const _pendingPvpMatches = new Map()
const PENDING_MATCH_TTL_MS = 2 * 60 * 60 * 1000 // 2 hours

function _pruneStalePendingMatches() {
  const now = Date.now()
  for (const [matchId, entry] of _pendingPvpMatches) {
    if (entry.expiresAt < now) {
      _pendingPvpMatches.delete(matchId)
      logger.warn({ matchId }, 'Pruned stale pending PVP match (TTL expired)')
    }
  }
}

export function getPendingPvpMatch(matchId) {
  const entry = _pendingPvpMatches.get(matchId)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    _pendingPvpMatches.delete(matchId)
    return null
  }
  return entry
}

export function setPendingPvpMatchSlug(matchId, slug) {
  const entry = _pendingPvpMatches.get(matchId)
  if (entry) entry.slug = slug
}

export function deletePendingPvpMatch(matchId) {
  _pendingPvpMatches.delete(matchId)
}

export function getPendingPvpMatchCount() { return _pendingPvpMatches.size }

// Channels to subscribe to
const CHANNELS = [
  'tournament:published',
  'tournament:flash:announced',
  'tournament:recurring:occurrence',
  'tournament:started',
  'tournament:registration_closed',
  'tournament:participant:joined',
  'tournament:participant:left',
  'tournament:match:ready',
  'tournament:bot:match:ready',
  'tournament:round:started',
  'tournament:match:result',
  'tournament:warning',
  'tournament:completed',
  'tournament:cancelled',
]

/**
 * Start subscribing to tournament Redis channels. The `_io` arg is kept
 * so index.js can call this without changes; it is unused.
 */
export function startTournamentBridge(_io) {
  if (!process.env.REDIS_URL) {
    logger.warn('REDIS_URL not set — tournament bridge disabled')
    return
  }

  const sub = new Redis(process.env.REDIS_URL)
  sub.on('error', err => logger.error({ err }, 'Tournament bridge Redis error'))

  sub.subscribe(...CHANNELS, (err) => {
    if (err) logger.error({ err }, 'Tournament bridge subscribe failed')
    else logger.info('Tournament bridge subscribed')
  })

  sub.on('message', async (channel, message) => {
    try {
      const data = JSON.parse(message)
      await handleEvent(null, channel, data)
    } catch (err) {
      logger.error({ err, channel }, 'Tournament bridge message error')
    }
  })

  // Periodically prune stale pending PVP match entries so the in-memory map
  // doesn't accumulate entries from matches that never started.
  const pruneTimer = setInterval(() => _pruneStalePendingMatches(), 30 * 60_000)
  pruneTimer.unref()
}

export async function handleEvent(_io, channel, data) {
  switch (channel) {
    case 'tournament:published': {
      const { tournamentId, name, format, mode, startTime, registrationCloseAt } = data
      // Dynamic TTL: "registration open" stops being useful the moment
      // registration closes (or the tournament starts, whichever is first).
      // Fall back to the registry's default ttlMs when neither is known.
      const expiresAt = pickNotificationCutoff(registrationCloseAt, startTime)
      await dispatch({
        type: 'tournament.published',
        targets: { broadcast: true },
        payload: { tournamentId, name, format, mode },
        expiresAt,
      })
      logger.info({ tournamentId, expiresAt }, 'Tournament published — notified all connected clients')
      break
    }
    case 'tournament:started': {
      const { tournamentId, name } = data
      // tournament:started is already fanned out to SSE via tournament/redis.js
      // (publish → xadd). This case only handles the per-participant guide
      // notification + UserNotification row via the bus.
      try {
        const participants = await db.tournamentParticipant.findMany({
          where: { tournamentId },
          select: { userId: true, user: { select: { isBot: true, botOwnerId: true } } },
        })
        const notifyIds = new Set()
        for (const p of participants) {
          if (!p.userId) continue
          if (p.user?.isBot) {
            if (p.user.botOwnerId) notifyIds.add(p.user.botOwnerId)
          } else {
            notifyIds.add(p.userId)
          }
        }
        if (notifyIds.size > 0) {
          await dispatch({
            type: 'tournament.started',
            targets: { cohort: Array.from(notifyIds) },
            payload: { tournamentId, name },
          })
        }
      } catch (err) {
        logger.warn({ err, tournamentId }, 'Failed to dispatch tournament.started notifications')
      }
      logger.info({ tournamentId }, 'Tournament started — notified registered participants')
      break
    }
    case 'tournament:registration_closed':
    case 'tournament:participant:left':
      // No-op: already appended to the SSE stream by tournament/redis.js.
      break
    case 'tournament:participant:joined': {
      // SSE pass-through is already handled by tournament/redis.js.
      // Intelligent Guide v1 — Journey step 6 (Curriculum: "Enter your first
      // tournament"). Fires when the user registers themselves into any
      // tournament — Curriculum Cup or otherwise. Idempotent — completeStep
      // no-ops if step 6 was already done. Fire-and-forget.
      const { userId } = data ?? {}
      if (userId) {
        completeJourneyStep(userId, 6).catch(() => {})
      }
      break
    }
    case 'tournament:flash:announced': {
      // Broadcast to all connected sockets — flash tournaments are live events.
      // No UserNotification row: if you're not online, the window has likely passed.
      const { tournamentId, name, noticePeriodMinutes } = data
      await dispatch({ type: 'tournament.flash_announced', targets: { broadcast: true }, payload: { tournamentId, name, noticePeriodMinutes } })
      logger.info({ tournamentId }, 'Flash tournament announced to all connected clients')
      break
    }
    case 'tournament:recurring:occurrence': {
      // A recurring template just spawned its next occurrence. Notify only the
      // subscribers auto-enrolled in it — NOT a broadcast (would spam everyone
      // with "Daily 3-Player registration open" every single day). Non-subscribers
      // discover the occurrence by browsing /tournaments. Seed bots are skipped
      // by recurringScheduler.js before publishing — autoEnrolledUserIds here is
      // already filtered to domain User.ids for humans.
      const { tournamentId, name, startTime, autoEnrolledUserIds = [] } = data
      if (autoEnrolledUserIds.length > 0) {
        // Dynamic TTL: "you're entered" is useful up until the tournament
        // starts, then it's noise. Fall back to registry default if startTime
        // isn't in the payload (older publishers).
        const expiresAt = pickNotificationCutoff(startTime)
        await dispatch({
          type: 'tournament.recurring_occurrence_opened',
          targets: { cohort: autoEnrolledUserIds },
          payload: { tournamentId, name, startTime },
          expiresAt,
        })
        logger.info({ tournamentId, subscribers: autoEnrolledUserIds.length, expiresAt }, 'Recurring occurrence opened — notified auto-enrolled subscribers')
      }
      break
    }
    case 'tournament:match:ready': {
      const { tournamentId, matchId, participant1UserId, participant2UserId, bestOfN } = data
      const userIds = [participant1UserId, participant2UserId].filter(Boolean)

      // Store pending PVP match so socketHandler can create/join the room on demand
      if (participant1UserId && participant2UserId) {
        _pruneStalePendingMatches()
        _pendingPvpMatches.set(matchId, {
          tournamentId,
          participant1UserId,
          participant2UserId,
          bestOfN: bestOfN ?? 1,
          slug: null,
          expiresAt: Date.now() + PENDING_MATCH_TTL_MS,
        })
      }

      // userIds contains betterAuthIds; dispatch() expects the DB User.id.
      for (const betterAuthId of userIds) {
        const dbUser = await db.user.findUnique({ where: { betterAuthId }, select: { id: true } })
        const dbUserId = dbUser?.id ?? betterAuthId
        await dispatch({ type: 'match.ready', targets: { userId: dbUserId }, payload: { tournamentId, matchId } })
      }
      break
    }
    case 'tournament:bot:match:ready': {
      // Start a bot vs bot game for this tournament match.
      // Honor the tournament's configured `paceMs` (admin sets this on
      // the template — scheduler mirrors it onto each spawned
      // occurrence). Without this lookup the admin-visible pacing
      // field was a no-op and every bot match ran at the runner's
      // built-in 1500ms default.
      const { tournamentId, matchId, gameId = 'xo', bot1, bot2, bestOfN } = data
      let moveDelayMs
      try {
        const t = await db.tournament.findUnique({
          where: { id: tournamentId },
          select: { paceMs: true },
        })
        // Ignore 0 / negative / missing — let the runner's default kick in.
        if (t?.paceMs && t.paceMs > 0) moveDelayMs = t.paceMs
      } catch (err) {
        logger.warn({ err, tournamentId }, 'Failed to read tournament.paceMs; using bot runner default')
      }
      try {
        await botGameRunner.startGame({ bot1, bot2, gameId, tournamentId, tournamentMatchId: matchId, bestOfN: bestOfN ?? 1, moveDelayMs })
        logger.info({ tournamentId, matchId, bot1: bot1.displayName, bot2: bot2.displayName, moveDelayMs }, 'Bot tournament match started')
      } catch (err) {
        logger.warn({ err, tournamentId, matchId }, 'Failed to start bot tournament match')
      }
      break
    }
    case 'tournament:round:started':
      // No-op: already appended to SSE by tournament/redis.js.
      break
    case 'tournament:match:result': {
      const { tournamentId, matchId } = data
      try {
        const match = await db.tournamentMatch.findUnique({
          where: { id: matchId },
          select: { participant1Id: true, participant2Id: true },
        })
        const p1 = match?.participant1Id ? await db.tournamentParticipant.findUnique({ where: { id: match.participant1Id }, select: { userId: true, resultNotifPref: true } }) : null
        const p2 = match?.participant2Id ? await db.tournamentParticipant.findUnique({ where: { id: match.participant2Id }, select: { userId: true, resultNotifPref: true } }) : null
        const participants = [p1, p2].filter(p => p?.userId)
        for (const { userId, resultNotifPref } of participants) {
          const pref = resultNotifPref ?? 'AS_PLAYED'
          if (pref === 'AS_PLAYED') {
            await dispatch({ type: 'match.result', targets: { userId }, payload: { tournamentId, matchId } })
          } else {
            // END_OF_TOURNAMENT: persist the row but skip live SSE fan-out.
            // The tournament:completed handler below flips these rows delivered
            // and clients surface them via /me/notifications on next sign-in.
            await db.userNotification.create({
              data: { userId, type: 'match.result', payload: { tournamentId, matchId } },
            }).catch(() => {})
          }
        }
      } catch (err) {
        logger.error({ err, matchId }, 'Failed to record match result notification')
      }
      break
    }
    case 'tournament:warning': {
      const { tournamentId, minutesUntilStart, participantUserIds } = data
      for (const userId of participantUserIds) {
        if (minutesUntilStart === 60 || minutesUntilStart === 2) {
          await dispatch({ type: 'tournament.starting_soon', targets: { userId }, payload: { tournamentId, minutesUntilStart } })
        }
      }
      break
    }
    case 'tournament:completed': {
      const { tournamentId, name, finalStandings } = data

      // Curriculum Cup gets the post-cup coaching card (§5.5) — fetch the
      // isCup flag once so we can branch the notify loop below without re-
      // querying. Non-cup tournaments still fire step 7; they just don't
      // get a card.
      let cupTotalParticipants = 0
      let isCupCompletion = false
      try {
        const t = await db.tournament.findUnique({
          where:  { id: tournamentId },
          select: { isCup: true },
        })
        isCupCompletion = !!t?.isCup
        if (isCupCompletion) {
          cupTotalParticipants = await db.tournamentParticipant.count({ where: { tournamentId } })
        }
      } catch (err) {
        logger.warn({ err, tournamentId }, 'tournament:completed: failed to read isCup flag')
      }

      // Build a map of notifyUserId → best position across all their bots.
      // A single owner may own multiple bot participants; send one notification
      // with their best-placed bot's position rather than one per bot.
      const ownerPositionMap = new Map() // notifyUserId → position | null

      // Walk finalStandings first (positioned participants)
      for (const { userId, position } of finalStandings) {
        const botUser = await db.user.findUnique({ where: { id: userId }, select: { isBot: true, botOwnerId: true } })
        const notifyUserId = botUser?.isBot && botUser.botOwnerId ? botUser.botOwnerId : userId

        const current = ownerPositionMap.get(notifyUserId)
        // Keep the best (lowest) position
        if (current === undefined || (position != null && (current == null || position < current))) {
          ownerPositionMap.set(notifyUserId, position)
        }
      }

      // Also include participants not in finalStandings (eliminated early)
      try {
        const allParticipants = await db.tournamentParticipant.findMany({
          where: { tournamentId },
          select: { userId: true },
        })
        const standingUserIds = new Set(finalStandings.map(s => s.userId))
        for (const { userId } of allParticipants) {
          if (standingUserIds.has(userId)) continue
          const botUser = await db.user.findUnique({ where: { id: userId }, select: { isBot: true, botOwnerId: true } })
          const notifyUserId = botUser?.isBot && botUser.botOwnerId ? botUser.botOwnerId : userId
          if (!ownerPositionMap.has(notifyUserId)) {
            ownerPositionMap.set(notifyUserId, null)
          }
        }
      } catch (err) {
        logger.warn({ err, tournamentId }, 'Failed to collect all participants for completion notification')
      }

      for (const [notifyUserId, position] of ownerPositionMap) {
        await dispatch({ type: 'tournament.completed', targets: { userId: notifyUserId }, payload: { tournamentId, name, position } })

        // Intelligent Guide v1 — Journey step 7 (Curriculum: "See your bot's
        // first result"). Fires when the user's bot has a finalPosition in a
        // completed tournament. Idempotent — completeStep is a no-op if
        // step 7 was already done. Fire-and-forget; never block the notify flow.
        if (position != null) {
          completeJourneyStep(notifyUserId, 7).catch(() => {})
        }

        // Discovery reward §5.7 "first non-Curriculum tournament win". Position 1
        // only; cup wins are excluded (Curriculum Cup is a guided funnel step).
        if (position === 1 && !isCupCompletion) {
          grantDiscoveryReward(notifyUserId, 'firstRealTournamentWin').catch(() => {})
        }

        // Coaching card (§5.5) — only for cup completions with a real
        // finalPosition. v1 passes didTrainImprove=false (placeholder); v1.1
        // will compute it from ML model history.
        if (isCupCompletion && position != null) {
          const card = pickCoachingCard({
            finalPosition:    position,
            lostInSemis:      cupTotalParticipants > 2 && position > 2,
            didTrainImprove:  false,
          })
          if (card) {
            const cardPayload = {
              tournamentId,
              tournamentName: name,
              finalPosition:  position,
              card,
            }
            appendToStream('guide:coaching_card', cardPayload, { userId: notifyUserId })
              .catch(() => {})
          }
        }
      }

      // Surface EOT participants' previously-held match.result notifications
      // into the SSE stream now that the tournament is done.
      try {
        const eotParticipants = await db.tournamentParticipant.findMany({
          where: { tournamentId, resultNotifPref: 'END_OF_TOURNAMENT' },
          select: { userId: true },
        })
        if (eotParticipants.length > 0) {
          const eotUserIds = eotParticipants.map(p => p.userId)
          const allPending = await db.userNotification.findMany({
            where: {
              userId: { in: eotUserIds },
              type: 'match.result',
              deliveredAt: null,
              payload: { path: ['tournamentId'], equals: tournamentId },
            },
          })
          for (const n of allPending) {
            await dispatch({
              type: 'match.result',
              targets: { userId: n.userId },
              payload: n.payload ?? { tournamentId },
            })
          }
        }
      } catch (err) {
        logger.error({ err, tournamentId }, 'Failed to flush END_OF_TOURNAMENT match results')
      }
      break
    }
    case 'tournament:cancelled': {
      const { tournamentId, name, participantUserIds } = data
      for (const userId of participantUserIds) {
        await dispatch({ type: 'tournament.cancelled', targets: { userId }, payload: { tournamentId, name } })
        const botUser = await db.user.findUnique({ where: { id: userId }, select: { isBot: true, botOwnerId: true } })
        if (botUser?.isBot && botUser.botOwnerId) {
          await dispatch({ type: 'tournament.cancelled', targets: { userId: botUser.botOwnerId }, payload: { tournamentId, name } })
        }
      }
      break
    }
  }
}

/**
 * Pick the earliest usable cutoff for a time-sensitive notification. Accepts
 * ISO date strings (or Date). Returns an ISO string for dispatch()'s
 * expiresAt override, or null when no valid cutoff is supplied (dispatch
 * then falls back to REGISTRY.ttlMs).
 */
export function pickNotificationCutoff(...candidates) {
  const now = Date.now()
  let earliest = null
  for (const c of candidates) {
    if (c == null) continue
    const d = c instanceof Date ? c : new Date(c)
    if (Number.isNaN(d.getTime())) continue
    if (d.getTime() <= now) continue
    if (earliest === null || d < earliest) earliest = d
  }
  return earliest ? earliest.toISOString() : null
}
