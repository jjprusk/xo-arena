/**
 * Tournament bridge — subscribes to Redis tournament events and:
 * 1. Emits Socket.io events to user-specific rooms
 * 2. Persists UserNotification rows for in-app delivery
 */
import Redis from 'ioredis'
import db from './db.js'
import logger from '../logger.js'
import { queueNotification } from '../services/notificationService.js'
import { completeStep } from '../services/journeyService.js'

// ─── Pending PVP match registry ───────────────────────────────────────────────
// Stores state for PVP tournament matches waiting for players to join a room.
// matchId → { tournamentId, participant1UserId, participant2UserId, bestOfN, slug }
// "slug" is null until the first player requests the room via tournament:room:join.

const _pendingPvpMatches = new Map()

export function getPendingPvpMatch(matchId) {
  return _pendingPvpMatches.get(matchId) ?? null
}

export function setPendingPvpMatchSlug(matchId, slug) {
  const entry = _pendingPvpMatches.get(matchId)
  if (entry) entry.slug = slug
}

export function deletePendingPvpMatch(matchId) {
  _pendingPvpMatches.delete(matchId)
}

// Channels to subscribe to
const CHANNELS = [
  'tournament:published',
  'tournament:flash:announced',
  'tournament:match:ready',
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
      const formatLabel = format === 'FLASH' ? '⚡ Flash' : format === 'OPEN' ? 'Open' : 'Planned'
      const modeLabel   = mode  === 'BOT_VS_BOT' ? 'Bot vs Bot' : mode === 'MIXED' ? 'Mixed' : 'PvP'
      io.emit('guide:notification', {
        type:  'tournament',
        title: `New Tournament: ${name}`,
        body:  `${formatLabel} · ${modeLabel} — Registration is open!`,
        href:  '/tournaments',
        tournamentId,
      })
      logger.info({ tournamentId }, 'Tournament published — notified all connected clients')
      break
    }
    case 'tournament:flash:announced': {
      // Broadcast to all connected sockets — flash tournaments are live events.
      // No UserNotification row: if you're not online, the window has likely passed.
      const { tournamentId, name, noticePeriodMinutes } = data
      const minuteText = noticePeriodMinutes != null ? ` — starting in ${noticePeriodMinutes} min` : ''
      io.emit('guide:notification', {
        type:         'flash',
        title:        `Flash Tournament: ${name}`,
        body:         `Registration is open${minuteText}. Register now!`,
        href:         '/tournaments',
        tournamentId,
      })
      logger.info({ tournamentId }, 'Flash tournament announced to all connected clients')
      break
    }
    case 'tournament:match:ready': {
      // Emit real-time to both participants
      const { tournamentId, matchId, participant1UserId, participant2UserId, bestOfN } = data
      const userIds = [participant1UserId, participant2UserId].filter(Boolean)

      // Store pending PVP match so socketHandler can create/join the room on demand
      if (participant1UserId && participant2UserId) {
        _pendingPvpMatches.set(matchId, {
          tournamentId,
          participant1UserId,
          participant2UserId,
          bestOfN: bestOfN ?? 1,
          slug: null,
        })
      }

      // Look up tournament type to decide Guide notification style (flash vs match_ready)
      let tournamentType = null
      try {
        const t = await db.tournament.findUnique({ where: { id: tournamentId }, select: { format: true } })
        tournamentType = t?.format ?? null
      } catch { /* non-fatal */ }
      const guideType = tournamentType === 'FLASH' ? 'flash' : 'match_ready'

      for (const userId of userIds) {
        io.to(`user:${userId}`).emit('tournament:match:ready', { tournamentId, matchId, bestOfN: bestOfN ?? 1 })
        await queueNotification(userId, 'tournament_match_ready', { tournamentId, matchId })
        // Journey step 7: first tournament registration detected at match-ready time (fire-and-forget)
        completeStep(userId, 7, io).catch(() => {})
        // Push into Guide notification stack
        io.to(`user:${userId}`).emit('guide:notification', {
          id:        `tmr-${matchId}-${userId}`,
          type:      guideType,
          title:     guideType === 'flash' ? 'Flash Tournament Match Ready' : 'Tournament Match Ready',
          body:      'Your next match is ready to play.',
          createdAt: new Date().toISOString(),
          meta:      { tournamentId, matchId },
        })
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
          await queueNotification(userId, 'tournament_match_result', { tournamentId, matchId })
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
        // Persist 60-min and 2-min warnings; 15-min is real-time only
        if (minutesUntilStart === 60 || minutesUntilStart === 2) {
          await queueNotification(userId, 'tournament_starting_soon', { tournamentId, minutesUntilStart })
        }
      }
      break
    }
    case 'tournament:completed': {
      const { tournamentId, finalStandings } = data
      for (const { userId, position } of finalStandings) {
        io.to(`user:${userId}`).emit('tournament:completed', { tournamentId, position })
        await queueNotification(userId, 'tournament_completed', { tournamentId, position })
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
              type: 'tournament_match_result',
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
      const { tournamentId, participantUserIds } = data
      for (const userId of participantUserIds) {
        io.to(`user:${userId}`).emit('tournament:cancelled', { tournamentId })
        await queueNotification(userId, 'tournament_cancelled', { tournamentId })
      }
      break
    }
  }
}
