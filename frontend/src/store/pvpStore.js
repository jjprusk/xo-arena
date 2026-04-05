import React from 'react'
import { create } from 'zustand'
import { connectSocket, disconnectSocket, getSocket } from '../lib/socket.js'
import { useSoundStore } from './soundStore.js'
import { getToken } from '../lib/getToken.js'

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

  // Opponent info (populated once both players are in the room)
  opponentName: null,
  opponentElo: null,

  // Connection
  connected: false,
  error: null,
  isAutoRoom: false,

  // Reactions
  incomingReaction: null,  // { emoji, fromMark, id } — cleared after display

  // Optimistic move — snapshot before the move for rollback on server rejection
  _optimisticSnapshot: null,  // { board, currentTurn } | null

  // Inactivity
  idleWarning: null,  // { secondsRemaining: N } | null — "Still Active?" popup data
  abandoned: null,    // { reason: 'idle', absentUserId } | null — room was abandoned
  kicked: false,      // true when spectator was kicked for inactivity

  // ── Actions ──────────────────────────────────────────────────────

  /**
   * Host creates a room.
   */
  createRoom({ auto = false } = {}) {
    const socket = connectSocket()
    get()._registerListeners(socket)
    set({ status: 'waiting', role: 'host', error: null, isAutoRoom: auto })
    // Fetch auth token to pass with the create event (enables server-side user identification)
    getToken().then((token) => {
      socket.emit('room:create', { spectatorAllowed: true, authToken: token || null })
    })
  },

  /**
   * Join an existing room as player or spectator.
   */
  joinRoom(slug, role = 'player') {
    const socket = connectSocket()
    get()._registerListeners(socket)
    set({ slug, role: role === 'spectator' ? 'spectator' : 'guest', status: 'waiting', error: null })
    getToken().then((token) => {
      socket.emit('room:join', { slug, role, authToken: token || null })
    })
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
   * Make a move (player only) — optimistically applied immediately, rolled
   * back if the server rejects the move via the `error` event.
   */
  move(cellIndex) {
    const { board, currentTurn, myMark } = get()
    const newBoard = [...board]
    newBoard[cellIndex] = myMark
    const oppTurn = myMark === 'X' ? 'O' : 'X'
    set({
      board: newBoard,
      currentTurn: oppTurn,
      _optimisticSnapshot: { board, currentTurn },
    })
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
   * Send an emoji reaction.
   */
  sendReaction(emoji) {
    getSocket().emit('game:reaction', { emoji })
  },

  /**
   * Acknowledge "Still Active?" — resets the server idle timer.
   */
  idlePong() {
    getSocket()?.emit('idle:pong')
    set({ idleWarning: null })
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
      spectatorCount: 0, connected: false, error: null, isAutoRoom: false,
      incomingReaction: null, opponentName: null, opponentElo: null,
      _optimisticSnapshot: null, idleWarning: null, abandoned: null, kicked: false,
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
      // Guest (mark=O) → opponent is the host
      const opponentName = mark === 'O' ? (room?.hostUserDisplayName ?? null) : null
      const opponentElo  = mark === 'O' ? (room?.hostUserElo ?? null) : null
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
        opponentName,
        opponentElo,
      })
    })

    socket.on('room:guestJoined', ({ room }) => {
      // Host (mark=X) → opponent is the guest who just joined
      set({
        displayName: room.displayName,
        opponentName: room.guestUserDisplayName ?? null,
        opponentElo: room.guestUserElo ?? null,
      })
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
      // Auto-dismiss idle warning when a move is made (game is active)
      set({ board, currentTurn, scores, _optimisticSnapshot: null, idleWarning: null })
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

    socket.on('game:reaction', ({ emoji, fromMark }) => {
      set({ incomingReaction: { emoji, fromMark, id: Date.now() } })
      setTimeout(() => set({ incomingReaction: null }), 2500)
    })

    socket.on('idle:warning', ({ secondsRemaining }) => {
      set({ idleWarning: { secondsRemaining } })
    })

    socket.on('room:abandoned', ({ reason, absentUserId }) => {
      set({ abandoned: { reason, absentUserId }, idleWarning: null })
    })

    socket.on('room:kicked', ({ reason }) => {
      set({ kicked: reason === 'idle', idleWarning: null })
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
      // Roll back an optimistic move if one is pending
      if (state._optimisticSnapshot) {
        set({
          board: state._optimisticSnapshot.board,
          currentTurn: state._optimisticSnapshot.currentTurn,
          _optimisticSnapshot: null,
          error: message,
        })
        setTimeout(() => set({ error: null }), 2000)
        return
      }
      set({ error: message })
    })
  },
}))
