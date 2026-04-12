/**
 * In-memory room state manager.
 * Manages PvP game rooms: creation, joining, turn management, disconnect/reconnect.
 *
 * Each room: {
 *   name, slug, hostId, guestId, spectatorIds, board, currentTurn,
 *   status: 'waiting'|'playing'|'finished',
 *   playerMarks: { [socketId]: 'X'|'O' },
 *   scores: { X: 0, O: 0 }, round,
 *   winner, winLine,
 *   spectatorAllowed,
 *   disconnectTimers: { [socketId]: timerId }
 * }
 */

import { mountainPool, MountainNamePool } from './mountainNames.js'
import { getWinner, isBoardFull, WIN_LINES } from '@xo-arena/ai'

const RECONNECT_WINDOW_MS = 60_000
const STALE_WAITING_MS = 30 * 60 * 1000   // 30 min — waiting room with no guest
const STALE_FINISHED_MS = 10 * 60 * 1000  // 10 min — finished game

class RoomManager {
  constructor(pool = mountainPool) {
    this._pool = pool
    /** @type {Map<string, object>} slug → room */
    this._rooms = new Map()
    /** @type {Map<string, string>} socketId → slug */
    this._socketToRoom = new Map()
    /** @type {((room: object) => void) | null} — called whenever a room is fully closed */
    this._onRoomClosed = null

    // Periodic sweep: remove stale rooms every 5 minutes
    this._cleanupInterval = setInterval(() => this._sweepStaleRooms(), 5 * 60 * 1000)
    this._cleanupInterval.unref?.() // don't block process exit
  }

  /** Register a callback fired whenever closeRoom() runs (used for external cleanup). */
  onRoomClosed(fn) { this._onRoomClosed = fn }

  /**
   * Create a new room. Returns the room object.
   */
  createRoom({ hostSocketId, hostUserId = null, spectatorAllowed = true, tournamentMatchId = null, tournamentId = null, bestOfN = null } = {}) {
    // If this socket already owns a waiting room (e.g. StrictMode double-invoke),
    // close the old one cleanly before creating a new one.
    const existingSlug = this._socketToRoom.get(hostSocketId)
    if (existingSlug) this.closeRoom(existingSlug)

    const name = this._pool.acquire()
    if (!name) throw new Error('No mountain names available')
    const slug = MountainNamePool.toSlug(name)

    const now = Date.now()
    const room = {
      name,
      slug,
      displayName: `Mt. ${name}`,
      hostId: hostSocketId,
      hostUserId,
      guestId: null,
      guestUserId: null,
      spectatorIds: new Set(),
      board: Array(9).fill(null),
      currentTurn: 'X',
      status: 'waiting',
      playerMarks: { [hostSocketId]: 'X' },
      scores: { X: 0, O: 0 },
      round: 1,
      winner: null,
      winLine: null,
      spectatorAllowed,
      disconnectTimers: {},
      idleTimers: {},
      createdAt: now,
      lastActivityAt: now,
      // Tournament match context (null for free-play rooms)
      tournamentMatchId,
      tournamentId,
      bestOfN,
    }

    this._rooms.set(slug, room)
    this._socketToRoom.set(hostSocketId, slug)
    return room
  }

  /**
   * Guest joins a room by slug. Returns the room or null.
   */
  joinRoom({ slug, guestSocketId, guestUserId = null } = {}) {
    const room = this._rooms.get(slug)
    if (!room) return { error: 'Room not found' }
    if (room.status !== 'waiting') return { error: 'Room is not waiting for a player' }
    if (room.guestId) return { error: 'Room is full' }

    room.guestId = guestSocketId
    room.guestUserId = guestUserId
    room.playerMarks[guestSocketId] = 'O'
    room.status = 'playing'

    this._socketToRoom.set(guestSocketId, slug)
    return { room }
  }

  /**
   * Spectator joins a room.
   */
  joinAsSpectator({ slug, socketId } = {}) {
    const room = this._rooms.get(slug)
    if (!room) return { error: 'Room not found' }
    if (!room.spectatorAllowed) return { error: 'Spectators not allowed in this room' }
    room.spectatorIds.add(socketId)
    this._socketToRoom.set(socketId, slug)
    return { room }
  }

