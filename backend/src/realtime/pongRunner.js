// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * PongRunner — server-authoritative Pong game loop.
 *
 * Each active room runs an independent setInterval tick at ~30fps.
 * Players send paddle direction via 'pong:input'; the server broadcasts
 * the full game state after every tick via 'pong:state'.
 *
 * Spike component — removable. See doc/Pong_Spike_Findings.md.
 */

import { createGameState, tick, setPaddleDir, TICK_MS } from './pongPhysics.js'
import logger from '../logger.js'

// Re-export physics constants so socketHandler can import them from one place
export { BOARD_W, BOARD_H, P1_X, P2_X, PADDLE_W, PADDLE_H, BALL_R } from './pongPhysics.js'

let _io = null
export function setIO(io) { _io = io }

/**
 * Active rooms: slug → RoomEntry
 *
 * RoomEntry: {
 *   slug        string
 *   players     [socketId|null, socketId|null]   index 0=P1, 1=P2
 *   spectators  Set<socketId>
 *   state       GameState
 *   intervalId  NodeJS.Timeout | null
 *   startedAt   number   Date.now() when game loop began
 * }
 */
const rooms = new Map()

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create a new Pong room. Returns the slug.
 */
export function createRoom(slug) {
  if (rooms.has(slug)) return slug
  rooms.set(slug, {
    slug,
    players:    [null, null],
    spectators: new Set(),
    state:      createGameState(),
    intervalId: null,
    startedAt:  null,
  })
  logger.info({ slug }, 'pong room created')
  return slug
}

/**
 * Add a player to a room. Returns { playerIndex, error }.
 * First caller gets index 0 (P1/left), second gets 1 (P2/right).
 * If both seats are taken the caller becomes a spectator.
 */
export function joinRoom(slug, socketId) {
  const room = rooms.get(slug)
  if (!room) return { error: 'Room not found' }

  for (let i = 0; i < 2; i++) {
    if (room.players[i] === null) {
      room.players[i] = socketId
      logger.info({ slug, socketId, playerIndex: i }, 'pong player joined')
      // Both seats filled — start the game loop
      if (room.players[0] !== null && room.players[1] !== null) {
        startLoop(room)
      }
      return { playerIndex: i }
    }
  }

  // Room full — spectator
  room.spectators.add(socketId)
  return { playerIndex: null, spectating: true }
}

/**
 * Apply a paddle direction input from a player.
 * direction: 'up' | 'down' | 'stop'
 */
export function applyInput(slug, socketId, direction) {
  const room = rooms.get(slug)
  if (!room || room.state.status !== 'playing') return

  const idx = room.players.indexOf(socketId)
  if (idx === -1) return

  room.state = setPaddleDir(room.state, idx, direction)
}

/**
 * Remove a socket from any room it's in (disconnect handling).
 */
export function removeSocket(socketId) {
  for (const [slug, room] of rooms) {
    const idx = room.players.indexOf(socketId)
    if (idx !== -1) {
      room.players[idx] = null
      stopLoop(room)
      // Notify remaining sockets
      if (_io) _io.to(slug).emit('pong:abandoned', { reason: 'disconnect' })
      rooms.delete(slug)
      logger.info({ slug, socketId, playerIndex: idx }, 'pong room closed — player disconnected')
      return
    }
    if (room.spectators.has(socketId)) {
      room.spectators.delete(socketId)
    }
  }
}

/**
 * Get current state for a room (used when a spectator joins mid-game).
 */
export function getState(slug) {
  return rooms.get(slug)?.state ?? null
}

export function hasRoom(slug) {
  return rooms.has(slug)
}

// ── Internal ──────────────────────────────────────────────────────────────────

function startLoop(room) {
  if (room.intervalId) return
  room.startedAt  = Date.now()
  room.state      = createGameState()   // fresh state when both players are ready

  if (_io) {
    _io.to(room.slug).emit('pong:started', { state: room.state })
  }

  room.intervalId = setInterval(() => tickRoom(room), TICK_MS)
  logger.info({ slug: room.slug }, 'pong game loop started')
}

function stopLoop(room) {
  if (room.intervalId) {
    clearInterval(room.intervalId)
    room.intervalId = null
  }
}

function tickRoom(room) {
  room.state = tick(room.state)

  if (!_io) return

  // Embed sentAt so the client can measure RTT
  _io.to(room.slug).emit('pong:state', {
    state:  room.state,
    sentAt: performance.now(),
  })

  if (room.state.status === 'finished') {
    stopLoop(room)
    const duration = room.startedAt ? Date.now() - room.startedAt : 0
    logger.info(
      { slug: room.slug, winner: room.state.winner, score: room.state.score, durationMs: duration },
      'pong game finished'
    )
    // Leave room in map briefly so clients can see the final state, then clean up
    setTimeout(() => rooms.delete(room.slug), 30_000)
  }
}
