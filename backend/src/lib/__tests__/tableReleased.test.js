// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Chunk 3 F6 — dispatchTableReleased contract:
 *  - increments the per-reason counter (resourceCounters)
 *  - dispatches `table.released` on the broadcast bus with {tableId, reason}
 *  - swallows bus dispatch errors (call sites are completion paths that must
 *    not fail because the metrics pipeline is misbehaving)
 *  - is a no-op when called with falsy tableId or reason
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../notificationBus.js', () => ({
  dispatch: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../resourceCounters.js', () => ({
  incrementTableReleased: vi.fn(),
}))

const { dispatchTableReleased, TABLE_RELEASED_REASONS } = await import('../tableReleased.js')
const { dispatch } = await import('../notificationBus.js')
const { incrementTableReleased } = await import('../resourceCounters.js')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('dispatchTableReleased', () => {
  it('increments the per-reason counter and dispatches a broadcast event', () => {
    dispatchTableReleased('tbl_1', 'disconnect', { trigger: 'disconnect-forming' })
    expect(incrementTableReleased).toHaveBeenCalledWith('disconnect')
    expect(dispatch).toHaveBeenCalledWith({
      type:    'table.released',
      targets: { broadcast: true },
      payload: { tableId: 'tbl_1', reason: 'disconnect', trigger: 'disconnect-forming' },
    })
  })

  it('exports the canonical set of reasons used by call sites', () => {
    expect(TABLE_RELEASED_REASONS).toMatchObject({
      DISCONNECT:    'disconnect',
      LEAVE:         'leave',
      GAME_END:      'game-end',
      GC_STALE:      'gc-stale',
      GC_IDLE:       'gc-idle',
      ADMIN:         'admin',
      GUEST_CLEANUP: 'guest-cleanup',
    })
  })

  it('is a no-op when called with falsy tableId or reason', () => {
    dispatchTableReleased(null, 'disconnect')
    dispatchTableReleased('tbl_1', null)
    dispatchTableReleased('', '')
    expect(incrementTableReleased).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('does not throw when the bus dispatch rejects', () => {
    dispatch.mockRejectedValueOnce(new Error('bus down'))
    expect(() => dispatchTableReleased('tbl_1', 'admin')).not.toThrow()
    expect(incrementTableReleased).toHaveBeenCalledWith('admin')
  })
})
