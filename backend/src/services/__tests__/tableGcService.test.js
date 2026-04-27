import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('../../lib/db.js', () => ({
  default: {
    table: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      // Chunk 3 F1: abandonIdleActive switched to per-row update so it can
      // release seats; the bulk updateMany is no longer used on that path.
      update: vi.fn().mockResolvedValue({}),
    },
    game: {
      // Sprint 4: deleteOldSparGames runs in the same Promise.all and needs a
      // resolved value or the whole sweep returns the error fallback.
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}))

vi.mock('../skillService.js', () => ({
  getSystemConfig: vi.fn().mockResolvedValue(120),
}))

vi.mock('../../lib/notificationBus.js', () => ({
  dispatch: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../realtime/botGameRunner.js', () => ({
  botGameRunner: {
    closeGameBySlug:  vi.fn(),
    sweepStaleSpars:  vi.fn(() => []),  // Sprint 4: return slugs[]
  },
}))

// Chunk 2: GC liveness counter — captured for the per-test assertions below.
vi.mock('../../lib/resourceCounters.js', () => ({
  incrementGcFailure: vi.fn(),
  recordGcSuccess:    vi.fn(),
}))

// Chunk 3 F4: GC must drop in-memory pointers at every row it deletes /
// completes. socketHandler is heavyweight (imports nanoid, jose, redis, ai)
// — mock just the export the GC service uses.
vi.mock('../../realtime/socketHandler.js', () => ({
  unregisterTable: vi.fn(),
}))

// Chunk 3 F6: GC sweeps emit `table.released{reason}` events. Mock the
// helper directly so we can assert the per-reason wiring.
vi.mock('../../lib/tableReleased.js', () => ({
  dispatchTableReleased: vi.fn(),
  TABLE_RELEASED_REASONS: {
    DISCONNECT:    'disconnect',
    LEAVE:         'leave',
    GAME_END:      'game-end',
    GC_STALE:      'gc-stale',
    GC_IDLE:       'gc-idle',
    ADMIN:         'admin',
    GUEST_CLEANUP: 'guest-cleanup',
  },
}))

const { sweep } = await import('../tableGcService.js')
const { incrementGcFailure, recordGcSuccess } = await import('../../lib/resourceCounters.js')
const db = (await import('../../lib/db.js')).default
const { getSystemConfig } = await import('../skillService.js')
const { botGameRunner } = await import('../../realtime/botGameRunner.js')
const { dispatch: busDispatch } = await import('../../lib/notificationBus.js')
const { unregisterTable } = await import('../../realtime/socketHandler.js')
const { dispatchTableReleased } = await import('../../lib/tableReleased.js')

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
  db.table.update.mockResolvedValue({})
  db.game.deleteMany.mockResolvedValue({ count: 0 })
  botGameRunner.sweepStaleSpars.mockReturnValue([])
  getSystemConfig.mockResolvedValue(120)
})

// ── Tests ────────────────────────────────────────────────────────────

