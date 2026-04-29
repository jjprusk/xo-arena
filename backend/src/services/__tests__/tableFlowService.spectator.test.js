// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * tableFlowService.joinTable() — spectator branch.
 *
 * Why this exists: the spectator branch used to return only `{ ok, action,
 * table }`, leaving the client's `applyJoinResult` to fall back to the
 * literal `'Host'` / `'Guest'` strings for seat-pod labels (useGameSDK.js
 * lines 320, 325). On the Hook step 2 demo table the bots' actual names
 * (Rusty/Copper/...) never reached the UI. Fix: build `room` (and
 * `startPayload` if the previewState carries a board) so the client paints
 * `seats[i].displayName` straight onto the seat pods.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/db.js', () => ({
  default: {
    table: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    user:  { findUnique: vi.fn() },
    gameElo: { findUnique: vi.fn() },
  },
}))

const db = (await import('../../lib/db.js')).default
const { joinTable } = await import('../tableFlowService.js')

function demoTable(overrides = {}) {
  return {
    id:        'tbl_demo_1',
    slug:     'demo-slug',
    isPrivate: true,
    isDemo:    true,
    createdById: 'ba_user_1',
    status:    'ACTIVE',
    seats: [
      { userId: 'bot_rusty_id',  status: 'occupied', displayName: 'Rusty'  },
      { userId: 'bot_copper_id', status: 'occupied', displayName: 'Copper' },
    ],
    previewState: {
      board:       Array(9).fill(null),
      currentTurn: 'X',
      round:       1,
      scores:      { X: 0, O: 0 },
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Built-in bots have no betterAuthId, so the host-user lookup misses and
  // ELO stays null. Mirror that for both buildExtras() lookups so the seat
  // displayName is the only thing that survives into the room payload.
  db.user.findUnique.mockResolvedValue(null)
  db.gameElo.findUnique.mockResolvedValue(null)
})

describe('joinTable() — spectator', () => {
  it('demo table: returns room with seat displayName preserved (not "Host"/"Guest")', async () => {
    db.table.findFirst.mockResolvedValueOnce(demoTable())

    const result = await joinTable({
      io:     null,
      user:   { id: 'usr_caller' },
      seatId: 'ba_user_1',  // matches createdById → private table allowed
      slug:   'demo-slug',
      role:   'spectator',
    })

    expect(result.ok).toBe(true)
    expect(result.action).toBe('spectated_pvp')
    expect(result.room).toBeTruthy()
    expect(result.room.hostUserDisplayName).toBe('Rusty')
    expect(result.room.guestUserDisplayName).toBe('Copper')
    // Sanity — the literal client-side fallbacks must not appear.
    expect(result.room.hostUserDisplayName).not.toBe('Host')
    expect(result.room.guestUserDisplayName).not.toBe('Guest')
    // Start payload echoes the previewState board so the spectator renders
    // the live position rather than waiting for the next state event.
    expect(result.startPayload).toMatchObject({
      board:       Array(9).fill(null),
      currentTurn: 'X',
      round:       1,
    })
  })

  it('public PvP table: spectator gets seat names from withSeatDisplay-hydrated seats', async () => {
    db.table.findFirst.mockResolvedValueOnce({
      ...demoTable(),
      isPrivate: false,
      isDemo:    false,
      createdById: 'ba_someone_else',
      seats: [
        { userId: 'ba_alice', status: 'occupied', displayName: 'Alice' },
        { userId: 'ba_bob',   status: 'occupied', displayName: 'Bob'   },
      ],
    })

    const result = await joinTable({
      io: null, user: { id: 'usr_spec' },
      seatId: 'ba_spectator', slug: 'pvp-slug', role: 'spectator',
    })

    expect(result.ok).toBe(true)
    expect(result.room.hostUserDisplayName).toBe('Alice')
    expect(result.room.guestUserDisplayName).toBe('Bob')
  })

  it('private non-demo table: still 403s for non-creator spectators', async () => {
    db.table.findFirst.mockResolvedValueOnce({
      ...demoTable(),
      isDemo: false,
      createdById: 'ba_other',
    })

    const result = await joinTable({
      io: null, user: { id: 'usr_spec' },
      seatId: 'ba_uninvited', slug: 'priv', role: 'spectator',
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('PRIVATE_TABLE')
    expect(result.room).toBeUndefined()
  })

  it('omits startPayload when previewState has no board (FORMING tables)', async () => {
    db.table.findFirst.mockResolvedValueOnce({
      ...demoTable(),
      isPrivate: false,
      status: 'FORMING',
      previewState: null,
      seats: [
        { userId: 'ba_alice', status: 'occupied', displayName: 'Alice' },
        { userId: null,        status: 'empty',    displayName: null     },
      ],
    })

    const result = await joinTable({
      io: null, user: { id: 'usr_spec' },
      seatId: 'ba_spec', slug: 'forming', role: 'spectator',
    })

    expect(result.ok).toBe(true)
    expect(result.room.hostUserDisplayName).toBe('Alice')
    expect(result.startPayload).toBeUndefined()
  })
})
