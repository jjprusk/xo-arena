/**
 * Socket.io event handler.
 * Wires all room lifecycle and game events to the RoomManager.
 */

import { Server } from 'socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import Redis from 'ioredis'
import { roomManager } from './roomManager.js'
import { botGameRunner } from './botGameRunner.js'
import { auth } from '../lib/auth.js'
import { getUserByBetterAuthId, createGame } from '../services/userService.js'
import db from '../lib/db.js'
import { updatePlayersEloAfterPvP } from '../services/eloService.js'
import { getSystemConfig } from '../services/mlService.js'
import { recordActivity } from '../services/activityService.js'
import { recordGameCompletion } from '../services/creditService.js'
import {
  getPendingPvpMatch,
  setPendingPvpMatchSlug,
  deletePendingPvpMatch,
} from '../lib/tournamentBridge.js'
import {
  incrementSocket, decrementSocket,
  incrementRedis, decrementRedis,
  trackedOn, startSnapshotInterval,
} from '../lib/resourceCounters.js'
import logger from '../logger.js'

const TOURNAMENT_SERVICE_URL = process.env.TOURNAMENT_SERVICE_URL || 'http://localhost:3001'

async function completeTournamentMatch(matchId, winnerId, p1Wins, p2Wins, drawGames) {
  try {
    const res = await fetch(`${TOURNAMENT_SERVICE_URL}/api/matches/${matchId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ winnerId, p1Wins, p2Wins, drawGames }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      logger.warn({ matchId, status: res.status, body }, 'completeTournamentMatch: non-2xx response')
    }
  } catch (err) {
    logger.error({ err, matchId }, 'completeTournamentMatch: fetch failed')
  }
}

const ALLOWED_REACTIONS = ['👍', '😂', '😮', '🔥', '😭', '🤔', '👏', '💀']

async function getIdleConfig() {
  const [warnSec, graceSec, spectatorSec] = await Promise.all([
    getSystemConfig('game.idleWarnSeconds',      120),
    getSystemConfig('game.idleGraceSeconds',      60),
    getSystemConfig('game.spectatorIdleSeconds', 600),
  ])
  return {
    warnMs:      warnSec      * 1000,
    graceMs:     graceSec     * 1000,
    spectatorMs: spectatorSec * 1000,
  }
}

/**
 * Build the idle-timer callbacks for a given io instance.
 * Used when starting or resetting timers for players and spectators.
 */
function makeIdleCallbacks(io) {
  return {
    onWarn: ({ socketId, graceMs }) => {
      io.to(socketId).emit('idle:warning', { secondsRemaining: Math.round(graceMs / 1000) })
    },
    onAbandon: ({ absentSocketId, absentUserId, allSocketIds }) => {
      for (const sid of allSocketIds) {
        io.to(sid).emit('room:abandoned', { reason: 'idle', absentUserId })
      }
    },
    onKick: ({ socketId }) => {
      io.to(socketId).emit('room:kicked', { reason: 'idle' })
    },
  }
}

async function resolveSocketUser(token) {
  if (!token) return null
  try {
    // Verify the Bearer JWT via Better Auth's JWT plugin
    const result = await auth.api.verifyToken({ body: { token } })
    if (!result?.user?.id) return null
    return await getUserByBetterAuthId(result.user.id)
  } catch {
    return null
  }
}

/**
 * Attach Socket.io to an HTTP server.
 * @param {import('http').Server} httpServer
 * @returns {import('socket.io').Server}
 */
export async function attachSocketIO(httpServer) {
  const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',').map(o => o.trim()).filter(Boolean)
  const io = new Server(httpServer, {
    cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
  })

  // Redis adapter for horizontal scaling
  if (process.env.REDIS_URL) {
    try {
      const pubClient = new Redis(process.env.REDIS_URL)
      const subClient = pubClient.duplicate()
      pubClient.on('connect', () => incrementRedis())
      pubClient.on('end',     () => decrementRedis())
      subClient.on('connect', () => incrementRedis())
      subClient.on('end',     () => decrementRedis())
      await Promise.all([pubClient.connect(), subClient.connect()])
      io.adapter(createAdapter(pubClient, subClient))
      logger.info('Socket.io Redis adapter connected')
    } catch (err) {
      logger.warn({ err: err.message }, 'Redis adapter unavailable, using in-memory adapter')
    }
  }

  io.on('connection', (socket) => {
    incrementSocket()
    logger.info({ socketId: socket.id }, 'socket connected')

    // ── Room lifecycle ──────────────────────────────────────────────

    const cleanups = []
    const on = (event, handler) => cleanups.push(trackedOn(socket, event, handler))

    on('room:create', async ({ spectatorAllowed = true, authToken = null } = {}) => {
      try {
        const user = await resolveSocketUser(authToken)
        if (!socket.connected) return  // disconnected while resolving auth
        const room = roomManager.createRoom({
          hostSocketId: socket.id,
          hostUserId: user?.id || null,
          spectatorAllowed,
        })
        room.hostUserDisplayName = user?.displayName ?? null
        room.hostUserElo = user?.eloRating ?? null
        socket.join(room.slug)
        socket.emit('room:created', { slug: room.slug, displayName: room.displayName, mark: 'X' })
      } catch (err) {
        socket.emit('error', { message: err.message })
      }
    })

    on('room:join', async ({ slug, role = 'player', authToken = null }) => {
      const user = await resolveSocketUser(authToken)
      if (!socket.connected) return  // disconnected while resolving auth
      if (role === 'spectator') {
        // First try PvP rooms, then bot game rooms
        if (roomManager.getRoom(slug)) {
          const result = roomManager.joinAsSpectator({ slug, socketId: socket.id })
          if (result.error) return socket.emit('error', { message: result.error })
          socket.join(slug)
          socket.emit('room:joined', { slug, role: 'spectator', room: sanitizeRoom(result.room) })
          io.to(slug).emit('room:spectatorJoined', { spectatorCount: result.room.spectatorIds.size })
          // Start spectator idle timer (only if game is in progress)
          if (result.room.status === 'playing') {
            const { graceMs, spectatorMs } = await getIdleConfig()
            const { onWarn, onAbandon, onKick } = makeIdleCallbacks(io)
            roomManager.resetIdleTimer({ socketId: socket.id, warnMs: spectatorMs, graceMs, onWarn, onAbandon, onKick })
          }
        } else if (botGameRunner.hasSlug(slug)) {
          const result = botGameRunner.joinAsSpectator({ slug, socketId: socket.id })
          if (result.error) return socket.emit('error', { message: result.error })
          socket.join(slug)
          const g = result.game
          socket.emit('room:joined', {
            slug,
            role: 'spectator',
            room: {
              slug: g.slug,
              displayName: g.displayName,
              status: g.status,
              board: g.board,
              currentTurn: g.currentTurn,
              winner: g.winner,
              winLine: g.winLine,
              spectatorCount: g.spectatorIds.size,
              spectatorAllowed: true,
              isBotGame: true,
              bot1: { displayName: g.bot1.displayName, mark: 'X' },
              bot2: { displayName: g.bot2.displayName, mark: 'O' },
            },
          })
          io.to(slug).emit('room:spectatorJoined', { spectatorCount: g.spectatorIds.size })
        } else {
          return socket.emit('error', { message: 'Room not found' })
        }
      } else {
        const result = roomManager.joinRoom({ slug, guestSocketId: socket.id, guestUserId: user?.id || null })
        if (result.error) return socket.emit('error', { message: result.error })

        const room = result.room
        room.guestUserDisplayName = user?.displayName ?? null
        room.guestUserElo = user?.eloRating ?? null
        socket.join(slug)
        socket.emit('room:joined', { slug, role: 'player', mark: 'O', room: sanitizeRoom(room) })
        // Notify host
        io.to(slug).emit('room:guestJoined', { room: sanitizeRoom(room) })
        // Start game
        io.to(slug).emit('game:start', { board: room.board, currentTurn: room.currentTurn, round: room.round })

        // Start idle timers for both players
        const { warnMs, graceMs } = await getIdleConfig()
        const { onWarn, onAbandon, onKick } = makeIdleCallbacks(io)
        for (const pid of [room.hostId, room.guestId]) {
          roomManager.resetIdleTimer({ socketId: pid, warnMs, graceMs, onWarn, onAbandon, onKick })
        }
      }
    })

    on('room:swapName', () => {
      const result = roomManager.swapName({ socketId: socket.id })
      if (result.error) return socket.emit('error', { message: result.error })
      socket.emit('room:renamed', { slug: result.room.slug, displayName: result.room.displayName })
    })

    on('room:cancel', () => {
      const slug = roomManager._socketToRoom.get(socket.id)
      if (slug) {
        io.to(slug).emit('room:cancelled')
        roomManager.closeRoom(slug)
      }
    })

    // ── Game events ─────────────────────────────────────────────────

    on('game:move', async ({ cellIndex }) => {
      const result = roomManager.makeMove({ socketId: socket.id, cellIndex })
      if (result.error) return socket.emit('error', { message: result.error })

      const room = result.room
      const slug = room.slug

      io.to(slug).emit('game:moved', {
        cellIndex,
        board: room.board,
        currentTurn: room.currentTurn,
        status: room.status,
        winner: room.winner,
        winLine: room.winLine,
        scores: room.scores,
      })

      if (room.status === 'finished') {
        recordPvpGame(room, io).catch((err) => logger.warn({ err }, 'Failed to record PvP game'))
      } else {
        // Reset idle timer for the player who just moved; track activity
        const userId = room.hostId === socket.id ? room.hostUserId : room.guestUserId
        if (userId) recordActivity(userId)

        const { warnMs, graceMs } = await getIdleConfig()
        const { onWarn, onAbandon, onKick } = makeIdleCallbacks(io)
        roomManager.resetIdleTimer({ socketId: socket.id, warnMs, graceMs, onWarn, onAbandon, onKick })
      }
    })

    on('idle:pong', async () => {
      // User acknowledged the "Still Active?" popup — reset their idle timer
      const slug = roomManager._socketToRoom.get(socket.id)
      const room = slug && roomManager.getRoom(slug)
      if (!room || room.status !== 'playing') return

      const isPlayer = room.hostId === socket.id || room.guestId === socket.id
      const { warnMs, graceMs, spectatorMs } = await getIdleConfig()
      const { onWarn, onAbandon, onKick } = makeIdleCallbacks(io)
      roomManager.resetIdleTimer({
        socketId: socket.id,
        warnMs: isPlayer ? warnMs : spectatorMs,
        graceMs,
        onWarn,
        onAbandon,
        onKick,
      })
    })

    on('game:rematch', async () => {
      const result = roomManager.rematch({ socketId: socket.id })
      if (result.error) return socket.emit('error', { message: result.error })

      const room = result.room
      io.to(room.slug).emit('game:start', {
        board: room.board,
        currentTurn: room.currentTurn,
        round: room.round,
        scores: room.scores,
      })

      // Restart idle timers for both players on rematch
      const { warnMs, graceMs } = await getIdleConfig()
      const { onWarn, onAbandon, onKick } = makeIdleCallbacks(io)
      for (const pid of [room.hostId, room.guestId]) {
        if (pid) roomManager.resetIdleTimer({ socketId: pid, warnMs, graceMs, onWarn, onAbandon, onKick })
      }
    })

    on('game:forfeit', () => {
      const slug = roomManager._socketToRoom.get(socket.id)
      const room = slug && roomManager.getRoom(slug)
      if (!room) return
      const mark = room.playerMarks[socket.id]
      const oppMark = mark === 'X' ? 'O' : 'X'
      room.winner = oppMark
      room.scores[oppMark]++
      room.status = 'finished'
      io.to(slug).emit('game:forfeit', { forfeiterMark: mark, winner: oppMark, scores: room.scores })
      recordPvpGame(room, io).catch((err) => logger.warn({ err }, 'Failed to record PvP forfeit game'))
    })

    // ── Emoji reactions ──────────────────────────────────────────────

    on('game:reaction', ({ emoji }) => {
      if (!ALLOWED_REACTIONS.includes(emoji)) return
      const slug = roomManager._socketToRoom.get(socket.id)
      if (!slug) return
      const room = roomManager.getRoom(slug)
      const fromMark = room?.playerMarks?.[socket.id] ?? 'spectator'
      // Broadcast to everyone else in the room
      socket.to(slug).emit('game:reaction', { emoji, fromMark })
    })

    // ── Tournament PVP room join ─────────────────────────────────────
    //
    // When a tournament:match:ready event is received, both players can
    // request to join a dedicated tournament game room via this event.
    // The first caller creates the room; the second caller joins it.

    on('tournament:room:join', async ({ matchId, authToken } = {}) => {
      if (!matchId) return socket.emit('error', { message: 'matchId required' })

      const user = await resolveSocketUser(authToken)
      if (!socket.connected) return
      if (!user) return socket.emit('error', { message: 'Authentication required' })

      const pending = getPendingPvpMatch(matchId)
      if (!pending) return socket.emit('error', { message: 'Tournament match not found or already started' })

      const { tournamentId, participant1UserId, participant2UserId, bestOfN } = pending

      // Verify the caller is one of the two participants (by betterAuthId)
      if (user.betterAuthId !== participant1UserId && user.betterAuthId !== participant2UserId) {
        return socket.emit('error', { message: 'You are not a participant in this match' })
      }

      let slug = pending.slug
      let mark

      if (!slug) {
        // First player to arrive — create the room
        const room = roomManager.createRoom({
          hostSocketId: socket.id,
          hostUserId: user.id,
          spectatorAllowed: false,
          tournamentMatchId: matchId,
          tournamentId,
          bestOfN,
        })
        room.hostUserDisplayName = user.displayName ?? null
        room.hostUserElo = user.eloRating ?? null
        socket.join(room.slug)
        slug = room.slug
        mark = 'X'
        setPendingPvpMatchSlug(matchId, slug)
        socket.emit('tournament:room:ready', { slug, mark, tournamentId, matchId, bestOfN })
      } else {
        // Second player — join as guest
        const result = roomManager.joinRoom({ slug, guestSocketId: socket.id, guestUserId: user.id })
        if (result.error) return socket.emit('error', { message: result.error })

        const room = result.room
        room.guestUserDisplayName = user.displayName ?? null
        room.guestUserElo = user.eloRating ?? null
        mark = 'O'
        socket.join(slug)
        socket.emit('tournament:room:ready', { slug, mark, tournamentId, matchId, bestOfN })
        // Notify host that guest joined (same as normal room join)
        io.to(slug).emit('room:guestJoined', { room: sanitizeRoom(room) })
        io.to(slug).emit('game:start', { board: room.board, currentTurn: room.currentTurn, round: room.round })

        // Start idle timers for both players
        const { warnMs, graceMs } = await getIdleConfig()
        const { onWarn, onAbandon, onKick } = makeIdleCallbacks(io)
        for (const pid of [room.hostId, room.guestId]) {
          roomManager.resetIdleTimer({ socketId: pid, warnMs, graceMs, onWarn, onAbandon, onKick })
        }
      }
    })

    // ── Support room ─────────────────────────────────────────────────

    on('support:join', () => {
      socket.join('support')
    })

    // ── ML training progress ─────────────────────────────────────────

    on('ml:watch', ({ sessionId }) => {
      if (sessionId) socket.join(`ml:session:${sessionId}`)
    })

    on('ml:unwatch', ({ sessionId }) => {
      if (sessionId) socket.leave(`ml:session:${sessionId}`)
    })

    // ── User-specific room (for tournament and other personal events) ─────────
    on('user:subscribe', async ({ authToken } = {}) => {
      const user = await resolveSocketUser(authToken)
      if (!user) return
      socket.join(`user:${user.id}`)
      logger.info({ socketId: socket.id, userId: user.id }, 'user subscribed to personal room')

      // Flush undelivered persistent notifications (cap at 20 most recent)
      try {
        const unread = await db.userNotification.findMany({
          where:   { userId: user.id, deliveredAt: null },
          orderBy: { createdAt: 'asc' },
          take:    20,
        })
        if (unread.length > 0) {
          for (const n of unread) {
            socket.emit('guide:notification', { type: n.type, payload: n.payload })
          }
          await db.userNotification.updateMany({
            where: { id: { in: unread.map(n => n.id) } },
            data:  { deliveredAt: new Date() },
          })
          logger.info({ userId: user.id, count: unread.length }, 'Flushed queued notifications on reconnect')
        }
      } catch (err) {
        logger.warn({ err, userId: user.id }, 'Failed to flush queued notifications (non-fatal)')
      }
    })

    // ── Disconnect ──────────────────────────────────────────────────

    socket.on('disconnect', () => {
      decrementSocket()
      cleanups.forEach(fn => fn())
      if (socket._trackedListenerCount !== 0) {
        logger.warn({ socketId: socket.id, remaining: socket._trackedListenerCount }, 'socket disconnected with uncleaned listeners')
      }
      logger.info({ socketId: socket.id }, 'socket disconnected')

      const result = roomManager.handleDisconnect({
        socketId: socket.id,
        onForfeit: ({ room, forfeiterMark }) => {
          io.to(room.slug).emit('game:forfeit', {
            forfeiterMark,
            winner: forfeiterMark === 'X' ? 'O' : 'X',
            scores: room.scores,
            reason: 'disconnect',
          })
        },
      })

      // Also clean up bot game spectator
      botGameRunner.removeSpectator(socket.id)

      if (result && !result.wasSpectator) {
        const slug = roomManager._socketToRoom.get(socket.id) ||
          [...roomManager._rooms.entries()].find(([, r]) => r.hostId === socket.id || r.guestId === socket.id)?.[0]

        if (slug) {
          io.to(slug).emit('room:playerDisconnected', {
            mark: result.room?.playerMarks?.[socket.id],
            reconnectWindowMs: 60000,
          })
        }
      }
    })
  })

  botGameRunner.setIO(io)
  startSnapshotInterval(() => roomManager.roomCount)
  return io
}

/**
 * Record a finished PvP game (one round within a match) for any authenticated players.
 * Skipped silently if neither player has a DB user.
 * For tournament rooms: skips ELO, links game to tournament, checks series completion.
 * Fires credit recording and emits accomplishment events via Socket.IO.
 */
async function recordPvpGame(room, io) {
  if (!room.hostUserId && !room.guestUserId) return

  const isTournamentRoom = !!room.tournamentMatchId
  const totalMoves = room.board.filter(Boolean).length
  const durationMs = room.lastActivityAt ? room.lastActivityAt - room.createdAt : 0

  // Determine outcome from winner mark
  let outcome = 'DRAW'
  if (room.winner) {
    const winnerIsHost = room.playerMarks[room.hostId] === room.winner ||
      Object.entries(room.playerMarks).find(([, m]) => m === room.winner)?.[0] === room.hostId
    outcome = winnerIsHost ? 'PLAYER1_WIN' : 'PLAYER2_WIN'
  }

  // Determine winnerId
  let winnerId = null
  if (room.winner === 'X') {
    winnerId = Object.entries(room.playerMarks).find(([, m]) => m === 'X')?.[0] === room.hostId
      ? room.hostUserId : room.guestUserId
  } else if (room.winner === 'O') {
    winnerId = Object.entries(room.playerMarks).find(([, m]) => m === 'O')?.[0] === room.hostId
      ? room.hostUserId : room.guestUserId
  }

  // Record for player1 (host) if authenticated
  if (room.hostUserId) {
    await createGame({
      player1Id: room.hostUserId,
      player2Id: room.guestUserId || null,
      winnerId,
      mode: 'PVP',
      outcome,
      totalMoves,
      durationMs,
      startedAt: new Date(room.createdAt),
      roomName: room.name,
      tournamentId: room.tournamentId ?? null,
      tournamentMatchId: room.tournamentMatchId ?? null,
    })
  }

  // ELO update: skip for tournament games (design requirement)
  if (!isTournamentRoom && room.hostUserId && room.guestUserId) {
    updatePlayersEloAfterPvP(room.hostUserId, room.guestUserId, outcome).catch(() => {})
  }

  // Tournament series completion check
  if (isTournamentRoom) {
    const xWins = room.scores.X
    const oWins = room.scores.O
    const drawGames = room.round - xWins - oWins
    const required = Math.ceil((room.bestOfN ?? 1) / 2)
    const seriesDone = xWins >= required || oWins >= required

    if (seriesDone) {
      // Determine which userId won the series
      const seriesWinnerMark = xWins >= required ? 'X' : 'O'
      const seriesWinnerUserId = Object.entries(room.playerMarks)
        .find(([, m]) => m === seriesWinnerMark)?.[0] === room.hostId
        ? room.hostUserId : room.guestUserId

      // Look up the TournamentParticipant ID for the winner (needed by tournament service)
      let winnerParticipantId = null
      try {
        const participant = await db.tournamentParticipant.findFirst({
          where: { tournamentId: room.tournamentId, userId: seriesWinnerUserId },
          select: { id: true },
        })
        winnerParticipantId = participant?.id ?? null
      } catch (err) {
        logger.warn({ err, tournamentMatchId: room.tournamentMatchId }, 'Could not look up winner participant ID')
      }

      completeTournamentMatch(room.tournamentMatchId, winnerParticipantId, xWins, oWins, drawGames).catch(() => {})

      // Clean up pending match registry
      deletePendingPvpMatch(room.tournamentMatchId)

      // Notify both players the series is over
      io.to(room.slug).emit('tournament:series:complete', {
        tournamentId: room.tournamentId,
        matchId: room.tournamentMatchId,
        p1Wins: xWins,
        p2Wins: oWins,
        seriesWinnerUserId,
      })
    }
    // Don't record credits for tournament games
    return
  }

  // Record credits and emit accomplishment events (free-play only)
  const pvpParticipants = [
    room.hostUserId  ? { userId: room.hostUserId,  isBot: false, botOwnerId: null } : null,
    room.guestUserId ? { userId: room.guestUserId, isBot: false, botOwnerId: null } : null,
  ].filter(Boolean)

  if (pvpParticipants.length > 0) {
    recordGameCompletion({ appId: 'xo-arena', participants: pvpParticipants, mode: 'pvp' })
      .then((notifications) => {
        if (!io || !notifications.length) return
        for (const notif of notifications) {
          const socketId = notif.userId === room.hostUserId ? room.hostId : room.guestId
          if (socketId) io.to(socketId).emit('accomplishment', notif)
          // Also push into Guide notification stack
          const guideType = notif.type === 'tier_upgrade' ? 'admin' : 'match_ready'
          const guideTitle = notif.type === 'tier_upgrade'
            ? 'Tier Upgrade!'
            : notif.type === 'credit_milestone'
              ? 'Milestone Reached!'
              : 'Achievement Unlocked'
          io.to(`user:${notif.userId}`).emit('guide:notification', {
            id:        notif.id,
            type:      guideType,
            title:     guideTitle,
            body:      notif.payload?.description ?? notif.payload?.message ?? '',
            createdAt: (notif.createdAt ?? new Date()).toISOString(),
          })
        }
      })
      .catch((err) => logger.warn({ err }, 'Credit recording failed (non-fatal)'))
  }
}

function sanitizeRoom(room) {
  return {
    slug: room.slug,
    displayName: room.displayName,
    status: room.status,
    board: room.board,
    currentTurn: room.currentTurn,
    scores: room.scores,
    round: room.round,
    winner: room.winner,
    winLine: room.winLine,
    spectatorCount: room.spectatorIds?.size ?? 0,
    spectatorAllowed: room.spectatorAllowed,
    hostUserDisplayName: room.hostUserDisplayName ?? null,
    hostUserElo: room.hostUserElo ?? null,
    guestUserDisplayName: room.guestUserDisplayName ?? null,
    guestUserElo: room.guestUserElo ?? null,
  }
}

function parseRedisUrl(url) {
  const u = new URL(url)
  return { host: u.hostname, port: parseInt(u.port) || 6379 }
}