  /**
   * Record a move. Returns { room, error }.
   */
  makeMove({ socketId, cellIndex }) {
    const slug = this._socketToRoom.get(socketId)
    if (!slug) return { error: 'Not in a room' }
    const room = this._rooms.get(slug)
    if (!room) return { error: 'Room not found' }
    if (room.status !== 'playing') return { error: 'Game not in progress' }

    const playerMark = room.playerMarks[socketId]
    if (!playerMark) return { error: 'Not a player in this room' }
    if (playerMark !== room.currentTurn) return { error: 'Not your turn' }
    if (room.board[cellIndex] !== null) return { error: 'Cell already occupied' }

    room.board[cellIndex] = playerMark
    room.lastActivityAt = Date.now()
    const winner = getWinner(room.board)
    const draw = !winner && isBoardFull(room.board)

    if (winner) {
      room.winner = winner
      room.winLine = WIN_LINES.find(([a, b, c]) =>
        room.board[a] === winner && room.board[b] === winner && room.board[c] === winner
      ) || null
      room.status = 'finished'
      room.scores[winner]++
    } else if (draw) {
      room.status = 'finished'
      room.winner = null
    } else {
      room.currentTurn = playerMark === 'X' ? 'O' : 'X'
    }

    return { room }
  }

  /**
   * Rematch — reset board, swap who goes first, increment round.
   */
  rematch({ socketId }) {
    const slug = this._socketToRoom.get(socketId)
    const room = slug && this._rooms.get(slug)
    if (!room) return { error: 'Room not found' }
    if (room.status !== 'finished') return { error: 'Game not finished' }

    room.board = Array(9).fill(null)
    room.currentTurn = room.currentTurn === 'X' ? 'O' : 'X'
    room.winner = null
    room.winLine = null
    room.status = 'playing'
    room.round++

    return { room }
  }

  /**
   * Handle a socket disconnect. Starts a 60s reconnect timer.
   * If the timer expires, the opponent wins by forfeit.
   */
  handleDisconnect({ socketId, onForfeit }) {
    const slug = this._socketToRoom.get(socketId)
    if (!slug) return null
    const room = this._rooms.get(slug)
    if (!room) return null

    const isPlayer = room.hostId === socketId || room.guestId === socketId
    if (!isPlayer) {
      room.spectatorIds.delete(socketId)
      this._socketToRoom.delete(socketId)
      return { room, wasSpectator: true }
    }

    if (room.status === 'waiting') {
      // Host left before anyone joined — close immediately
      this.closeRoom(slug)
      return { room, wasPlayer: true, roomClosed: true }
    }

    if (room.status === 'finished') {
      // Game is over — no reconnect needed, close immediately
      this.closeRoom(slug)
      return { room, wasPlayer: true, roomClosed: true }
    }

    if (room.status === 'playing') {
      const otherId = room.hostId === socketId ? room.guestId : room.hostId
      const otherAlreadyDisconnected = otherId && room.disconnectTimers[otherId]

      if (otherAlreadyDisconnected) {
        // Both players disconnected — cancel the other forfeit timer and close immediately
        clearTimeout(room.disconnectTimers[otherId])
        delete room.disconnectTimers[otherId]
        this.closeRoom(slug)
        return { room, wasPlayer: true, roomClosed: true }
      }

      const timer = setTimeout(() => {
        if (this._rooms.has(slug)) {
          const mark = room.playerMarks[socketId]
          const oppMark = mark === 'X' ? 'O' : 'X'
          room.winner = oppMark
          room.scores[oppMark]++
          room.status = 'finished'
          delete room.disconnectTimers[socketId]
          onForfeit?.({ room, forfeiterMark: mark })
        }
      }, RECONNECT_WINDOW_MS)

      room.disconnectTimers[socketId] = timer
    }

    return { room, wasPlayer: true }
  }

  /**
   * Reconnect: cancel the disconnect timer. Returns the room.
   */
  handleReconnect({ oldSocketId, newSocketId }) {
    const slug = this._socketToRoom.get(oldSocketId)
    if (!slug) return { error: 'Session not found' }
    const room = this._rooms.get(slug)
    if (!room) return { error: 'Room not found' }

    // Clear forfeit timer
    const timer = room.disconnectTimers[oldSocketId]
    if (timer) {
      clearTimeout(timer)
      delete room.disconnectTimers[oldSocketId]
    }

    // Update socket ID in room
    if (room.hostId === oldSocketId) room.hostId = newSocketId
    if (room.guestId === oldSocketId) room.guestId = newSocketId
    const mark = room.playerMarks[oldSocketId]
    delete room.playerMarks[oldSocketId]
    room.playerMarks[newSocketId] = mark

    this._socketToRoom.delete(oldSocketId)
    this._socketToRoom.set(newSocketId, slug)

    return { room }
  }

