import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock sound store — pvpStore calls useSoundStore.getState().play() in event handlers
vi.mock('../soundStore.js', () => ({
  useSoundStore: {
    getState: vi.fn(() => ({ play: vi.fn() })),
  },
}))

// Mock getToken — used inside createRoom / joinRoom async calls
vi.mock('../../lib/getToken.js', () => ({
  getToken: vi.fn(() => Promise.resolve(null)),
}))

// Build a fresh mock socket factory so each test can have isolated listeners
function makeMockSocket() {
  const listeners = {}
  return {
    on: vi.fn((event, cb) => { listeners[event] = cb }),
    off: vi.fn(),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    id: 'test-socket-id',
    _listeners: listeners,
    _trigger: (event, data) => listeners[event]?.(data),
  }
}

// Module-level socket reference — replaced in beforeEach
let mockSocket

vi.mock('../../lib/socket.js', () => ({
  getSocket: vi.fn(() => mockSocket),
  connectSocket: vi.fn(() => mockSocket),
  disconnectSocket: vi.fn(),
}))

import { getSocket, connectSocket } from '../../lib/socket.js'
import { usePvpStore } from '../pvpStore.js'

function s() {
  return usePvpStore.getState()
}

beforeEach(() => {
  // Build a new socket so listener maps are clean for each test
  mockSocket = makeMockSocket()
  getSocket.mockReturnValue(mockSocket)
  connectSocket.mockReturnValue(mockSocket)

  // Full state reset
  usePvpStore.getState().reset()
  // reset() calls disconnectSocket and clears state; also clear the listener guard
  usePvpStore.setState({ _listenersRegistered: false })
})

// Helper: call createRoom and register listeners
function createRoom() {
  s().createRoom()
}

// Helper: trigger room:created so slug/mark are set
function triggerRoomCreated(slug = 'test-room') {
  mockSocket._trigger('room:created', { slug, displayName: 'Test Room', mark: 'X' })
}

// Helper: trigger game:start
function triggerGameStart(board = Array(9).fill(null)) {
  mockSocket._trigger('game:start', {
    board,
    currentTurn: 'X',
    round: 1,
    scores: { X: 0, O: 0 },
  })
}

