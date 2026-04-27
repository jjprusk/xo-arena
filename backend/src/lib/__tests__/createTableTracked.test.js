// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => ({
  default: { table: { create: vi.fn() } },
}))

const { createTableTracked } = await import('../createTableTracked.js')
const db = (await import('../db.js')).default
const { getTableCreateErrors } = await import('../resourceCounters.js')

beforeEach(() => {
  vi.clearAllMocks()
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
})
