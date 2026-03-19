/**
 * Socket.io event handler.
 * Wires all room lifecycle and game events to the RoomManager.
 */

import { Server } from 'socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import ioredis from 'ioredis'
const { createClient } = ioredis
import { roomManager } from './roomManager.js'
import logger from '../logger.js'

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

    socket.on('room:create', ({ spectatorAllowed = true } = {}) => {
      try {
        const room = roomManager.createRoom({ hostSocketId: socket.id, spectatorAllowed })
        socket.join(room.slug)
        socket.emit('room:created', { slug: room.slug, displayName: room.displayName, mark: 'X' })
      } catch (err) {
        socket.emit('error', { message: err.message })
      }
    })

    socket.on('room:join', ({ slug, role = 'player' }) => {
      if (role === 'spectator') {
        const result = roomManager.joinAsSpectator({ slug, socketId: socket.id })
        if (result.error) return socket.emit('error', { message: result.error })

        socket.join(slug)
        socket.emit('room:joined', { slug, role: 'spectator', room: sanitizeRoom(result.room) })
        io.to(slug).emit('room:spectatorJoined', { spectatorCount: result.room.spectatorIds.size })
      } else {
        const result = roomManager.joinRoom({ slug, guestSocketId: socket.id })
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