describe('pvpStore', () => {

  // ── createRoom ────────────────────────────────────────────────────────────

  describe('createRoom', () => {
    it('emits "room:create" on the socket', () => {
      createRoom()
      // emit is called asynchronously after getToken resolves; wait a tick
      return Promise.resolve().then(() => {
        const calls = mockSocket.emit.mock.calls
        expect(calls.some(([event]) => event === 'room:create')).toBe(true)
      })
    })

    it('sets status to "waiting" and role to "host"', () => {
      createRoom()
      expect(s().status).toBe('waiting')
      expect(s().role).toBe('host')
    })
  })

  // ── joinRoom ──────────────────────────────────────────────────────────────

  describe('joinRoom', () => {
    it('emits "room:join" with the correct slug and role', () => {
      s().joinRoom('mt-everest', 'player')
      return Promise.resolve().then(() => {
        const joinCall = mockSocket.emit.mock.calls.find(([e]) => e === 'room:join')
        expect(joinCall).toBeDefined()
        expect(joinCall[1].slug).toBe('mt-everest')
        expect(joinCall[1].role).toBe('player')
      })
    })

    it('sets role to "guest" for a player join', () => {
      s().joinRoom('mt-everest', 'player')
      expect(s().role).toBe('guest')
    })

    it('sets role to "spectator" for a spectator join', () => {
      s().joinRoom('mt-everest', 'spectator')
      expect(s().role).toBe('spectator')
    })
  })

  // ── move ──────────────────────────────────────────────────────────────────

  describe('move', () => {
    beforeEach(() => {
      createRoom()
      triggerRoomCreated()
      triggerGameStart()
      // myMark was set to 'X' by room:created
    })

    it('emits "game:move" with the cellIndex', () => {
      s().move(4)
      expect(mockSocket.emit).toHaveBeenCalledWith('game:move', { cellIndex: 4 })
    })

    it('updates the board optimistically before server confirmation', () => {
      s().move(4)
      expect(s().board[4]).toBe('X')
    })

    it('flips currentTurn optimistically', () => {
      s().move(4)
      expect(s().currentTurn).toBe('O')
    })

    it('saves an optimistic snapshot for potential rollback', () => {
      s().move(4)
      expect(s()._optimisticSnapshot).not.toBeNull()
      expect(s()._optimisticSnapshot.board[4]).toBeNull() // snapshot captured board BEFORE move
      expect(s()._optimisticSnapshot.currentTurn).toBe('X')
    })
  })

  // ── socket event: room:created ────────────────────────────────────────────

  describe('room:created event', () => {
    it('sets slug and displayName in the store', () => {
      createRoom()
      mockSocket._trigger('room:created', { slug: 'mt-k2', displayName: 'Mt. K2', mark: 'X' })
      expect(s().slug).toBe('mt-k2')
      expect(s().displayName).toBe('Mt. K2')
    })

    it('sets myMark', () => {
      createRoom()
      mockSocket._trigger('room:created', { slug: 'mt-k2', displayName: 'Mt. K2', mark: 'X' })
      expect(s().myMark).toBe('X')
    })
  })

  // ── socket event: game:start ──────────────────────────────────────────────

  describe('game:start event', () => {
    it('sets board and currentTurn', () => {
      createRoom()
      triggerRoomCreated()
      const board = Array(9).fill(null)
      board[0] = 'X'
      triggerGameStart(board)
      expect(s().board[0]).toBe('X')
      expect(s().currentTurn).toBe('X')
    })

    it('transitions status to "playing"', () => {
      createRoom()
      triggerRoomCreated()
      triggerGameStart()
      expect(s().status).toBe('playing')
    })
  })

  // ── socket event: game:moved ──────────────────────────────────────────────

  describe('game:moved event', () => {
    beforeEach(() => {
      createRoom()
      triggerRoomCreated()
      triggerGameStart()
    })

    it('updates the board from the server', () => {
      const nextBoard = Array(9).fill(null)
      nextBoard[4] = 'X'
      mockSocket._trigger('game:moved', {
        board: nextBoard, currentTurn: 'O', status: 'playing',
        winner: null, winLine: null, scores: { X: 0, O: 0 },
      })
      expect(s().board[4]).toBe('X')
      expect(s().currentTurn).toBe('O')
    })

    it('clears the optimistic snapshot', () => {
      s().move(4)
      const nextBoard = Array(9).fill(null)
      nextBoard[4] = 'X'
      mockSocket._trigger('game:moved', {
        board: nextBoard, currentTurn: 'O', status: 'playing',
        winner: null, winLine: null, scores: { X: 0, O: 0 },
      })
      expect(s()._optimisticSnapshot).toBeNull()
    })

    it('sets status to "finished" when server reports finished', () => {
      mockSocket._trigger('game:moved', {
        board: ['X', 'X', 'X', null, null, null, null, null, null],
        currentTurn: 'O', status: 'finished', winner: 'X',
        winLine: [0, 1, 2], scores: { X: 1, O: 0 },
      })
      expect(s().status).toBe('finished')
      expect(s().winner).toBe('X')
    })
  })

  // ── socket event: error — auto-retry as spectator ─────────────────────────

  describe('error event — room full auto-retry', () => {
    it('re-emits room:join as spectator when room is full and role is guest', () => {
      s().joinRoom('mt-everest', 'player')
      // status='waiting', role='guest' at this point
      mockSocket._trigger('error', { message: 'Room is full' })
      const retryCall = mockSocket.emit.mock.calls.find(
        ([e, d]) => e === 'room:join' && d.role === 'spectator'
      )
      expect(retryCall).toBeDefined()
      expect(s().role).toBe('spectator')
    })

    it('auto-retries on "Room is not waiting for a player" message too', () => {
      s().joinRoom('mt-everest', 'player')
      mockSocket._trigger('error', { message: 'Room is not waiting for a player' })
      expect(s().role).toBe('spectator')
    })

    it('does NOT auto-retry when role is not guest', () => {
      createRoom() // role = 'host'
      triggerRoomCreated()
      mockSocket._trigger('error', { message: 'Room is full' })
      // Should not change role to spectator
      expect(s().role).toBe('host')
      expect(s().error).toBe('Room is full')
    })
  })

  // ── socket event: error — optimistic rollback ─────────────────────────────

  describe('error event — optimistic rollback', () => {
    it('rolls back the board and currentTurn when an optimistic snapshot exists', () => {
      createRoom()
      triggerRoomCreated()
      triggerGameStart()
      s().move(4)

      mockSocket._trigger('error', { message: 'Not your turn' })

      const state = s()
      expect(state.board[4]).toBeNull()
      expect(state.currentTurn).toBe('X')
      expect(state._optimisticSnapshot).toBeNull()
      expect(state.error).toBe('Not your turn')
    })
  })

  // ── socket event: game:forfeit ────────────────────────────────────────────

  describe('game:forfeit event', () => {
    it('sets status to "finished" with the winning player', () => {
      createRoom()
      triggerRoomCreated()
      triggerGameStart()
      mockSocket._trigger('game:forfeit', { winner: 'O', scores: { X: 0, O: 1 } })
      expect(s().status).toBe('finished')
      expect(s().winner).toBe('O')
      expect(s().scores.O).toBe(1)
    })
  })

  // ── reset ─────────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('returns all state to idle defaults', () => {
      createRoom()
      triggerRoomCreated()
      s().reset()
      const state = s()
      expect(state.status).toBe('idle')
      expect(state.slug).toBeNull()
      expect(state.myMark).toBeNull()
      expect(state.role).toBeNull()
      expect(state.board).toEqual(Array(9).fill(null))
      expect(state._optimisticSnapshot).toBeNull()
    })

    it('clears idleWarning, abandoned, and kicked on reset', () => {
      createRoom()
      triggerRoomCreated()
      usePvpStore.setState({ idleWarning: { secondsRemaining: 30 }, abandoned: { reason: 'idle' }, kicked: true })
      s().reset()
      expect(s().idleWarning).toBeNull()
      expect(s().abandoned).toBeNull()
      expect(s().kicked).toBe(false)
    })
  })

  // ── socket event: idle:warning ────────────────────────────────────────────

  describe('idle:warning event', () => {
    it('sets idleWarning with secondsRemaining', () => {
      createRoom()
      triggerRoomCreated()
      triggerGameStart()
      mockSocket._trigger('idle:warning', { secondsRemaining: 45 })
      expect(s().idleWarning).toEqual({ secondsRemaining: 45 })
    })
  })

  // ── idlePong action ───────────────────────────────────────────────────────

  describe('idlePong', () => {
    it('emits idle:pong on the socket', () => {
      createRoom()
      triggerRoomCreated()
      triggerGameStart()
      s().idlePong()
      expect(mockSocket.emit).toHaveBeenCalledWith('idle:pong')
    })

    it('clears idleWarning', () => {
      createRoom()
      triggerRoomCreated()
      triggerGameStart()
      usePvpStore.setState({ idleWarning: { secondsRemaining: 20 } })
      s().idlePong()
      expect(s().idleWarning).toBeNull()
    })
  })

  // ── socket event: room:abandoned ──────────────────────────────────────────

  describe('room:abandoned event', () => {
    it('sets abandoned with reason and absentUserId', () => {
      createRoom()
      triggerRoomCreated()
      triggerGameStart()
      mockSocket._trigger('room:abandoned', { reason: 'idle', absentUserId: 'user-123' })
      expect(s().abandoned).toEqual({ reason: 'idle', absentUserId: 'user-123' })
    })

    it('clears idleWarning when room is abandoned', () => {
      createRoom()
      triggerRoomCreated()
      triggerGameStart()
      usePvpStore.setState({ idleWarning: { secondsRemaining: 10 } })
      mockSocket._trigger('room:abandoned', { reason: 'idle', absentUserId: null })
      expect(s().idleWarning).toBeNull()
    })
  })

  // ── socket event: room:kicked ─────────────────────────────────────────────

  describe('room:kicked event', () => {
    it('sets kicked to true for idle reason', () => {
      createRoom()
      triggerRoomCreated()
      triggerGameStart()
      mockSocket._trigger('room:kicked', { reason: 'idle' })
      expect(s().kicked).toBe(true)
    })

    it('clears idleWarning when kicked', () => {
      createRoom()
      triggerRoomCreated()
      triggerGameStart()
      usePvpStore.setState({ idleWarning: { secondsRemaining: 5 } })
      mockSocket._trigger('room:kicked', { reason: 'idle' })
      expect(s().idleWarning).toBeNull()
    })
  })

  // ── game:moved auto-dismisses idle warning ────────────────────────────────

  describe('game:moved clears idle warning', () => {
    it('clears idleWarning when a move is made', () => {
      createRoom()
      triggerRoomCreated()
      triggerGameStart()
      usePvpStore.setState({ idleWarning: { secondsRemaining: 30 } })
      mockSocket._trigger('game:moved', {
        board: Array(9).fill(null), currentTurn: 'O',
        status: 'playing', winner: null, winLine: null, scores: { X: 0, O: 0 },
      })
      expect(s().idleWarning).toBeNull()
    })
  })
})
