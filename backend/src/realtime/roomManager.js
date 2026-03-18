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
import { getWinner, isBoardFull, WIN_LINES } from '../ai/gameLogic.js'

const RECONNECT_WINDOW_MS = 60_000

class RoomManager {
  constructor(pool = mountainPool) {
    this._pool = pool
    /** @type {Map<string, object>} slug → room */
    this._rooms = new Map()
    /** @type {Map<string, string>} socketId → slug */
    this._socketToRoom = new Map()
  }

  /**
   * Create a new room. Returns the room object.
   */
  createRoom({ hostSocketId, hostUserId = null, spectatorAllowed = true } = {}) {
    const name = this._pool.acquire()
    if (!name) throw new Error('No mountain names available')
    const slug = MountainNamePool.toSlug(name)

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

    if (room.status === 'playing') {
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
   * Close a room and release the mountain name.
   */
  closeRoom(slug) {
    const room = this._rooms.get(slug)
    if (!room) return

    // Clear any pending timers
    for (const timer of Object.values(room.disconnectTimers)) {
      clearTimeout(timer)
    }

    // Release all socket mappings
    for (const id of [room.hostId, room.guestId, ...room.spectatorIds]) {
      if (id) this._socketToRoom.delete(id)
    }

    this._rooms.delete(slug)
    this._pool.release(room.name)
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
    return [...this._rooms.values()].map((r) => ({
      slug: r.slug,
      displayName: r.displayName,
      status: r.status,
      spectatorCount: r.spectatorIds.size,
      spectatorAllowed: r.spectatorAllowed,
    }))
  }

  get roomCount() { return this._rooms.size }
}

export const roomManager = new RoomManager()
export { RoomManager }
