import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { RoomManager } from '../roomManager.js'
import { MountainNamePool } from '../mountainNames.js'

vi.useFakeTimers()

const NAMES = ['Everest', 'K2', 'Kangchenjunga', 'Lhotse', 'Makalu',
  'Cho-Oyu', 'Dhaulagiri', 'Manaslu', 'Nanga-Parbat', 'Annapurna']

function makeManager() {
  return new RoomManager(new MountainNamePool([...NAMES]))
}

describe('RoomManager — createRoom', () => {
  let rm

  beforeEach(() => { rm = makeManager() })

  it('creates a room and returns it', () => {
    const room = rm.createRoom({ hostSocketId: 'host1' })
    expect(room).toBeTruthy()
    expect(room.status).toBe('waiting')
    expect(room.hostId).toBe('host1')
    expect(room.playerMarks['host1']).toBe('X')
  })

  it('assigns a mountain name', () => {
    const room = rm.createRoom({ hostSocketId: 'host1' })
    expect(NAMES).toContain(room.name)
  })

  it('throws when pool exhausted', () => {
    const small = new RoomManager(new MountainNamePool(['OnlyOne']))
    small.createRoom({ hostSocketId: 'h1' })
    expect(() => small.createRoom({ hostSocketId: 'h2' })).toThrow('No mountain names available')
  })
})

describe('RoomManager — joinRoom', () => {
  let rm, hostRoom

  beforeEach(() => {
    rm = makeManager()
    hostRoom = rm.createRoom({ hostSocketId: 'host1' })
  })

  it('guest joins successfully', () => {
    const { room, error } = rm.joinRoom({ slug: hostRoom.slug, guestSocketId: 'guest1' })
    expect(error).toBeUndefined()
    expect(room.status).toBe('playing')
    expect(room.guestId).toBe('guest1')
    expect(room.playerMarks['guest1']).toBe('O')
  })

  it('returns error for unknown slug', () => {
    const { error } = rm.joinRoom({ slug: 'mt-nope', guestSocketId: 'g1' })
    expect(error).toBeTruthy()
  })

  it('returns error when room is full', () => {
    rm.joinRoom({ slug: hostRoom.slug, guestSocketId: 'g1' })
    const { error } = rm.joinRoom({ slug: hostRoom.slug, guestSocketId: 'g2' })
    expect(error).toBeTruthy()
  })
})

describe('RoomManager — makeMove', () => {
  let rm, slug

  beforeEach(() => {
    rm = makeManager()
    const room = rm.createRoom({ hostSocketId: 'host1' })
    slug = room.slug
    rm.joinRoom({ slug, guestSocketId: 'guest1' })
  })

  it('places X on first move', () => {
    const { room } = rm.makeMove({ socketId: 'host1', cellIndex: 4 })
    expect(room.board[4]).toBe('X')
    expect(room.currentTurn).toBe('O')
  })

  it('rejects move out of turn', () => {
    const { error } = rm.makeMove({ socketId: 'guest1', cellIndex: 4 })
    expect(error).toBeTruthy()
  })

  it('rejects move on occupied cell', () => {
    rm.makeMove({ socketId: 'host1', cellIndex: 4 })
    const { error } = rm.makeMove({ socketId: 'guest1', cellIndex: 4 })
    expect(error).toBeTruthy()
  })

  it('detects win', () => {
    rm.makeMove({ socketId: 'host1', cellIndex: 0 })   // X
    rm.makeMove({ socketId: 'guest1', cellIndex: 3 })  // O
    rm.makeMove({ socketId: 'host1', cellIndex: 1 })   // X
    rm.makeMove({ socketId: 'guest1', cellIndex: 4 })  // O
    const { room } = rm.makeMove({ socketId: 'host1', cellIndex: 2 }) // X wins
    expect(room.status).toBe('finished')
    expect(room.winner).toBe('X')
    expect(room.scores.X).toBe(1)
  })

  it('detects draw', () => {
    // X:0 O:1 X:2 O:4 X:3 O:5 X:7 O:6 X:8
    rm.makeMove({ socketId: 'host1', cellIndex: 0 })
    rm.makeMove({ socketId: 'guest1', cellIndex: 1 })
    rm.makeMove({ socketId: 'host1', cellIndex: 2 })
    rm.makeMove({ socketId: 'guest1', cellIndex: 4 })
    rm.makeMove({ socketId: 'host1', cellIndex: 3 })
    rm.makeMove({ socketId: 'guest1', cellIndex: 5 })
    rm.makeMove({ socketId: 'host1', cellIndex: 7 })
    rm.makeMove({ socketId: 'guest1', cellIndex: 6 })
    const { room } = rm.makeMove({ socketId: 'host1', cellIndex: 8 })
    expect(room.status).toBe('finished')
    expect(room.winner).toBeNull()
  })
})

describe('RoomManager — rematch', () => {
  let rm, slug

  beforeEach(() => {
    rm = makeManager()
    const room = rm.createRoom({ hostSocketId: 'host1' })
    slug = room.slug
    rm.joinRoom({ slug, guestSocketId: 'guest1' })
    // Play a quick win
    rm.makeMove({ socketId: 'host1', cellIndex: 0 })
    rm.makeMove({ socketId: 'guest1', cellIndex: 3 })
    rm.makeMove({ socketId: 'host1', cellIndex: 1 })
    rm.makeMove({ socketId: 'guest1', cellIndex: 4 })
    rm.makeMove({ socketId: 'host1', cellIndex: 2 })
  })

  it('resets board and increments round', () => {
    const { room } = rm.rematch({ socketId: 'host1' })
    expect(room.board).toEqual(Array(9).fill(null))
    expect(room.round).toBe(2)
    expect(room.status).toBe('playing')
  })

  it('preserves scores', () => {
    const { room } = rm.rematch({ socketId: 'host1' })
    expect(room.scores.X).toBe(1)
  })
})

describe('RoomManager — disconnect / reconnect', () => {
  let rm, slug

  beforeEach(() => {
    rm = makeManager()
    const room = rm.createRoom({ hostSocketId: 'host1' })
    slug = room.slug
    rm.joinRoom({ slug, guestSocketId: 'guest1' })
  })

  it('starts a forfeit timer on disconnect', () => {
    const onForfeit = vi.fn()
    rm.handleDisconnect({ socketId: 'host1', onForfeit })
    expect(rm.getRoom(slug).disconnectTimers['host1']).toBeTruthy()
  })

  it('triggers forfeit after 60s', () => {
    const onForfeit = vi.fn()
    rm.handleDisconnect({ socketId: 'host1', onForfeit })
    vi.advanceTimersByTime(60_001)
    expect(onForfeit).toHaveBeenCalled()
    expect(rm.getRoom(slug).winner).toBe('O')
  })

  it('cancels forfeit timer on reconnect', () => {
    const onForfeit = vi.fn()
    rm.handleDisconnect({ socketId: 'host1', onForfeit })
    rm.handleReconnect({ oldSocketId: 'host1', newSocketId: 'host1-new' })
    vi.advanceTimersByTime(60_001)
    expect(onForfeit).not.toHaveBeenCalled()
  })
})

describe('RoomManager — closeRoom', () => {
  it('releases the mountain name', () => {
    const rm = makeManager()
    const room = rm.createRoom({ hostSocketId: 'h1' })
    const availBefore = rm._pool.available
    rm.closeRoom(room.slug)
    expect(rm._pool.available).toBe(availBefore + 1)
    expect(rm.getRoom(room.slug)).toBeNull()
  })
})
