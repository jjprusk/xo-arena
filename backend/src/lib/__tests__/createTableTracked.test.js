// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => ({
  default: { table: { create: vi.fn() } },
}))

// Phase 7a: createTableTracked now stamps `gameflowVia` from SystemConfig if
// the caller didn't pass one. Tests pin this to 'socketio' by default so the
// existing assertions don't have to thread the new field through.
const { getSystemConfig } = vi.hoisted(() => ({
  getSystemConfig: vi.fn(async (_k, dflt) => dflt),
}))
vi.mock('../../services/skillService.js', () => ({ getSystemConfig }))

const { createTableTracked } = await import('../createTableTracked.js')
const db = (await import('../db.js')).default
const { getTableCreateErrors } = await import('../resourceCounters.js')

beforeEach(() => {
  vi.clearAllMocks()
  getSystemConfig.mockImplementation(async (_k, dflt) => dflt)
})

function snap() { return getTableCreateErrors() }

describe('createTableTracked', () => {
  it('returns the created table on success and does not increment counters', async () => {
    db.table.create.mockResolvedValueOnce({ id: 't1', slug: 's1' })
    const before = snap()
    const out = await createTableTracked({ data: { gameId: 'xo' } })
    expect(out).toEqual({ id: 't1', slug: 's1' })
    expect(snap()).toEqual(before)
  })

  it('increments the P2002 bucket and rethrows on a unique-constraint failure', async () => {
    const err = Object.assign(new Error('unique'), { code: 'P2002' })
    db.table.create.mockRejectedValueOnce(err)
    const before = snap().P2002
    await expect(createTableTracked({ data: {} })).rejects.toThrow('unique')
    expect(snap().P2002).toBe(before + 1)
  })

  it('increments the P2003 bucket on FK violation', async () => {
    const err = Object.assign(new Error('fk'), { code: 'P2003' })
    db.table.create.mockRejectedValueOnce(err)
    const before = snap().P2003
    await expect(createTableTracked({ data: {} })).rejects.toThrow('fk')
    expect(snap().P2003).toBe(before + 1)
  })

  it('increments OTHER for unknown error codes', async () => {
    const err = new Error('boom')
    db.table.create.mockRejectedValueOnce(err)
    const before = snap().OTHER
    await expect(createTableTracked({ data: {} })).rejects.toThrow('boom')
    expect(snap().OTHER).toBe(before + 1)
  })

  it('increments OTHER when the error has no code at all', async () => {
    db.table.create.mockRejectedValueOnce(undefined)
    const before = snap().OTHER
    await expect(createTableTracked({ data: {} })).rejects.toBeUndefined()
    expect(snap().OTHER).toBe(before + 1)
  })

  // ── Phase 7a: gameflowVia stamping ──────────────────────────────────────
  describe('gameflowVia stamping (Phase 7a / Risk R7)', () => {
    it('stamps gameflowVia=socketio when SystemConfig has no override', async () => {
      db.table.create.mockResolvedValueOnce({ id: 't1' })
      await createTableTracked({ data: { gameId: 'xo' } })
      expect(db.table.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ gameId: 'xo', gameflowVia: 'socketio' }),
      })
    })

    it('stamps gameflowVia=sse when SystemConfig says realtime.gameflow.via=sse', async () => {
      getSystemConfig.mockImplementation(async (k, dflt) =>
        k === 'realtime.gameflow.via' ? 'sse' : dflt,
      )
      db.table.create.mockResolvedValueOnce({ id: 't1' })
      await createTableTracked({ data: { gameId: 'xo' } })
      expect(db.table.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ gameflowVia: 'sse' }),
      })
    })

    it('preserves an explicitly-passed gameflowVia and skips the SystemConfig read', async () => {
      db.table.create.mockResolvedValueOnce({ id: 't1' })
      await createTableTracked({ data: { gameId: 'xo', gameflowVia: 'sse' } })
      expect(db.table.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ gameflowVia: 'sse' }),
      })
      expect(getSystemConfig).not.toHaveBeenCalled()
    })

    it('falls back to socketio if SystemConfig read throws', async () => {
      getSystemConfig.mockRejectedValueOnce(new Error('redis down'))
      db.table.create.mockResolvedValueOnce({ id: 't1' })
      await createTableTracked({ data: { gameId: 'xo' } })
      expect(db.table.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ gameflowVia: 'socketio' }),
      })
    })

    it('coerces unexpected SystemConfig values to socketio (defensive)', async () => {
      getSystemConfig.mockImplementation(async () => 'webtransport')
      db.table.create.mockResolvedValueOnce({ id: 't1' })
      await createTableTracked({ data: { gameId: 'xo' } })
      expect(db.table.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ gameflowVia: 'socketio' }),
      })
    })
  })
})
