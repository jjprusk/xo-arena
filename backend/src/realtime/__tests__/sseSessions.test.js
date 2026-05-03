import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  register,
  dispose,
  get,
  forUser,
  joinTable,
  leaveTable,
  tablesFor,
  joinPongRoom,
  pongRoomsFor,
  totalSessions,
  touch,
  _resetForTests,
  _DISPOSE_DEBOUNCE_MS,
} from '../sseSessions.js'

beforeEach(() => {
  _resetForTests()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('sseSessions — register/get', () => {
  it('registers a session and looks it up', () => {
    register('s1', { userId: 'u1' })
    expect(totalSessions()).toBe(1)
    const entry = get('s1')
    expect(entry).toBeTruthy()
    expect(entry.userId).toBe('u1')
    expect(entry.joinedTables).toBeInstanceOf(Set)
  })

  it('forUser returns all sessions for a given user', () => {
    register('s1', { userId: 'u1' })
    register('s2', { userId: 'u1' })
    register('s3', { userId: 'u2' })
    const u1 = forUser('u1')
    expect(u1).toHaveLength(2)
    expect(u1.map(e => e.sessionId).sort()).toEqual(['s1', 's2'])
  })
})

describe('sseSessions — dispose debounce', () => {
  it('does not fire onDispose immediately for a userful session', () => {
    const cb = vi.fn()
    register('s1', { userId: 'u1', onDispose: cb })
    dispose('s1')
    expect(cb).not.toHaveBeenCalled()
    // Session entry is still around inside the grace window so the table
    // membership lookup still works for any in-flight POSTs.
    expect(get('s1')).toBeTruthy()
  })

  it('fires onDispose after the debounce window elapses', () => {
    const cb = vi.fn()
    register('s1', { userId: 'u1', onDispose: cb })
    dispose('s1')
    vi.advanceTimersByTime(_DISPOSE_DEBOUNCE_MS + 50)
    expect(cb).toHaveBeenCalledOnce()
    expect(cb).toHaveBeenCalledWith('u1', 's1', {
      joinedTables:    [],
      joinedPongRooms: [],
    })
    expect(get('s1')).toBeNull()
  })

  it('cancels pending dispose if a new session for the same user arrives', () => {
    const cb = vi.fn()
    register('s1', { userId: 'u1', onDispose: cb })
    dispose('s1')
    // Fresh tab opens before the debounce expires — the disposal should be
    // cancelled because the user is back.
    register('s2', { userId: 'u1' })
    vi.advanceTimersByTime(_DISPOSE_DEBOUNCE_MS + 50)
    expect(cb).not.toHaveBeenCalled()
  })

  it('immediate=true bypasses the debounce', () => {
    const cb = vi.fn()
    register('s1', { userId: 'u1', onDispose: cb })
    dispose('s1', { immediate: true })
    expect(cb).toHaveBeenCalledOnce()
    expect(get('s1')).toBeNull()
  })

  it('anonymous sessions (no userId) dispose immediately', () => {
    const cb = vi.fn()
    register('s_anon', { userId: null, onDispose: cb })
    dispose('s_anon')
    // No user → no debounce — anonymous play has no reason to keep the
    // session alive across reconnects.
    expect(cb).toHaveBeenCalledOnce()
    expect(get('s_anon')).toBeNull()
  })
})

describe('sseSessions — table membership', () => {
  it('joinTable adds and tablesFor returns the set', () => {
    register('s1', { userId: 'u1' })
    joinTable('s1', 'tbl_a')
    joinTable('s1', 'tbl_b')
    expect(tablesFor('s1').sort()).toEqual(['tbl_a', 'tbl_b'])
  })

  it('leaveTable removes membership', () => {
    register('s1', { userId: 'u1' })
    joinTable('s1', 'tbl_a')
    leaveTable('s1', 'tbl_a')
    expect(tablesFor('s1')).toEqual([])
  })

  it('returns false when joining/leaving an unknown session', () => {
    expect(joinTable('ghost', 'tbl_a')).toBe(false)
    expect(leaveTable('ghost', 'tbl_a')).toBe(false)
  })

  it('pong room membership is independent from tables', () => {
    register('s1', { userId: 'u1' })
    joinTable('s1', 'tbl_a')
    joinPongRoom('s1', 'pong_x')
    expect(tablesFor('s1')).toEqual(['tbl_a'])
    expect(pongRoomsFor('s1')).toEqual(['pong_x'])
  })
})

describe('sseSessions — touch', () => {
  it('updates lastSeenAt on touch', () => {
    register('s1', { userId: 'u1' })
    const t0 = get('s1').lastSeenAt
    vi.advanceTimersByTime(1000)
    touch('s1')
    expect(get('s1').lastSeenAt).toBeGreaterThan(t0)
  })
})
