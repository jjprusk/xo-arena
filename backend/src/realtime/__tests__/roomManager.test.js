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

describe('RoomManager — resetIdleTimer (player)', () => {
  let rm, slug

  beforeEach(() => {
    rm = makeManager()
    const room = rm.createRoom({ hostSocketId: 'host1' })
    slug = room.slug
    rm.joinRoom({ slug, guestSocketId: 'guest1' })
  })

  afterEach(() => {
    vi.clearAllTimers()
  })

  it('calls onWarn after warnMs', () => {
    const onWarn = vi.fn()
    rm.resetIdleTimer({ socketId: 'host1', warnMs: 1000, graceMs: 500, onWarn })
    vi.advanceTimersByTime(999)
    expect(onWarn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onWarn).toHaveBeenCalledWith({ socketId: 'host1', graceMs: 500 })
  })

  it('calls onAbandon after warnMs + graceMs with correct payload', () => {
    const onAbandon = vi.fn()
    rm.resetIdleTimer({ socketId: 'host1', warnMs: 1000, graceMs: 500, onAbandon })
    vi.advanceTimersByTime(1500)
    expect(onAbandon).toHaveBeenCalledWith(
      expect.objectContaining({ absentSocketId: 'host1' })
    )
  })

  it('closes the room when onAbandon fires for a player', () => {
    rm.resetIdleTimer({ socketId: 'host1', warnMs: 100, graceMs: 100, onAbandon: vi.fn() })
    vi.advanceTimersByTime(200)
    expect(rm.getRoom(slug)).toBeNull()
  })

  it('allSocketIds snapshot includes both players and spectators', () => {
    rm.joinAsSpectator({ slug, socketId: 'spec1' })
    const onAbandon = vi.fn()
    rm.resetIdleTimer({ socketId: 'host1', warnMs: 100, graceMs: 100, onAbandon })
    vi.advanceTimersByTime(200)
    const { allSocketIds } = onAbandon.mock.calls[0][0]
    expect(allSocketIds).toContain('host1')
    expect(allSocketIds).toContain('guest1')
    expect(allSocketIds).toContain('spec1')
  })

  it('resetting the timer before warn cancels the original and restarts', () => {
    const onWarn = vi.fn()
    rm.resetIdleTimer({ socketId: 'host1', warnMs: 1000, graceMs: 500, onWarn })
    vi.advanceTimersByTime(800)
    // Reset with a fresh 1000ms warn window
    rm.resetIdleTimer({ socketId: 'host1', warnMs: 1000, graceMs: 500, onWarn })
    vi.advanceTimersByTime(400) // only 400ms into the NEW timer — should not fire
    expect(onWarn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(600) // now 1000ms into the new timer
    expect(onWarn).toHaveBeenCalledTimes(1)
  })

  it('resetting the timer during the grace period cancels the grace', () => {
    const onAbandon = vi.fn()
    const onWarn    = vi.fn()
    rm.resetIdleTimer({ socketId: 'host1', warnMs: 100, graceMs: 1000, onWarn, onAbandon })
    vi.advanceTimersByTime(200) // warn fires
    expect(onWarn).toHaveBeenCalledTimes(1)
    // Reset during grace — this cancels the grace timer
    rm.resetIdleTimer({ socketId: 'host1', warnMs: 5000, graceMs: 1000, onWarn, onAbandon })
    vi.advanceTimersByTime(1200) // would have triggered grace on old timer
    expect(onAbandon).not.toHaveBeenCalled()
  })

  it('does nothing if room does not exist', () => {
    const onAbandon = vi.fn()
    rm.resetIdleTimer({ socketId: 'unknown-socket', warnMs: 100, graceMs: 100, onAbandon })
    vi.advanceTimersByTime(300)
    expect(onAbandon).not.toHaveBeenCalled()
  })

  it('does nothing for a room in waiting status', () => {
    const waitRm = makeManager()
    const waitRoom = waitRm.createRoom({ hostSocketId: 'waiting-host' })
    const onWarn = vi.fn()
    waitRm.resetIdleTimer({ socketId: 'waiting-host', warnMs: 100, graceMs: 100, onWarn })
    vi.advanceTimersByTime(300)
    expect(onWarn).not.toHaveBeenCalled()
  })
})

describe('RoomManager — resetIdleTimer (spectator)', () => {
  let rm, slug

  beforeEach(() => {
    rm = makeManager()
    const room = rm.createRoom({ hostSocketId: 'host1' })
    slug = room.slug
    rm.joinRoom({ slug, guestSocketId: 'guest1' })
    rm.joinAsSpectator({ slug, socketId: 'spec1' })
  })

  afterEach(() => {
    vi.clearAllTimers()
  })

  it('calls onKick (not onAbandon) for a spectator after warn + grace', () => {
    const onAbandon = vi.fn()
    const onKick    = vi.fn()
    rm.resetIdleTimer({ socketId: 'spec1', warnMs: 100, graceMs: 100, onAbandon, onKick })
    vi.advanceTimersByTime(200)
    expect(onKick).toHaveBeenCalledWith({ socketId: 'spec1' })
    expect(onAbandon).not.toHaveBeenCalled()
  })

  it('removes spectator from the room without closing it', () => {
    rm.resetIdleTimer({ socketId: 'spec1', warnMs: 100, graceMs: 100, onKick: vi.fn() })
    vi.advanceTimersByTime(200)
    const room = rm.getRoom(slug)
    expect(room).not.toBeNull()
    expect(room.spectatorIds.has('spec1')).toBe(false)
  })
})

describe('RoomManager — closeRoom clears idle timers', () => {
  it('does not fire onAbandon after closeRoom is called', () => {
    const rm = makeManager()
    const room = rm.createRoom({ hostSocketId: 'host1' })
    rm.joinRoom({ slug: room.slug, guestSocketId: 'guest1' })
    const onAbandon = vi.fn()
    rm.resetIdleTimer({ socketId: 'host1', warnMs: 100, graceMs: 100, onAbandon })
    rm.closeRoom(room.slug)
    vi.advanceTimersByTime(300)
    expect(onAbandon).not.toHaveBeenCalled()
  })
})
