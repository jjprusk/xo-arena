/**
 * Socket.io event handler.
 * Wires all room lifecycle and game events to the RoomManager.
 */

import { Server } from 'socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import ioredis from 'ioredis'
const { createClient } = ioredis
import { roomManager } from './roomManager.js'
import { createClerkClient } from '@clerk/backend'
import { getUserByClerkId, createGame } from '../services/userService.js'
import logger from '../logger.js'

let clerkClient = null
function getClerk() {
  if (!clerkClient && process.env.CLERK_SECRET_KEY) {
    clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  }
  return clerkClient
}

async function resolveSocketUser(token) {
  if (!token) return null
  try {
    const clerk = getClerk()
    if (!clerk) return null
    const payload = await clerk.verifyToken(token)
    return await getUserByClerkId(payload.sub)
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
  const io = new Server(httpServer, {
    cors: { origin: process.env.FRONTEND_URL || 'http://localhost:5173', methods: ['GET', 'POST'] },
  })

  // Redis adapter for horizontal scaling
  if (process.env.REDIS_URL) {
    try {
      const pubClient = new createClient({ lazyConnect: true, ...parseRedisUrl(process.env.REDIS_URL) })
      const subClient = pubClient.duplicate()
      await Promise.all([pubClient.connect(), subClient.connect()])
      io.adapter(createAdapter(pubClient, subClient))
      logger.info('Socket.io Redis adapter connected')
    } catch (err) {
      logger.warn({ err: err.message }, 'Redis adapter unavailable, using in-memory adapter')
    }
  }

  io.on('connection', (socket) => {
    logger.info({ socketId: socket.id }, 'socket connected')

    // ── Room lifecycle ──────────────────────────────────────────────

    socket.on('room:create', async ({ spectatorAllowed = true, authToken = null } = {}) => {
      try {
        const user = await resolveSocketUser(authToken)
        const room = roomManager.createRoom({
          hostSocketId: socket.id,
          hostUserId: user?.id || null,
          spectatorAllowed,
        })
        socket.join(room.slug)
        socket.emit('room:created', { slug: room.slug, displayName: room.displayName, mark: 'X' })
      } catch (err) {
        socket.emit('error', { message: err.message })
      }
    })

    socket.on('room:join', async ({ slug, role = 'player', authToken = null }) => {
      const user = await resolveSocketUser(authToken)
      if (role === 'spectator') {
        const result = roomManager.joinAsSpectator({ slug, socketId: socket.id })
        if (result.error) return socket.emit('error', { message: result.error })

        socket.join(slug)
        socket.emit('room:joined', { slug, role: 'spectator', room: sanitizeRoom(result.room) })
        io.to(slug).emit('room:spectatorJoined', { spectatorCount: result.room.spectatorIds.size })
      } else {
        const result = roomManager.joinRoom({ slug, guestSocketId: socket.id, guestUserId: user?.id || null })
        if (result.error) return socket.emit('error', { message: result.error })

        const room = result.room
        socket.join(slug)
        socket.emit('room:joined', { slug, role: 'player', mark: 'O', room: sanitizeRoom(room) })
        // Notify host
        io.to(slug).emit('room:guestJoined', { room: sanitizeRoom(room) })
        // Start game
        io.to(slug).emit('game:start', { board: room.board, currentTurn: room.currentTurn, round: room.round })
      }
    })

    socket.on('room:swapName', () => {
      const result = roomManager.swapName({ socketId: socket.id })
      if (result.error) return socket.emit('error', { message: result.error })
      socket.emit('room:renamed', { slug: result.room.slug, displayName: result.room.displayName })
    })

    socket.on('room:cancel', () => {
      const slug = roomManager._socketToRoom.get(socket.id)
      if (slug) {
        io.to(slug).emit('room:cancelled')
        roomManager.closeRoom(slug)
      }
    })

    // ── Game events ─────────────────────────────────────────────────

    socket.on('game:move', ({ cellIndex }) => {
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
        recordPvpGame(room).catch((err) => logger.warn({ err }, 'Failed to record PvP game'))
      }
    })

    socket.on('game:rematch', () => {
      const result = roomManager.rematch({ socketId: socket.id })
      if (result.error) return socket.emit('error', { message: result.error })

      const room = result.room
      io.to(room.slug).emit('game:start', {
        board: room.board,
        currentTurn: room.currentTurn,
        round: room.round,
        scores: room.scores,
      })
    })

    socket.on('game:forfeit', () => {
      const slug = roomManager._socketToRoom.get(socket.id)
      const room = slug && roomManager.getRoom(slug)
      if (!room) return
      const mark = room.playerMarks[socket.id]
      const oppMark = mark === 'X' ? 'O' : 'X'
      room.winner = oppMark
      room.scores[oppMark]++
      room.status = 'finished'
      io.to(slug).emit('game:forfeit', { forfeiterMark: mark, winner: oppMark, scores: room.scores })
      recordPvpGame(room).catch((err) => logger.warn({ err }, 'Failed to record PvP forfeit game'))
    })

    // ── Disconnect ──────────────────────────────────────────────────

    socket.on('disconnect', () => {
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

  return io
}

/**
 * Record a finished PvP game for any authenticated players.
 * Skipped silently if neither player has a DB user.
 */
async function recordPvpGame(room) {
  if (!room.hostUserId && !room.guestUserId) return

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
    // Find which userId has X
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
    })
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
  }
}

function parseRedisUrl(url) {
  const u = new URL(url)
  return { host: u.hostname, port: parseInt(u.port) || 6379 }
}
