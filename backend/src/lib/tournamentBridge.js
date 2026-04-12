/**
 * Tournament bridge — subscribes to Redis tournament events and:
 * 1. Emits Socket.io events to user-specific rooms
 * 2. Persists UserNotification rows for in-app delivery
 */
import Redis from 'ioredis'
import db from './db.js'
import logger from '../logger.js'
import { dispatch } from './notificationBus.js'
import { completeStep } from '../services/journeyService.js'
import { botGameRunner } from '../realtime/botGameRunner.js'

// ─── Pending PVP match registry ───────────────────────────────────────────────
// Stores state for PVP tournament matches waiting for players to join a room.
// matchId → { tournamentId, participant1UserId, participant2UserId, bestOfN, slug, expiresAt }
// "slug" is null until the first player requests the room via tournament:room:join.
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
  'tournament:started',
  'tournament:match:ready',
  'tournament:bot:match:ready',
  'tournament:match:result',
  'tournament:warning',
  'tournament:completed',
  'tournament:cancelled',
]

/**
 * Start subscribing to tournament Redis channels.
 * Call this after the Socket.io server is ready.
 * @param {import('socket.io').Server} io
 */
export function startTournamentBridge(io) {
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
      await handleEvent(io, channel, data)
    } catch (err) {
      logger.error({ err, channel }, 'Tournament bridge message error')
    }
  })
}

