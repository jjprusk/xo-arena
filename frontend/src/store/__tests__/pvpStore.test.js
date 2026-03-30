import { describe, it, expect, vi, beforeEach } from 'vitest'
import { usePvpStore } from '../pvpStore.js'

// Mock socket.io-client
vi.mock('../../lib/socket.js', () => {
  const listeners = {}
  const mockSocket = {
    connected: false,
    emit: vi.fn(),
    on: (event, cb) => { listeners[event] = cb },
    off: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    _listeners: listeners,
    _trigger: (event, data) => listeners[event]?.(data),
  }
  return {
    getSocket: () => mockSocket,
    connectSocket: () => mockSocket,
    disconnectSocket: vi.fn(),
  }
})

let socket

beforeEach(async () => {
  usePvpStore.getState().reset()
  // Force re-register listeners
  usePvpStore.setState({ _listenersRegistered: false })
  const { connectSocket } = await import('../../lib/socket.js')
  socket = connectSocket()
})

describe('pvpStore — socket events', () => {
  it('starts in idle state', () => {
    expect(usePvpStore.getState().status).toBe('idle')
  })

  it('createRoom sets status to waiting', () => {
    usePvpStore.getState().createRoom()
    expect(usePvpStore.getState().status).toBe('waiting')
    expect(usePvpStore.getState().role).toBe('host')
  })

  it('room:created event sets slug and mark', () => {
    usePvpStore.getState().createRoom()
    socket._trigger('room:created', { slug: 'mt-everest', displayName: 'Mt. Everest', mark: 'X' })
    const state = usePvpStore.getState()
    expect(state.slug).toBe('mt-everest')
    expect(state.myMark).toBe('X')
  })

  it('room:renamed updates slug', () => {
    usePvpStore.getState().createRoom()
    socket._trigger('room:created', { slug: 'mt-everest', displayName: 'Mt. Everest', mark: 'X' })
    socket._trigger('room:renamed', { slug: 'mt-k2', displayName: 'Mt. K2' })
    expect(usePvpStore.getState().slug).toBe('mt-k2')
  })

  it('game:start transitions to playing', () => {
    usePvpStore.getState().createRoom()
    socket._trigger('room:created', { slug: 'mt-everest', displayName: 'Mt. Everest', mark: 'X' })
    socket._trigger('game:start', {
      board: Array(9).fill(null),
      currentTurn: 'X',
      round: 1,
      scores: { X: 0, O: 0 },
    })
    expect(usePvpStore.getState().status).toBe('playing')
  })

  it('game:moved updates board', () => {
    usePvpStore.getState().createRoom()
    socket._trigger('room:created', { slug: 'mt-everest', displayName: 'Mt. Everest', mark: 'X' })
    socket._trigger('game:start', { board: Array(9).fill(null), currentTurn: 'X', round: 1, scores: { X: 0, O: 0 } })

    const nextBoard = Array(9).fill(null)
    nextBoard[4] = 'X'
    socket._trigger('game:moved', {
      cellIndex: 4,
      board: nextBoard,
      currentTurn: 'O',
      status: 'playing',
      winner: null,
      winLine: null,
      scores: { X: 0, O: 0 },
    })
    expect(usePvpStore.getState().board[4]).toBe('X')
    expect(usePvpStore.getState().currentTurn).toBe('O')
  })

  it('game:moved with status finished transitions correctly', () => {
    usePvpStore.getState().createRoom()
    socket._trigger('room:created', { slug: 'mt-everest', displayName: 'Mt. Everest', mark: 'X' })
    socket._trigger('game:start', { board: Array(9).fill(null), currentTurn: 'X', round: 1, scores: { X: 0, O: 0 } })

    socket._trigger('game:moved', {
      board: ['X', 'X', 'X', null, null, null, null, null, null],
      currentTurn: 'O',
      status: 'finished',
      winner: 'X',
      winLine: [0, 1, 2],
      scores: { X: 1, O: 0 },
    })
    const state = usePvpStore.getState()
    expect(state.status).toBe('finished')
    expect(state.winner).toBe('X')
  })

  it('error event sets error message', () => {
    usePvpStore.getState().createRoom()
    socket._trigger('error', { message: 'Not your turn' })
    expect(usePvpStore.getState().error).toBe('Not your turn')
  })

  it('move() optimistically places mark and flips turn', () => {
    usePvpStore.getState().createRoom()
    socket._trigger('room:created', { slug: 'mt-everest', displayName: 'Mt. Everest', mark: 'X' })
    socket._trigger('game:start', { board: Array(9).fill(null), currentTurn: 'X', round: 1, scores: { X: 0, O: 0 } })
    usePvpStore.setState({ status: 'playing' })

    usePvpStore.getState().move(4)

    const state = usePvpStore.getState()
    expect(state.board[4]).toBe('X')
    expect(state.currentTurn).toBe('O')
    expect(state._optimisticSnapshot).not.toBeNull()
  })

  it('game:moved clears optimistic snapshot', () => {
    usePvpStore.getState().createRoom()
    socket._trigger('room:created', { slug: 'mt-everest', displayName: 'Mt. Everest', mark: 'X' })
    socket._trigger('game:start', { board: Array(9).fill(null), currentTurn: 'X', round: 1, scores: { X: 0, O: 0 } })
    usePvpStore.setState({ status: 'playing' })
    usePvpStore.getState().move(4)

    const nextBoard = Array(9).fill(null)
    nextBoard[4] = 'X'
    socket._trigger('game:moved', {
      cellIndex: 4, board: nextBoard, currentTurn: 'O',
      status: 'playing', winner: null, winLine: null, scores: { X: 0, O: 0 },
    })

    expect(usePvpStore.getState()._optimisticSnapshot).toBeNull()
    expect(usePvpStore.getState().board[4]).toBe('X')
  })

  it('error rolls back optimistic move', () => {
    usePvpStore.getState().createRoom()
    socket._trigger('room:created', { slug: 'mt-everest', displayName: 'Mt. Everest', mark: 'X' })
    socket._trigger('game:start', { board: Array(9).fill(null), currentTurn: 'X', round: 1, scores: { X: 0, O: 0 } })
    usePvpStore.setState({ status: 'playing' })
    usePvpStore.getState().move(4)

    socket._trigger('error', { message: 'Not your turn' })

    const state = usePvpStore.getState()
    expect(state.board[4]).toBeNull()
    expect(state.currentTurn).toBe('X')
    expect(state._optimisticSnapshot).toBeNull()
    expect(state.error).toBe('Not your turn')
  })

  it('reset clears all state', () => {
    usePvpStore.getState().createRoom()
    socket._trigger('room:created', { slug: 'mt-everest', displayName: 'Mt. Everest', mark: 'X' })
    usePvpStore.getState().reset()
    const state = usePvpStore.getState()
    expect(state.status).toBe('idle')
    expect(state.slug).toBeNull()
  })
})
