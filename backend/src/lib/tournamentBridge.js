/**
 * Tournament bridge — subscribes to Redis tournament events and:
 * 1. Emits Socket.io events to user-specific rooms
 * 2. Persists UserNotification rows for in-app delivery
 */
import Redis from 'ioredis'
import db from './db.js'
import logger from '../logger.js'
import { queueNotification } from '../services/notificationService.js'

// Channels to subscribe to
const CHANNELS = [
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

async function handleEvent(io, channel, data) {
  switch (channel) {
    case 'tournament:match:ready': {
      // Emit real-time to both participants
      const { tournamentId, matchId, participant1UserId, participant2UserId } = data
      const userIds = [participant1UserId, participant2UserId].filter(Boolean)
      for (const userId of userIds) {
        io.to(`user:${userId}`).emit('tournament:match:ready', { tournamentId, matchId })
        await queueNotification(userId, 'tournament_match_ready', { tournamentId, matchId })
      }
      break
    }
    case 'tournament:match:result': {
      // Emit real-time to both participants — they can look up match details
      // We need to find both participants for this match
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
        // Get participant1 and participant2 user IDs from the match
        const p1 = match?.participant1Id ? await db.tournamentParticipant.findUnique({ where: { id: match.participant1Id }, select: { userId: true } }) : null
        const p2 = match?.participant2Id ? await db.tournamentParticipant.findUnique({ where: { id: match.participant2Id }, select: { userId: true } }) : null
        const userIds = [p1?.userId, p2?.userId].filter(Boolean)
        for (const userId of userIds) {
          io.to(`user:${userId}`).emit('tournament:match:result', { tournamentId, matchId, winnerId, p1Wins, p2Wins, drawGames })
          await queueNotification(userId, 'tournament_match_result', { tournamentId, matchId })
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
        // Only persist the 60min warning (15min is real-time only)
        if (minutesUntilStart === 60) {
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
