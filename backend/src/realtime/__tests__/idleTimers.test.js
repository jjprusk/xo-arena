// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * idleTimers — server-side per-(userId, tableId) idle warn + forfeit chain.
 *
 * Covers:
 *   - arm() schedules a warn at warnSeconds and a forfeit at warn+grace
 *   - re-arm before warn cancels the prior timer (no double-warn)
 *   - pong before grace expires cancels the forfeit (warn-then-recover)
 *   - cancel() clears both timers
 *   - cancelAllForUser / cancelAllForTable bulk-clear the right subset
 *   - applyForfeit is invoked with reason: 'idle' on grace expiry
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../services/skillService.js', () => ({
  getSystemConfig: vi.fn(),
}))

vi.mock('../../lib/eventStream.js', () => ({
  appendToStream: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../services/disconnectForfeitService.js', () => ({
  applyForfeit:          vi.fn().mockResolvedValue({ ok: true, mark: 'X', oppMark: 'O', scores: { O: 1 } }),
  resolveSeatIdForUser:  vi.fn().mockResolvedValue('ba_user_1'),
}))

// arm() now resolves the BetterAuth id from User.findUnique so the per-user
// channel name matches what the SSE client subscribes to. Stub the lookup so
// the warn path emits on `user:ba_<userId>:idle`.
vi.mock('../../lib/db.js', () => ({
  default: {
    user: {
      findUnique: vi.fn(({ where: { id } }) => Promise.resolve({ betterAuthId: `ba_${id}` })),
    },
  },
}))

const { arm, reset, cancel, cancelAllForUser, cancelAllForTable, _hasTimer, _resetForTests }
  = await import('../idleTimers.js')
const { appendToStream } = await import('../../lib/eventStream.js')
const { applyForfeit, resolveSeatIdForUser } = await import('../../services/disconnectForfeitService.js')
const { getSystemConfig } = await import('../../services/skillService.js')

const userId  = 'usr_1'
const tableId = 'tbl_42'

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  _resetForTests()
  // Tighten timings so tests run in tens of ms instead of minutes.
  getSystemConfig.mockImplementation(async (key, def) => {
    if (key === 'game.idleWarnSeconds')  return 2  // 2s warn
    if (key === 'game.idleGraceSeconds') return 1  // 1s grace
    return def
  })
})

afterEach(() => {
  _resetForTests()
  vi.useRealTimers()
})

describe('arm()', () => {
  it('schedules a warn at warnSeconds and a forfeit at warn+grace', async () => {
    await arm({ userId, tableId, slug: 'tbl-foo' })
    expect(_hasTimer({ userId, tableId })).toBe(true)

    // Halfway to warn — nothing fires.
    await vi.advanceTimersByTimeAsync(1000)
    expect(appendToStream).not.toHaveBeenCalled()
    expect(applyForfeit).not.toHaveBeenCalled()

    // Cross the warn boundary — warn events fire on both channels. The
    // user-channel name uses the BetterAuth id (looked up from User), not
    // the application User.id, so the SSE client's `user:<authSession.user.id>:idle`
    // subscription matches.
    await vi.advanceTimersByTimeAsync(1100)
    const channels = appendToStream.mock.calls.map(c => c[0])
    expect(channels).toContain(`table:${tableId}:state`)
    expect(channels).toContain(`user:ba_${userId}:idle`)
    expect(applyForfeit).not.toHaveBeenCalled()

    // Cross the grace boundary — forfeit fires.
    await vi.advanceTimersByTimeAsync(1100)
    expect(resolveSeatIdForUser).toHaveBeenCalledWith({ userId, sessionId: null, tableId })
    expect(applyForfeit).toHaveBeenCalledWith(expect.objectContaining({
      seatId: 'ba_user_1', tableId, reason: 'idle',
    }))
  })

  it('re-arming before warn fires reschedules the warn (no early warn)', async () => {
    await arm({ userId, tableId })
    await vi.advanceTimersByTimeAsync(1500)
    await arm({ userId, tableId })       // pong arrived — push the warn back
    await vi.advanceTimersByTimeAsync(1500)
    expect(appendToStream).not.toHaveBeenCalled()  // no warn yet — clock reset
    await vi.advanceTimersByTimeAsync(700)
    expect(appendToStream).toHaveBeenCalled()      // 2s after the re-arm
  })

  it('reset() is an alias for arm()', async () => {
    expect(reset).toBe(arm)
  })

  it('no-ops when userId or tableId is falsy', async () => {
    await arm({ userId: null,    tableId })
    await arm({ userId,          tableId: null })
    expect(_hasTimer({ userId, tableId })).toBe(false)
  })
})

