// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * tournamentMatchService.joinMatchTable — Phase 3 service tests.
 *
 * The service is the single source of truth for first/second-participant
 * match-table acquisition; both the legacy socket handler and the new
 * `/api/v1/rt/tournaments/matches/:id/table` route call it. These tests
 * exercise the branches in isolation with mocks for the DB and the in-
 * memory pending-match registry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/db.js', () => ({
  default: {
    table:   { findFirst: vi.fn(), update: vi.fn() },
    user:    { findUnique: vi.fn() },
    gameElo: { findUnique: vi.fn() },
  },
}))

const { mockGetPending, mockSetSlug, mockCreateTable } = vi.hoisted(() => ({
  mockGetPending:  vi.fn(),
  mockSetSlug:     vi.fn(),
  mockCreateTable: vi.fn(),
}))
vi.mock('../../lib/tournamentBridge.js', () => ({
  getPendingPvpMatch:    mockGetPending,
  setPendingPvpMatchSlug: mockSetSlug,
}))
vi.mock('../../lib/createTableTracked.js', () => ({
  createTableTracked: mockCreateTable,
}))

import db from '../../lib/db.js'
import { joinMatchTable, TournamentMatchError } from '../tournamentMatchService.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('tournamentMatchService.joinMatchTable', () => {
  const me = { id: 'user_1', betterAuthId: 'ba_alice', displayName: 'Alice' }

  it('throws NOT_FOUND when matchId is missing', async () => {
    await expect(joinMatchTable({ user: me, matchId: '' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('throws NOT_PARTICIPANT when user has no betterAuthId', async () => {
    await expect(joinMatchTable({ user: { id: null, betterAuthId: null }, matchId: 'm1' }))
      .rejects.toMatchObject({ code: 'NOT_PARTICIPANT' })
  })

  it('throws NOT_FOUND when the pending match registry has nothing', async () => {
    mockGetPending.mockReturnValueOnce(null)
    await expect(joinMatchTable({ user: me, matchId: 'm1' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('throws NOT_PARTICIPANT when caller is neither participant', async () => {
    mockGetPending.mockReturnValueOnce({
      tournamentId: 't1',
      participant1UserId: 'ba_other_1',
      participant2UserId: 'ba_other_2',
      bestOfN: 3,
      slug: null,
    })
    await expect(joinMatchTable({ user: me, matchId: 'm1' }))
      .rejects.toMatchObject({ code: 'NOT_PARTICIPANT' })
  })

  it('creates the table and returns action=created for the first participant', async () => {
    mockGetPending.mockReturnValueOnce({
      tournamentId: 't1',
      participant1UserId: 'ba_alice',
      participant2UserId: 'ba_bob',
      bestOfN: 3,
      slug: null,
    })
    mockCreateTable.mockResolvedValueOnce({ id: 'tbl_1', slug: 'auto-slug' })

    const res = await joinMatchTable({ user: me, matchId: 'm1' })

    expect(res.action).toBe('created')
    expect(res.mark).toBe('X')
    expect(res.tournamentId).toBe('t1')
    expect(res.bestOfN).toBe(3)
    expect(res.tableId).toBe('tbl_1')

    // createTableTracked got the right shape.
    const { data } = mockCreateTable.mock.calls[0][0]
    expect(data.isTournament).toBe(true)
    expect(data.isPrivate).toBe(true)
    expect(data.tournamentMatchId).toBe('m1')
    expect(data.tournamentId).toBe('t1')
    expect(data.bestOfN).toBe(3)
    expect(data.status).toBe('FORMING')
    expect(data.seats[0]).toMatchObject({ userId: 'ba_alice', status: 'occupied' })
    expect(data.seats[1]).toMatchObject({ userId: null, status: 'empty' })
    expect(data.previewState.marks).toEqual({ ba_alice: 'X' })

    // Slug got memoised on the pending registry so the partner can join.
    expect(mockSetSlug).toHaveBeenCalledWith('m1', expect.any(String))
  })

  it('flips the table to ACTIVE and returns action=joined for the second participant', async () => {
    mockGetPending.mockReturnValueOnce({
      tournamentId: 't1',
      participant1UserId: 'ba_other',
      participant2UserId: 'ba_alice',
      bestOfN: 1,
      slug: 'abc',
    })
    db.table.findFirst.mockResolvedValueOnce({
      id: 'tbl_1',
      slug: 'abc',
      seats: [
        { userId: 'ba_other', status: 'occupied', displayName: 'Other' },
        { userId: null, status: 'empty' },
      ],
      previewState: { marks: { ba_other: 'X' } },
    })
    db.table.update.mockResolvedValueOnce({ id: 'tbl_1', slug: 'abc' })
    db.user.findUnique.mockResolvedValueOnce({ id: 'user_other' })
    db.gameElo.findUnique
      .mockResolvedValueOnce({ rating: 1500 })  // host
      .mockResolvedValueOnce({ rating: 1450 })  // guest

    const res = await joinMatchTable({ user: me, matchId: 'm1' })

    expect(res.action).toBe('joined')
    expect(res.mark).toBe('O')
    expect(res.slug).toBe('abc')
    expect(res.bestOfN).toBe(1)
    expect(res.tableId).toBe('tbl_1')
    expect(res.extras).toEqual({
      hostUserDisplayName:  'Other',
      hostUserElo:          1500,
      guestUserDisplayName: 'Alice',
      guestUserElo:         1450,
    })
    expect(res.previewState.marks).toEqual({ ba_other: 'X', ba_alice: 'O' })

    // The DB update flipped status to ACTIVE.
    const updateArgs = db.table.update.mock.calls[0][0]
    expect(updateArgs.data.status).toBe('ACTIVE')
    expect(updateArgs.data.seats[1]).toMatchObject({ userId: 'ba_alice', status: 'occupied' })
  })

  it('throws NOT_READY when the FORMING table is gone (race / cleanup)', async () => {
    mockGetPending.mockReturnValueOnce({
      tournamentId: 't1',
      participant1UserId: 'ba_other',
      participant2UserId: 'ba_alice',
      bestOfN: 1,
      slug: 'abc',
    })
    db.table.findFirst.mockResolvedValueOnce(null)

    await expect(joinMatchTable({ user: me, matchId: 'm1' }))
      .rejects.toMatchObject({ code: 'NOT_READY' })
  })

  it('handles missing ELO rows by leaving rating null', async () => {
    mockGetPending.mockReturnValueOnce({
      tournamentId: 't1',
      participant1UserId: 'ba_other',
      participant2UserId: 'ba_alice',
      bestOfN: 1,
      slug: 'abc',
    })
    db.table.findFirst.mockResolvedValueOnce({
      id: 'tbl_1',
      slug: 'abc',
      seats: [
        { userId: 'ba_other', status: 'occupied', displayName: 'Other' },
        { userId: null, status: 'empty' },
      ],
      previewState: { marks: { ba_other: 'X' } },
    })
    db.table.update.mockResolvedValueOnce({ id: 'tbl_1', slug: 'abc' })
    db.user.findUnique.mockResolvedValueOnce({ id: 'user_other' })
    db.gameElo.findUnique.mockResolvedValue(null)

    const res = await joinMatchTable({ user: me, matchId: 'm1' })
    expect(res.extras.hostUserElo).toBeNull()
    expect(res.extras.guestUserElo).toBeNull()
  })
})
