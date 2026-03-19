import React from 'react'
import { create } from 'zustand'
import { connectSocket, disconnectSocket, getSocket } from '../lib/socket.js'
import { useSoundStore } from './soundStore.js'

/**
 * PvP room store — manages socket-based multiplayer game state.
 */
export const usePvpStore = create((set, get) => ({
  // Room
  slug: null,
  displayName: null,
  role: null,        // 'host' | 'guest' | 'spectator'
  myMark: null,      // 'X' | 'O' | null (spectator)
  status: 'idle',   // 'idle' | 'waiting' | 'playing' | 'finished'

  // Game state (mirrored from server)
  board: Array(9).fill(null),
  currentTurn: 'X',
  scores: { X: 0, O: 0 },
  round: 1,
  winner: null,
  winLine: null,
  spectatorCount: 0,

  // Connection
  connected: false,
  error: null,

  // ── Actions ──────────────────────────────────────────────────────

  /**
   * Host creates a room.
   */
  createRoom() {
    const socket = connectSocket()
    get()._registerListeners(socket)
    socket.emit('room:create', { spectatorAllowed: true })
    set({ status: 'waiting', role: 'host', error: null })
  },

  /**
   * Join an existing room as player or spectator.
   */
  joinRoom(slug, role = 'player') {
    const socket = connectSocket()
    get()._registerListeners(socket)
    socket.emit('room:join', { slug, role })
    set({ slug, role: role === 'spectator' ? 'spectator' : 'guest', status: 'waiting', error: null })
  },

  /**
   * Request a name swap (host, before game starts).
   */
  swapName() {
    getSocket().emit('room:swapName')
  },

  /**
   * Cancel the room (host, before game starts).
   */
  cancelRoom() {
    getSocket().emit('room:cancel')
    get().reset()
  },

  /**
   * Make a move (player only).
   */
  move(cellIndex) {
    getSocket().emit('game:move', { cellIndex })
  },

  /**
   * Request rematch.
   */
  rematch() {
    getSocket().emit('game:rematch')
  },

  /**
   * Forfeit the game.
   */
  forfeit() {
    getSocket().emit('game:forfeit')
  },

  /**
   * Reset state and disconnect.
   */
  reset() {
    disconnectSocket()
    set({
      slug: null, displayName: null, role: null, myMark: null,
      status: 'idle', board: Array(9).fill(null), currentTurn: 'X',
      scores: { X: 0, O: 0 }, round: 1, winner: null, winLine: null,
      spectatorCount: 0, connected: false, error: null,
    })
  },

  // ── Internal: socket event listeners ─────────────────────────────

  _listenersRegistered: false,

  _registerListeners(socket) {
    if (get()._listenersRegistered) return
    set({ _listenersRegistered: true })

    socket.on('connect', () => set({ connected: true }))
    socket.on('disconnect', () => set({ connected: false }))

    socket.on('room:created', ({ slug, displayName, mark }) => {
      set({ slug, displayName, myMark: mark, status: 'waiting' })
    })

    socket.on('room:renamed', ({ slug, displayName }) => {
      set({ slug, displayName })
    })

    socket.on('room:joined', ({ slug, role, mark, room }) => {
      set({
        slug,
        role,
        displayName: room?.displayName,
        myMark: mark || null,
        status: role === 'spectator' ? 'playing' : 'waiting',
        board: room?.board || Array(9).fill(null),
        currentTurn: room?.currentTurn || 'X',
        scores: room?.scores || { X: 0, O: 0 },
        spectatorCount: room?.spectatorCount ?? 0,
      })
    })

    socket.on('room:guestJoined', ({ room }) => {
      set({ displayName: room.displayName })
    })

    socket.on('room:spectatorJoined', ({ spectatorCount }) => {
      set({ spectatorCount })
    })

    socket.on('room:playerDisconnected', () => {
      // Opponent disconnected — show reconnect window notice
      set({ error: 'Opponent disconnected. Waiting 60s for reconnect…' })
    })

    socket.on('room:cancelled', () => {
      get().reset()
    })

    socket.on('game:start', ({ board, currentTurn, round, scores }) => {
      set({
        board, currentTurn, round, scores: scores || { X: 0, O: 0 },
        status: 'playing', winner: null, winLine: null, error: null,
      })
      useSoundStore.getState().play('move')
    })

    socket.on('game:moved', ({ board, currentTurn, status, winner, winLine, scores }) => {
      set({ board, currentTurn, scores })
      if (status === 'finished') {
        set({ status: 'finished', winner, winLine })
        useSoundStore.getState().play(winner ? 'win' : 'draw')
      } else {
        useSoundStore.getState().play('move')
      }
    })

    socket.on('game:forfeit', ({ winner, scores }) => {
      set({ status: 'finished', winner, scores })
      useSoundStore.getState().play('forfeit')
    })

    socket.on('error', ({ message }) => {
      const state = get()
      // If we tried to join as player but the room is already in progress,
      // automatically retry as spectator.
      if (
        state.status === 'waiting' &&
        state.role === 'guest' &&
        (message === 'Room is not waiting for a player' || message === 'Room is full')
      ) {
        getSocket().emit('room:join', { slug: state.slug, role: 'spectator' })
        set({ role: 'spectator' })
        return
      }
      set({ error: message })
    })
  },
}))
