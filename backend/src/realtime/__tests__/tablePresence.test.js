import { describe, it, expect, beforeEach } from 'vitest'
import {
  addWatcher,
  removeWatcher,
  removeWatcherFromAllTables,
  removeAllWatchersForTable,
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

  it('counts unique people, not sockets — same user across tabs is one watcher', () => {
    addWatcher('tbl_1', 'sock_a', { userId: 'user_a' })
    addWatcher('tbl_1', 'sock_b', { userId: 'user_b' })
    addWatcher('tbl_1', 'sock_c', { userId: 'user_a' }) // same user, different tab
    const p = getPresence('tbl_1')
    expect(p.count).toBe(2)  // user_a (2 tabs) + user_b = 2 people
    expect(p.userIds.sort()).toEqual(['user_a', 'user_b'])
  })

  it('guest watchers (userId=null) count per-socket so each tab is its own person', () => {
    addWatcher('tbl_1', 'sock_a', { userId: null })
    addWatcher('tbl_1', 'sock_b', { userId: null })
    addWatcher('tbl_1', 'sock_c', { userId: 'user_a' })
    const p = getPresence('tbl_1')
    expect(p.count).toBe(3)   // 2 distinct guests + 1 signed-in
    expect(p.userIds).toEqual(['user_a'])
  })

  it('refresh race (same user, old + new socket briefly) shows count 1, not 2', () => {
    // Polling transport: old socket stays in the map until ~45s ping timeout.
    // New socket registers immediately on refresh. With dedupe the count
    // stays correct during the overlap.
    addWatcher('tbl_1', 'sock_old', { userId: 'user_a' })
    addWatcher('tbl_1', 'sock_new', { userId: 'user_a' })
    expect(getPresence('tbl_1').count).toBe(1)
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

describe('tablePresence — removeAllWatchersForTable (chunk 3 F4/F5)', () => {
  it('drops every watcher on the named table and returns their socketIds', () => {
    addWatcher('tbl_1', 'sock_a', { userId: 'user_a' })
    addWatcher('tbl_1', 'sock_b', { userId: 'user_b' })
    addWatcher('tbl_2', 'sock_c', { userId: 'user_c' })

    const removed = removeAllWatchersForTable('tbl_1')
    expect(removed.sort()).toEqual(['sock_a', 'sock_b'])

    expect(getPresence('tbl_1')).toEqual({ count: 0, userIds: [] })
    expect(getActiveTableIds()).toEqual(['tbl_2'])
    expect(getPresence('tbl_2').count).toBe(1)  // unaffected
  })

  it('returns an empty array when the table has no watchers', () => {
    expect(removeAllWatchersForTable('tbl_unknown')).toEqual([])
  })

  it('returns an empty array when called with no tableId', () => {
    addWatcher('tbl_1', 'sock_a', { userId: 'user_a' })
    expect(removeAllWatchersForTable(null)).toEqual([])
    expect(removeAllWatchersForTable(undefined)).toEqual([])
    expect(getPresence('tbl_1').count).toBe(1)  // unaffected
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