describe('tableGcService sweep', () => {
  it('deletes stale FORMING tables older than 30 min with all empty seats', async () => {
    // findMany is called for FORMING candidates, ACTIVE idle, AND demo sweep
    // (Promise.all parallel) — so route by where clause, not call order.
    db.table.findMany.mockImplementation(async ({ where }) => {
      if (where?.status === 'FORMING') {
        return [
          { id: 'tbl_empty_1',  gameId: 'xo', seats: [{ status: 'empty' }, { status: 'empty' }] },
          { id: 'tbl_occupied', gameId: 'xo', seats: [{ userId: 'u1', status: 'occupied' }, { status: 'empty' }] },
        ]
      }
      return []  // ACTIVE idle + demo sweep — empty
    })
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

    // Chunk 3 F4: in-memory pointers for the deleted row are dropped.
    expect(unregisterTable).toHaveBeenCalledWith('tbl_empty_1')
    expect(unregisterTable).not.toHaveBeenCalledWith('tbl_occupied')

    // Chunk 3 F6: gc-stale released event fires for the deleted row.
    expect(dispatchTableReleased).toHaveBeenCalledWith(
      'tbl_empty_1', 'gc-stale', expect.any(Object),
    )
  })

  it('deletes old COMPLETED tables older than 24 hr and drops in-memory state', async () => {
    db.table.findMany.mockImplementation(async ({ where }) => {
      if (where?.status === 'COMPLETED') {
        return [{ id: 'old_1' }, { id: 'old_2' }]
      }
      return []
    })
    db.table.deleteMany.mockResolvedValue({ count: 2 })

    const io = makeIO()
    await sweep(io)

    // COMPLETED findMany (chunk 3 F4: switched from bulk deleteMany to
    // findMany→delete so we can iterate ids for unregisterTable)
    const completedFind = db.table.findMany.mock.calls.find(c => c[0]?.where?.status === 'COMPLETED')
    expect(completedFind).toBeTruthy()
    expect(completedFind[0].where.updatedAt.lt).toBeInstanceOf(Date)

    const cutoff = completedFind[0].where.updatedAt.lt
    const twentyFourHrAgo = Date.now() - 24 * 60 * 60 * 1000
    expect(Math.abs(cutoff.getTime() - twentyFourHrAgo)).toBeLessThan(5000)

    // Subsequent deleteMany targets the resolved ids.
    const completedDelete = db.table.deleteMany.mock.calls.find(c => c[0]?.where?.id?.in)
    expect(completedDelete[0].where.id.in).toEqual(['old_1', 'old_2'])

    // Chunk 3 F4: in-memory pointers for each row are dropped.
    expect(unregisterTable).toHaveBeenCalledWith('old_1')
    expect(unregisterTable).toHaveBeenCalledWith('old_2')

    // Chunk 3 F6: gc-stale released event fires for each row.
    expect(dispatchTableReleased).toHaveBeenCalledWith('old_1', 'gc-stale', expect.any(Object))
    expect(dispatchTableReleased).toHaveBeenCalledWith('old_2', 'gc-stale', expect.any(Object))
  })

  it('marks idle ACTIVE tables as COMPLETED, releases occupied seats, and emits room:abandoned', async () => {
    const idleTables = [
      { id: 'tbl_1', gameId: 'game_1', seats: [
        { userId: 'u_a', status: 'occupied', displayName: 'Alice' },
        { userId: 'u_b', status: 'occupied', displayName: 'Bob' },
      ]},
      { id: 'tbl_2', gameId: 'game_2', seats: [
        { userId: 'u_c', status: 'occupied', displayName: 'Carol' },
        { userId: null, status: 'empty' },
      ]},
    ]
    // findMany is called concurrently for FORMING, ACTIVE-idle, and demo
    // sweep — route by where clause, not call order.
    db.table.findMany.mockImplementation(async ({ where }) => {
      if (where?.status === 'ACTIVE') return idleTables
      return []
    })
    db.table.update.mockResolvedValue({})

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

    // Per-row update with seats released — chunk 3 F1
    const updateCalls = db.table.update.mock.calls.map(c => c[0])
    const tbl1Update = updateCalls.find(c => c?.where?.id === 'tbl_1')
    const tbl2Update = updateCalls.find(c => c?.where?.id === 'tbl_2')
    expect(tbl1Update?.data.status).toBe('COMPLETED')
    expect(tbl1Update?.data.seats).toEqual([
      { userId: null, status: 'empty', displayName: null },
      { userId: null, status: 'empty', displayName: null },
    ])
    expect(tbl2Update?.data.status).toBe('COMPLETED')
    expect(tbl2Update?.data.seats[0]).toEqual({ userId: null, status: 'empty', displayName: null })
    expect(tbl2Update?.data.seats[1]).toEqual({ userId: null, status: 'empty' })  // already empty, untouched

    // Should emit room:abandoned for each table
    expect(io.to).toHaveBeenCalledWith('table:tbl_1')
    expect(io.to).toHaveBeenCalledWith('table:tbl_2')

    // Chunk 3 F4: in-memory pointers are dropped after the abandon emit.
    expect(unregisterTable).toHaveBeenCalledWith('tbl_1')
    expect(unregisterTable).toHaveBeenCalledWith('tbl_2')

    // Chunk 3 F6: gc-idle released event fires per table (note: distinct
    // reason from gc-stale so the per-reason histogram can show idle vs
    // stale separately).
    expect(dispatchTableReleased).toHaveBeenCalledWith('tbl_1', 'gc-idle', expect.any(Object))
    expect(dispatchTableReleased).toHaveBeenCalledWith('tbl_2', 'gc-idle', expect.any(Object))
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
    // Chunk 3 F4: deleteOldCompleted now does findMany first, so rejecting
    // findMany is the right way to surface a DB-down failure to the sweep
    // wrapper. deleteMany default-mock kept so the other branches stay quiet.
    db.table.findMany.mockRejectedValue(new Error('DB down'))

    const io = makeIO()
    // Should not throw — returns error summary instead
    const result = await sweep(io)
    expect(result.error).toBe('DB down')
    expect(result.deletedForming).toBe(0)
    expect(result.deletedCompleted).toBe(0)
    expect(result.abandonedActive).toBe(0)
  })

  // ── Demo Table macro (§5.1) ──────────────────────────────────────────

  describe('demo sweep', () => {
    it('deletes COMPLETED demo tables 2+ min past completion', async () => {
      const demos = [
        { id: 'demo_1', gameId: 'xo', slug: 'mt-everest', status: 'COMPLETED' },
        { id: 'demo_2', gameId: 'xo', slug: 'mt-k2',      status: 'COMPLETED' },
      ]
      db.table.findMany.mockImplementation(async ({ where }) => {
        if (where?.isDemo === true) return demos
        return []
      })
      db.table.deleteMany.mockImplementation(async ({ where }) => {
        if (where?.id?.in && where.id.in.includes('demo_1')) return { count: 2 }
        return { count: 0 }
      })

      const io = makeIO()
      const res = await sweep(io)

      expect(res.deletedDemos).toBe(2)
      // Demo findMany must include the post-complete + TTL OR clause.
      const demoFind = db.table.findMany.mock.calls.find(c => c[0]?.where?.isDemo === true)
      expect(demoFind).toBeTruthy()
      const orClause = demoFind[0].where.OR
      expect(orClause).toEqual(expect.arrayContaining([
        expect.objectContaining({ status: 'COMPLETED' }),
      ]))

      // Force-closed each runner game by slug, then deleted, then broadcast.
      expect(botGameRunner.closeGameBySlug).toHaveBeenCalledWith('mt-everest')
      expect(botGameRunner.closeGameBySlug).toHaveBeenCalledWith('mt-k2')
      expect(busDispatch).toHaveBeenCalledWith(expect.objectContaining({
        type:    'table.deleted',
        payload: expect.objectContaining({ tableId: 'demo_1' }),
      }))

      // Chunk 3 F4: in-memory pointers for each demo row are dropped.
      expect(unregisterTable).toHaveBeenCalledWith('demo_1')
      expect(unregisterTable).toHaveBeenCalledWith('demo_2')

      // Chunk 3 F6: gc-stale released event fires for each demo row.
      expect(dispatchTableReleased).toHaveBeenCalledWith('demo_1', 'gc-stale', expect.any(Object))
      expect(dispatchTableReleased).toHaveBeenCalledWith('demo_2', 'gc-stale', expect.any(Object))
    })

    it('uses the correct cutoff windows: 2-min post-complete and the configured TTL (minutes)', async () => {
      db.table.findMany.mockResolvedValue([])
      // Sprint 6: demo TTL is now SystemConfig'd via guide.demo.ttlMinutes.
      // Override the default-120 mock for this specific key so we exercise
      // the read path with a known value.
      getSystemConfig.mockImplementation(async (key, fallback) =>
        key === 'guide.demo.ttlMinutes' ? 60 : 120
      )

      const io = makeIO()
      await sweep(io)

      const demoFind = db.table.findMany.mock.calls.find(c => c[0]?.where?.isDemo === true)
      expect(demoFind).toBeTruthy()
      const [completedCond, ttlCond] = demoFind[0].where.OR
      const completeCutoff = completedCond.updatedAt.lt
      const ttlCutoff      = ttlCond.createdAt.lt
      // 2 min ago and 60 min ago, ±5s tolerance
      expect(Math.abs(completeCutoff.getTime() - (Date.now() - 2 * 60 * 1000))).toBeLessThan(5000)
      expect(Math.abs(ttlCutoff.getTime()      - (Date.now() - 60 * 60 * 1000))).toBeLessThan(5000)
    })

    it('does nothing when no demo tables match the cutoffs', async () => {
      db.table.findMany.mockResolvedValue([])
      const io = makeIO()
      const res = await sweep(io)
      expect(res.deletedDemos).toBe(0)
      expect(botGameRunner.closeGameBySlug).not.toHaveBeenCalled()
    })
  })

  // Sprint 4 — Spar GC (§5.2)
  describe('spar GC', () => {
    it('forwards stale-spar count from the runner sweep', async () => {
      botGameRunner.sweepStaleSpars.mockReturnValue(['mt-stuck-1', 'mt-stuck-2'])
      const res = await sweep(makeIO())
      expect(botGameRunner.sweepStaleSpars).toHaveBeenCalledWith(2 * 60 * 60 * 1000)
      expect(res.killedSpars).toBe(2)
    })

    it('deletes spar Game rows older than 30 days', async () => {
      db.game.deleteMany.mockResolvedValue({ count: 7 })
      const res = await sweep(makeIO())
      expect(db.game.deleteMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          isSpar:  true,
          endedAt: { lt: expect.any(Date) },
        }),
      }))
      const cutoff = db.game.deleteMany.mock.calls[0][0].where.endedAt.lt
      // 30 days ago, ±5s tolerance
      expect(Math.abs(cutoff.getTime() - (Date.now() - 30 * 24 * 60 * 60 * 1000))).toBeLessThan(5000)
      expect(res.deletedOldSpars).toBe(7)
    })

    it('returns 0 for both when nothing matches', async () => {
      const res = await sweep(makeIO())
      expect(res.killedSpars).toBe(0)
      expect(res.deletedOldSpars).toBe(0)
    })
  })

  describe('liveness instrumentation (chunk 2)', () => {
    it('records a successful sweep on the happy path', async () => {
      await sweep(makeIO())
      expect(recordGcSuccess).toHaveBeenCalledTimes(1)
      expect(incrementGcFailure).not.toHaveBeenCalled()
    })

    it('increments the failure counter and skips the success record when a sub-task throws', async () => {
      // Force one of the parallel queries to fail.
      db.table.findMany.mockRejectedValueOnce(new Error('boom'))
      const res = await sweep(makeIO())
      expect(res.error).toBe('boom')
      expect(incrementGcFailure).toHaveBeenCalledTimes(1)
      expect(recordGcSuccess).not.toHaveBeenCalled()
    })
  })
})