export async function handleEvent(io, channel, data) {
  switch (channel) {
    case 'tournament:published': {
      const { tournamentId, name, format, mode } = data
      await dispatch({ type: 'tournament.published', targets: { broadcast: true }, payload: { tournamentId, name, format, mode } })
      logger.info({ tournamentId }, 'Tournament published — notified all connected clients')
      break
    }
    case 'tournament:started': {
      const { tournamentId, name } = data
      io.emit('tournament:started', { tournamentId, name })
      logger.info({ tournamentId }, 'Tournament started — notified all connected clients')
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
    case 'tournament:match:ready': {
      // Emit real-time to both participants
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

      for (const userId of userIds) {
        io.to(`user:${userId}`).emit('tournament:match:ready', { tournamentId, matchId, bestOfN: bestOfN ?? 1 })
        await dispatch({ type: 'match.ready', targets: { userId }, payload: { tournamentId, matchId } })
        // Journey step 7: first tournament registration detected at match-ready time (fire-and-forget)
        completeStep(userId, 7, io).catch(() => {})
      }
      break
    }
    case 'tournament:bot:match:ready': {
      // Start a bot vs bot game for this tournament match
      const { tournamentId, matchId, bot1, bot2, bestOfN } = data
      try {
        await botGameRunner.startGame({ bot1, bot2, tournamentId, tournamentMatchId: matchId, bestOfN: bestOfN ?? 1 })
        logger.info({ tournamentId, matchId, bot1: bot1.displayName, bot2: bot2.displayName }, 'Bot tournament match started')
      } catch (err) {
        logger.warn({ err, tournamentId, matchId }, 'Failed to start bot tournament match')
      }
      break
    }
    case 'tournament:match:result': {
      // Emit real-time to participants with AS_PLAYED pref; queue notification for all.
      // END_OF_TOURNAMENT participants get real-time batch at tournament:completed.
      const { tournamentId, matchId, winnerId, p1Wins, p2Wins, drawGames } = data
      try {
        const match = await db.tournamentMatch.findUnique({
          where: { id: matchId },
          include: {
            round: {
              include: { tournament: { include: { participants: { select: { userId: true } } } } }
            }
          }
        })
        // Get participant1 and participant2 user IDs and their notification prefs
        const p1 = match?.participant1Id ? await db.tournamentParticipant.findUnique({ where: { id: match.participant1Id }, select: { userId: true, resultNotifPref: true } }) : null
        const p2 = match?.participant2Id ? await db.tournamentParticipant.findUnique({ where: { id: match.participant2Id }, select: { userId: true, resultNotifPref: true } }) : null
        const participants = [p1, p2].filter(p => p?.userId)
        for (const { userId, resultNotifPref } of participants) {
          const pref = resultNotifPref ?? 'AS_PLAYED'
          // Always persist notification so it can be flushed at tournament end
          await dispatch({ type: 'match.result', targets: { userId }, payload: { tournamentId, matchId } })
          // Only emit real-time immediately for AS_PLAYED preference
          if (pref === 'AS_PLAYED') {
            io.to(`user:${userId}`).emit('tournament:match:result', { tournamentId, matchId, winnerId, p1Wins, p2Wins, drawGames })
          }
          // Journey step 8: first tournament match played (fire-and-forget)
          completeStep(userId, 8, io).catch(() => {})
        }
      } catch (err) {
        logger.error({ err, matchId }, 'Failed to deliver match result')
      }
      break
    }
    case 'tournament:warning': {
      const { tournamentId, minutesUntilStart, participantUserIds } = data
      for (const userId of participantUserIds) {
        io.to(`user:${userId}`).emit('tournament:warning', { tournamentId, minutesUntilStart })
        // Persist 60-min and 2-min warnings via dispatch; 15-min is real-time only
        if (minutesUntilStart === 60 || minutesUntilStart === 2) {
          await dispatch({ type: 'tournament.starting_soon', targets: { userId }, payload: { tournamentId, minutesUntilStart } })
        }
      }
      break
    }
    case 'tournament:completed': {
      const { tournamentId, name, finalStandings } = data
      for (const { userId, position } of finalStandings) {
        io.to(`user:${userId}`).emit('tournament:completed', { tournamentId, position })
        await dispatch({ type: 'tournament.completed', targets: { userId }, payload: { tournamentId, name, position } })

        // Also notify the human owner of any bot participant
        const botUser = await db.user.findUnique({ where: { id: userId }, select: { isBot: true, botOwnerId: true } })
        if (botUser?.isBot && botUser.botOwnerId) {
          io.to(`user:${botUser.botOwnerId}`).emit('tournament:completed', { tournamentId, position })
          await dispatch({ type: 'tournament.completed', targets: { userId: botUser.botOwnerId }, payload: { tournamentId, name, position } })
        }
      }

      // Notify ALL remaining participants (not just standings) so every bot owner hears about completion
      try {
        const allParticipants = await db.tournamentParticipant.findMany({
          where: { tournamentId },
          select: { userId: true },
        })
        const standingUserIds = new Set(finalStandings.map(s => s.userId))
        for (const { userId } of allParticipants) {
          if (standingUserIds.has(userId)) continue  // already notified above
          // Participant not in finalStandings (e.g. eliminated earlier) — still notify owner
          const botUser = await db.user.findUnique({ where: { id: userId }, select: { isBot: true, botOwnerId: true } })
          const notifyUserId = botUser?.isBot && botUser.botOwnerId ? botUser.botOwnerId : userId
          await dispatch({ type: 'tournament.completed', targets: { userId: notifyUserId }, payload: { tournamentId, name, position: null } })
        }
      } catch (err) {
        logger.warn({ err, tournamentId }, 'Failed to notify all participants of tournament completion')
      }

      // Flush pending match result notifications for END_OF_TOURNAMENT participants
      try {
        const eotParticipants = await db.tournamentParticipant.findMany({
          where: { tournamentId, resultNotifPref: 'END_OF_TOURNAMENT' },
          select: { userId: true },
        })
        for (const { userId } of eotParticipants) {
          const pending = await db.userNotification.findMany({
            where: {
              userId,
              type: 'match.result',
              deliveredAt: null,
              payload: { path: ['tournamentId'], equals: tournamentId },
            },
          })
          if (pending.length === 0) continue

          // Emit all pending match results in a single batch
          const matchIds = pending.map(n => n.payload?.matchId).filter(Boolean)
          io.to(`user:${userId}`).emit('tournament:match:results:batch', { tournamentId, matchIds })

          // Mark them delivered
          await db.userNotification.updateMany({
            where: { id: { in: pending.map(n => n.id) } },
            data: { deliveredAt: new Date() },
          })
        }
      } catch (err) {
        logger.error({ err, tournamentId }, 'Failed to flush END_OF_TOURNAMENT match results')
      }
      break
    }
    case 'tournament:cancelled': {
      const { tournamentId, name, participantUserIds } = data
      for (const userId of participantUserIds) {
        io.to(`user:${userId}`).emit('tournament:cancelled', { tournamentId })
        await dispatch({ type: 'tournament.cancelled', targets: { userId }, payload: { tournamentId, name } })

        // Also notify bot owners
        const botUser = await db.user.findUnique({ where: { id: userId }, select: { isBot: true, botOwnerId: true } })
        if (botUser?.isBot && botUser.botOwnerId) {
          io.to(`user:${botUser.botOwnerId}`).emit('tournament:cancelled', { tournamentId })
          await dispatch({ type: 'tournament.cancelled', targets: { userId: botUser.botOwnerId }, payload: { tournamentId, name } })
        }
      }
      break
    }
  }
}
