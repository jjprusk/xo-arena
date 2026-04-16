import { describe, it, expect, beforeEach } from 'vitest'
import {
  addWatcher,
  removeWatcher,
  removeWatcherFromAllTables,
  getPresence,
  getActiveTableIds,
  getTotalWatchers,
  _resetForTests,
} from '../tablePresence.js'

beforeEach(() => {
  _resetForTests()
})

describe('tablePresence — addWatcher', () => {
  it('registers a new watcher and returns true', () => {
    expect(addWatcher('tbl_1', 'sock_a', { userId: 'user_a' })).toBe(true)
    expect(getPresence('tbl_1')).toEqual({ count: 1, userIds: ['user_a'] })
  })

  it('is idempotent — re-registering the same socketId returns false and does not double-count', () => {
    addWatcher('tbl_1', 'sock_a', { userId: 'user_a' })
    expect(addWatcher('tbl_1', 'sock_a', { userId: 'user_a' })).toBe(false)
    expect(getPresence('tbl_1').count).toBe(1)
  })

  it('multiple sockets on the same table accumulate', () => {
    addWatcher('tbl_1', 'sock_a', { userId: 'user_a' })
    addWatcher('tbl_1', 'sock_b', { userId: 'user_b' })
    addWatcher('tbl_1', 'sock_c', { userId: 'user_a' }) // same user, different socket
    const p = getPresence('tbl_1')
    expect(p.count).toBe(3)
    expect(p.userIds.sort()).toEqual(['user_a', 'user_b'])  // de-duped
  })

  it('guest watchers (userId=null) count toward the total but contribute no userId', () => {
    addWatcher('tbl_1', 'sock_a', { userId: null })
    addWatcher('tbl_1', 'sock_b', { userId: null })
    addWatcher('tbl_1', 'sock_c', { userId: 'user_a' })
    const p = getPresence('tbl_1')
    expect(p.count).toBe(3)
    expect(p.userIds).toEqual(['user_a'])
  })

  it('returns false on missing tableId / socketId', () => {
    expect(addWatcher(null, 'sock_a', { userId: 'user_a' })).toBe(false)
    expect(addWatcher('tbl_1', null, { userId: 'user_a' })).toBe(false)
  })
})

describe('tablePresence — removeWatcher', () => {
  it('removes a watcher and returns true', () => {
    addWatcher('tbl_1', 'sock_a', { userId: 'user_a' })
    expect(removeWatcher('tbl_1', 'sock_a')).toBe(true)
    expect(getPresence('tbl_1').count).toBe(0)
  })

  it('is a no-op (returns false) when the socket was not watching', () => {
    expect(removeWatcher('tbl_1', 'sock_ghost')).toBe(false)
  })

  it('removes the table entry entirely when the last watcher leaves', () => {
    addWatcher('tbl_1', 'sock_a', { userId: 'user_a' })
    removeWatcher('tbl_1', 'sock_a')
    expect(getActiveTableIds()).toEqual([])
  })

  it('keeps the table entry when other watchers remain', () => {
    addWatcher('tbl_1', 'sock_a', { userId: 'user_a' })
    addWatcher('tbl_1', 'sock_b', { userId: 'user_b' })
    removeWatcher('tbl_1', 'sock_a')
    expect(getActiveTableIds()).toEqual(['tbl_1'])
    expect(getPresence('tbl_1').count).toBe(1)
  })
})

describe('tablePresence — removeWatcherFromAllTables (disconnect cleanup)', () => {
  it('removes a socket from every table it watched and reports the affected tableIds', () => {
    addWatcher('tbl_1', 'sock_a', { userId: 'user_a' })
    addWatcher('tbl_2', 'sock_a', { userId: 'user_a' })
    addWatcher('tbl_3', 'sock_b', { userId: 'user_b' })
    const affected = removeWatcherFromAllTables('sock_a').sort()
    expect(affected).toEqual(['tbl_1', 'tbl_2'])
    expect(getActiveTableIds().sort()).toEqual(['tbl_3'])
  })

  it('returns an empty array when the socket was watching nothing', () => {
    addWatcher('tbl_1', 'sock_a', { userId: 'user_a' })
    expect(removeWatcherFromAllTables('sock_ghost')).toEqual([])
    expect(getPresence('tbl_1').count).toBe(1)  // unaffected
  })
})

describe('tablePresence — getPresence on unknown tables', () => {
  it('returns count 0 and empty userIds', () => {
    expect(getPresence('tbl_unknown')).toEqual({ count: 0, userIds: [] })
  })
})

describe('tablePresence — getTotalWatchers (admin health)', () => {
  it('returns 0 when no one is watching', () => {
    expect(getTotalWatchers()).toBe(0)
  })

  it('sums watcher counts across multiple tables', () => {
    addWatcher('tbl_1', 'sock_a', { userId: 'user_a' })
    addWatcher('tbl_1', 'sock_b', { userId: 'user_b' })
    addWatcher('tbl_2', 'sock_c', { userId: 'user_c' })
    expect(getTotalWatchers()).toBe(3)
  })

  it('counts every socket (tab), not every user', () => {
    addWatcher('tbl_1', 'sock_a', { userId: 'user_a' })
    addWatcher('tbl_1', 'sock_b', { userId: 'user_a' })  // same user, different tab
    expect(getTotalWatchers()).toBe(2)
  })
})
