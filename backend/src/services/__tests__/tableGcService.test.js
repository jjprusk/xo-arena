import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('../../lib/db.js', () => ({
  default: {
    table: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}))

vi.mock('../skillService.js', () => ({
  getSystemConfig: vi.fn().mockResolvedValue(120),
}))

vi.mock('../../lib/notificationBus.js', () => ({
  dispatch: vi.fn().mockResolvedValue(undefined),
}))

const { sweep } = await import('../tableGcService.js')
const db = (await import('../../lib/db.js')).default
const { getSystemConfig } = await import('../skillService.js')

// Fake socket.io server
function makeIO() {
  const emitted = []
  const emitFn = vi.fn((event, payload) => emitted.push({ event, payload }))
  return {
    to: vi.fn(() => ({ emit: emitFn })),
    emit: emitFn,
    _emitted: emitted,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.table.deleteMany.mockResolvedValue({ count: 0 })
  db.table.findMany.mockResolvedValue([])
  db.table.updateMany.mockResolvedValue({ count: 0 })
  getSystemConfig.mockResolvedValue(120)
})

// ── Tests ────────────────────────────────────────────────────────────

describe('tableGcService sweep', () => {
  it('deletes stale FORMING tables older than 30 min with all empty seats', async () => {
    // findMany is called for FORMING candidates then ACTIVE idle (order varies)
    db.table.findMany
      .mockResolvedValueOnce([
        { id: 'tbl_empty_1', gameId: 'xo', seats: [{ status: 'empty' }, { status: 'empty' }] },
        { id: 'tbl_occupied', gameId: 'xo', seats: [{ userId: 'u1', status: 'occupied' }, { status: 'empty' }] },
      ])
      .mockResolvedValueOnce([]) // ACTIVE idle (none)
    db.table.deleteMany.mockResolvedValue({ count: 1 })

    const io = makeIO()
    await sweep(io)

    // findMany for FORMING candidates
    const formingFind = db.table.findMany.mock.calls.find(c => c[0]?.where?.status === 'FORMING')
    expect(formingFind).toBeTruthy()
    expect(formingFind[0].where.tournamentId).toBeNull()

    // deleteMany should include only the empty-seats table (not the occupied one)
    const formingDelete = db.table.deleteMany.mock.calls.find(c => c[0]?.where?.id?.in)
    expect(formingDelete).toBeTruthy()
    expect(formingDelete[0].where.id.in).toEqual(['tbl_empty_1'])
  })

  it('deletes old COMPLETED tables older than 24 hr', async () => {
    // FORMING findMany returns empty (no stale forming)
    db.table.findMany.mockResolvedValueOnce([])
    // COMPLETED deleteMany
    db.table.deleteMany.mockResolvedValueOnce({ count: 5 })

    const io = makeIO()
    await sweep(io)

    // The COMPLETED deleteMany should have status + updatedAt filter
    const completedCall = db.table.deleteMany.mock.calls[0]?.[0]
    expect(completedCall.where.status).toBe('COMPLETED')
    expect(completedCall.where.updatedAt.lt).toBeInstanceOf(Date)

    const cutoff = completedCall.where.updatedAt.lt
    const twentyFourHrAgo = Date.now() - 24 * 60 * 60 * 1000
    expect(Math.abs(cutoff.getTime() - twentyFourHrAgo)).toBeLessThan(5000)
  })

  it('marks idle ACTIVE tables as COMPLETED and emits room:abandoned', async () => {
    const idleTables = [
      { id: 'tbl_1', gameId: 'game_1' },
      { id: 'tbl_2', gameId: 'game_2' },
    ]
    // findMany is called twice: once for FORMING candidates, once for ACTIVE idle.
    // Return empty for FORMING, idle tables for ACTIVE.
    db.table.findMany
      .mockResolvedValueOnce([])          // FORMING candidates (empty)
      .mockResolvedValueOnce(idleTables)  // ACTIVE idle
    db.table.updateMany.mockResolvedValue({ count: 2 })

    getSystemConfig
      .mockResolvedValueOnce(120)  // game.idleWarnSeconds
      .mockResolvedValueOnce(60)   // game.idleGraceSeconds

    const io = makeIO()
    await sweep(io)

    // Find the ACTIVE findMany call by checking .where.status
    const activeFindCall = db.table.findMany.mock.calls.find(c => c[0]?.where?.status === 'ACTIVE')
    expect(activeFindCall).toBeTruthy()
    expect(activeFindCall[0].where.updatedAt.lt).toBeInstanceOf(Date)

    const cutoff = activeFindCall[0].where.updatedAt.lt
    const idleCutoff = Date.now() - 180 * 1000
    expect(Math.abs(cutoff.getTime() - idleCutoff)).toBeLessThan(5000)

    // Should bulk-update to COMPLETED
    expect(db.table.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['tbl_1', 'tbl_2'] } },
        data: { status: 'COMPLETED' },
      })
    )

    // Should emit room:abandoned for each table
    expect(io.to).toHaveBeenCalledWith('table:tbl_1')
    expect(io.to).toHaveBeenCalledWith('table:tbl_2')
  })

  it('does not touch fresh tables', async () => {
    db.table.deleteMany.mockResolvedValue({ count: 0 })
    db.table.findMany.mockResolvedValue([])

    const io = makeIO()
    await sweep(io)

    // No updateMany should have been called (no idle tables found)
    expect(db.table.updateMany).not.toHaveBeenCalled()
  })

  it('skips tournament tables in FORMING sweep', async () => {
    db.table.findMany.mockResolvedValueOnce([]) // no stale forming candidates

    const io = makeIO()
    await sweep(io)

    // The findMany for FORMING should filter out tournament tables
    const findCall = db.table.findMany.mock.calls[0][0]
    expect(findCall.where.tournamentId).toBeNull()
  })

  it('reads idle thresholds from SystemConfig', async () => {
    getSystemConfig
      .mockResolvedValueOnce(200)  // custom warnSeconds
      .mockResolvedValueOnce(100)  // custom graceSeconds

    db.table.findMany.mockResolvedValue([])

    const io = makeIO()
    await sweep(io)

    // Should have fetched both config keys
    expect(getSystemConfig).toHaveBeenCalledWith('game.idleWarnSeconds', 120)
    expect(getSystemConfig).toHaveBeenCalledWith('game.idleGraceSeconds', 60)

    // Find the ACTIVE findMany call and check cutoff reflects 200+100=300s
    const activeFindCall = db.table.findMany.mock.calls.find(c => c[0]?.where?.status === 'ACTIVE')
    expect(activeFindCall).toBeTruthy()
    const cutoff = activeFindCall[0].where.updatedAt.lt
    const expectedCutoff = Date.now() - 300 * 1000
    expect(Math.abs(cutoff.getTime() - expectedCutoff)).toBeLessThan(5000)
  })

  it('handles sweep errors gracefully', async () => {
    db.table.deleteMany.mockRejectedValue(new Error('DB down'))

    const io = makeIO()
    // Should not throw
    await expect(sweep(io)).resolves.toBeUndefined()
  })
})