  /**
   * Remove rooms that have been idle too long.
   * Called automatically every 5 minutes.
   */
  _sweepStaleRooms() {
    const now = Date.now()
    for (const [slug, room] of this._rooms) {
      const age = now - (room.lastActivityAt ?? room.createdAt ?? 0)
      if (room.status === 'waiting' && age > STALE_WAITING_MS) {
        this.closeRoom(slug)
      } else if (room.status === 'finished' && age > STALE_FINISHED_MS) {
        this.closeRoom(slug)
      }
    }
  }

  /**
   * Reset (or start) the idle timer for a single participant.
   *
   * Phase 1: after warnMs, call onWarn and start the grace countdown.
   * Phase 2: after graceMs from the warning, call onAbandon (player) or onKick (spectator).
   *
   * Calling resetIdleTimer again cancels any pending timer (both phases).
   * Should be called: on game start (for all participants), on move (mover only), on idle:pong.
   */
  resetIdleTimer({ socketId, warnMs, graceMs, onWarn, onAbandon, onKick }) {
    const slug = this._socketToRoom.get(socketId)
    const room = slug && this._rooms.get(slug)
    if (!room || room.status === 'finished' || room.status === 'waiting') return

    this._clearSocketIdleTimer(room, socketId)

    const isPlayer = room.hostId === socketId || room.guestId === socketId

    room.idleTimers[socketId] = setTimeout(() => {
      if (!this._rooms.has(slug)) return
      delete room.idleTimers[socketId]

      onWarn?.({ socketId, graceMs })

      room.idleTimers[socketId] = setTimeout(() => {
        if (!this._rooms.has(slug)) return
        delete room.idleTimers[socketId]

        if (isPlayer) {
          // Snapshot before closeRoom wipes them
          const absentSocketId = socketId
          const absentUserId = room.hostId === socketId ? room.hostUserId : room.guestUserId
          const allSocketIds = [room.hostId, room.guestId, ...room.spectatorIds].filter(Boolean)
          this.closeRoom(slug)
          onAbandon?.({ absentSocketId, absentUserId, allSocketIds })
        } else {
          room.spectatorIds.delete(socketId)
          this._socketToRoom.delete(socketId)
          onKick?.({ socketId })
        }
      }, graceMs)
    }, warnMs)
  }

  _clearSocketIdleTimer(room, socketId) {
    const t = room.idleTimers[socketId]
    if (t) {
      clearTimeout(t)
      delete room.idleTimers[socketId]
    }
  }

  /**
   * Close a room and release the mountain name.
   */
  closeRoom(slug) {
    const room = this._rooms.get(slug)
    if (!room) return

    // Clear any pending timers
    for (const timer of Object.values(room.disconnectTimers)) {
      clearTimeout(timer)
    }
    for (const timer of Object.values(room.idleTimers)) {
      clearTimeout(timer)
    }

    // Release all socket mappings
    for (const id of [room.hostId, room.guestId, ...room.spectatorIds]) {
      if (id) this._socketToRoom.delete(id)
    }

    this._rooms.delete(slug)
    this._pool.release(room.name)
    this._onRoomClosed?.(room)
  }

  /**
   * Swap mountain name (host-only, before guest joins).
   */
  swapName({ socketId }) {
    const slug = this._socketToRoom.get(socketId)
    const room = slug && this._rooms.get(slug)
    if (!room) return { error: 'Room not found' }
    if (room.status !== 'waiting') return { error: 'Cannot rename after opponent joins' }
    if (room.hostId !== socketId) return { error: 'Only the host can rename the room' }

    const newName = this._pool.swap(room.name)
    if (!newName) return { error: 'No names available' }

    const newSlug = MountainNamePool.toSlug(newName)
    this._rooms.delete(slug)
    this._socketToRoom.set(socketId, newSlug)

    room.name = newName
    room.slug = newSlug
    room.displayName = `Mt. ${newName}`
    this._rooms.set(newSlug, room)

    return { room }
  }

  /** Get a room by slug. */
  getRoom(slug) { return this._rooms.get(slug) || null }

  /** Get all active rooms (waiting or playing) for the active rooms list. */
  listRooms() {
    return [...this._rooms.values()]
      .filter((r) => r.status === 'waiting' || r.status === 'playing')
      .map((r) => ({
        slug: r.slug,
        displayName: r.displayName,
        status: r.status,
        spectatorCount: r.spectatorIds.size,
        spectatorAllowed: r.spectatorAllowed,
      }))
  }

  /** Active rooms only (waiting or playing) — finished rooms are in the stale sweep queue and not a leak risk. */
  get roomCount() {
    let count = 0
    for (const room of this._rooms.values()) {
      if (room.status === 'waiting' || room.status === 'playing') count++
    }
    return count
  }
}

export const roomManager = new RoomManager()
export { RoomManager }