describe('warn-then-recover', () => {
  it('a pong after the warn but before grace clears the forfeit', async () => {
    await arm({ userId, tableId })
    await vi.advanceTimersByTimeAsync(2100)            // warn fires
    expect(appendToStream).toHaveBeenCalled()

    appendToStream.mockClear()
    await arm({ userId, tableId })                     // pong arrives mid-grace

    // Advance just under the new warn boundary — the original forfeit
    // window has closed, but the fresh arm hasn't tipped over yet.
    await vi.advanceTimersByTimeAsync(1800)
    expect(applyForfeit).not.toHaveBeenCalled()
    expect(appendToStream).not.toHaveBeenCalled()
  })
})

describe('cancel()', () => {
  it('clears both warn and forfeit timers', async () => {
    await arm({ userId, tableId })
    expect(_hasTimer({ userId, tableId })).toBe(true)

    expect(cancel({ userId, tableId })).toBe(true)
    expect(_hasTimer({ userId, tableId })).toBe(false)

    await vi.advanceTimersByTimeAsync(5000)
    expect(appendToStream).not.toHaveBeenCalled()
    expect(applyForfeit).not.toHaveBeenCalled()
  })

  it('returns false when no timer exists', () => {
    expect(cancel({ userId, tableId })).toBe(false)
  })
})

describe('cancelAllForUser', () => {
  it('clears every timer for the user across all tables', async () => {
    await arm({ userId, tableId: 'tbl_a' })
    await arm({ userId, tableId: 'tbl_b' })
    await arm({ userId: 'usr_other', tableId: 'tbl_a' })

    const cleared = cancelAllForUser(userId)
    expect(cleared).toBe(2)
    expect(_hasTimer({ userId, tableId: 'tbl_a' })).toBe(false)
    expect(_hasTimer({ userId, tableId: 'tbl_b' })).toBe(false)
    expect(_hasTimer({ userId: 'usr_other', tableId: 'tbl_a' })).toBe(true)

    // Stop just past the warn boundary but short of grace — usr_other's
    // warn fires once; nobody's forfeit fires.
    await vi.advanceTimersByTimeAsync(2200)
    expect(applyForfeit).not.toHaveBeenCalled()
    const channels = appendToStream.mock.calls.map(c => c[0])
    expect(channels.filter(c => c.includes(`user:ba_${userId}:`))).toHaveLength(0)
    expect(channels.filter(c => c.includes('user:ba_usr_other:'))).toHaveLength(1)
  })
})

describe('cancelAllForTable', () => {
  it('clears every timer scoped to the table', async () => {
    await arm({ userId: 'usr_a', tableId })
    await arm({ userId: 'usr_b', tableId })
    await arm({ userId: 'usr_a', tableId: 'tbl_other' })

    const cleared = cancelAllForTable(tableId)
    expect(cleared).toBe(2)
    expect(_hasTimer({ userId: 'usr_a', tableId })).toBe(false)
    expect(_hasTimer({ userId: 'usr_b', tableId })).toBe(false)
    expect(_hasTimer({ userId: 'usr_a', tableId: 'tbl_other' })).toBe(true)
  })
})
