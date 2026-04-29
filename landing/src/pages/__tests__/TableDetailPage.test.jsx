import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../../lib/api.js', () => ({
  api: {
    tables: {
      get:   vi.fn(),
      join:  vi.fn(),
      leave: vi.fn(),
    },
  },
}))

vi.mock('../../lib/getToken.js', () => ({
  getToken: vi.fn().mockResolvedValue('tok'),
}))

vi.mock('../../lib/useOptimisticSession.js', () => ({
  useOptimisticSession: vi.fn(),
}))

vi.mock('../../lib/socket.js', () => ({
  getSocket:        vi.fn(() => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn() })),
  connectSocket:    vi.fn(() => ({ on: vi.fn(), off: vi.fn(), once: vi.fn(), emit: vi.fn(), connect: vi.fn(), connected: false })),
  disconnectSocket: vi.fn(),
}))

// Capture each useEventStream() subscription so individual tests can drive
// onEvent(channel, payload) directly. The real hook silently no-ops in
// jsdom (no EventSource), so without a stand-in we can't observe how
// TableDetailPage reacts to lifecycle events.
const eventStreamSubs = []
vi.mock('../../lib/useEventStream.js', () => ({
  useEventStream: (opts) => { eventStreamSubs.push(opts) },
}))

// Capture navigate() calls without breaking the rest of react-router-dom
// (we still need MemoryRouter, Routes, Route, useParams to behave normally).
const navigateMock = vi.fn()
vi.mock('react-router-dom', async (importActual) => {
  const actual = await importActual()
  return { ...actual, useNavigate: () => navigateMock }
})

import TableDetailPage from '../TableDetailPage.jsx'
import { api } from '../../lib/api.js'
import { useOptimisticSession } from '../../lib/useOptimisticSession.js'

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/tables/:id" element={<TableDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

const baseTable = {
  id: 'tbl_1',
  gameId: 'xo',
  status: 'FORMING',
  maxPlayers: 2,
  isPrivate: false,
  isTournament: false,
  seats: [
    { userId: null,  status: 'empty' },
    { userId: null,  status: 'empty' },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  eventStreamSubs.length = 0
  navigateMock.mockReset()
  useOptimisticSession.mockReturnValue({ data: { user: { id: 'u1' } }, isPending: false })
})

/** Find the lifecycle subscription and fire a synthetic event into it. */
function fireLifecycle(tableId, payload) {
  const sub = eventStreamSubs.find(s =>
    Array.isArray(s.channels) && s.channels.includes(`table:${tableId}:lifecycle`),
  )
  expect(sub).toBeTruthy()
  sub.onEvent(`table:${tableId}:lifecycle`, payload)
}

describe('TableDetailPage', () => {
  it('renders the table heading and seat list', async () => {
    api.tables.get.mockResolvedValue({ table: baseTable })
    renderAt('/tables/tbl_1')
    await waitFor(() => expect(screen.getByText(/xo \(tic-tac-toe\)/i)).toBeInTheDocument())
    // Empty seats are clickable buttons for a user who can join — two of them
    expect(screen.getAllByRole('button', { name: /take seat \d/i })).toHaveLength(2)
    // Header action button also present
    expect(screen.getByRole('button', { name: /take a seat/i })).toBeInTheDocument()
  })

  it('shows 404 state when the table does not exist', async () => {
    const err = Object.assign(new Error('not found'), { status: 404 })
    api.tables.get.mockRejectedValue(err)
    renderAt('/tables/missing')
    await waitFor(() => expect(screen.getAllByText(/table not found/i).length).toBeGreaterThan(0))
    expect(screen.getByRole('button', { name: /back to tables/i })).toBeInTheDocument()
  })

  it('shows "You" in the seat the caller is in, and offers Leave instead of Join', async () => {
    api.tables.get.mockResolvedValue({
      table: {
        ...baseTable,
        seats: [
          { userId: 'u1',  status: 'occupied' },
          { userId: null,  status: 'empty' },
        ],
      },
    })
    renderAt('/tables/tbl_1')
    // "You" now prefixes a clickable affordance like "You — click to leave";
    // match loosely. Both a header "Leave seat" button AND a per-seat "Leave
    // seat 1" button are now present — assert at least one exists.
    await waitFor(() => expect(screen.getByText(/^You/)).toBeInTheDocument())
    expect(screen.getAllByRole('button', { name: /leave seat/i }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /take a seat/i })).toBeNull()
  })

  it('does not show Join/Leave buttons for guests', async () => {
    useOptimisticSession.mockReturnValue({ data: null, isPending: false })
    api.tables.get.mockResolvedValue({ table: baseTable })
    renderAt('/tables/tbl_1')
    await waitFor(() => expect(screen.getByText(/xo \(tic-tac-toe\)/i)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /take a seat/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /leave seat/i })).toBeNull()
    // Seats are not clickable for guests — render as static list items
    expect(screen.queryAllByRole('button', { name: /take seat \d/i })).toHaveLength(0)
    expect(screen.getAllByText(/empty seat/i)).toHaveLength(2)
  })

  it('clicking an empty seat joins at that specific seatIndex (not first empty)', async () => {
    // Start signed out of the table, two empty seats
    api.tables.get.mockResolvedValue({ table: baseTable })
    api.tables.join.mockResolvedValue({ table: { ...baseTable, seats: [
      { userId: null, status: 'empty' },
      { userId: 'u1', status: 'occupied' },
    ] } })
    renderAt('/tables/tbl_1')
    // Click seat 2 specifically
    const seatBtn = await screen.findByRole('button', { name: /take seat 2/i })
    const { act } = await import('react')
    await act(async () => { seatBtn.click() })
    // API called with { seatIndex: 1 } — zero-based index for seat 2
    expect(api.tables.join).toHaveBeenCalledWith('tbl_1', { seatIndex: 1 }, 'tok')
  })

  it('clicking the caller\'s own occupied seat triggers leave (symmetric with join)', async () => {
    const seatedTable = {
      ...baseTable,
      seats: [
        { userId: 'u1',  status: 'occupied' },
        { userId: null,  status: 'empty' },
      ],
    }
    api.tables.get.mockResolvedValue({ table: seatedTable })
    api.tables.leave.mockResolvedValue({ table: baseTable })
    renderAt('/tables/tbl_1')
    const seatBtn = await screen.findByRole('button', { name: /leave seat 1/i })
    const { act } = await import('react')
    await act(async () => { seatBtn.click() })
    expect(api.tables.leave).toHaveBeenCalledWith('tbl_1', 'tok')
  })

  it('does NOT make other players\' occupied seats clickable', async () => {
    api.tables.get.mockResolvedValue({
      table: {
        ...baseTable,
        seats: [
          { userId: 'u1',      status: 'occupied' },  // mine
          { userId: 'someone', status: 'occupied' },  // someone else
        ],
      },
    })
    renderAt('/tables/tbl_1')
    await waitFor(() => expect(screen.getByText(/xo \(tic-tac-toe\)/i)).toBeInTheDocument())
    // Exactly one seat is leaveable (mine); other occupied seat must not be a button
    expect(screen.getAllByRole('button', { name: /leave seat \d/i })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /take seat \d/i })).toBeNull()
  })

  it('routes ACTIVE tables through GameView — no seat-browsing UI shown', async () => {
    api.tables.get.mockResolvedValue({
      table: {
        ...baseTable,
        status: 'ACTIVE',
        seats: [
          { userId: 'u1', status: 'occupied' },
          { userId: 'u2', status: 'occupied' },
        ],
      },
    })
    renderAt('/tables/tbl_1')
    // GameView takes over: spinner shown while connecting (socket mock never fires 'connect')
    await waitFor(() => expect(document.querySelector('.animate-spin')).not.toBeNull())
    // Seat-browsing UI is NOT rendered when GameView takes over
    expect(screen.queryByText(/empty seat/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /take a seat/i })).toBeNull()
  })

  // ── Disconnect-forfeit survival (Future_Ideas.md Known Bugs §1) ──────────
  //
  // When the survivor's tab refetches the table after their opponent
  // forfeits, the row is COMPLETED. Without the hasMountedGameView ref the
  // page would unmount GameView and bounce to the seat list — losing the
  // useGameSDK win screen + Rematch button that the spec promises.

  it('keeps GameView mounted when ACTIVE flips to COMPLETED (forfeit survival)', async () => {
    const activeTable = {
      ...baseTable,
      status: 'ACTIVE',
      seats: [
        { userId: 'u1', status: 'occupied' },
        { userId: 'u2', status: 'occupied' },
      ],
    }
    const completedTable = {
      ...activeTable,
      status: 'COMPLETED',
      seats: [
        { userId: 'u1', status: 'occupied' },        // survivor stays seated
        { userId: null, status: 'empty'    },        // forfeiter's seat freed
      ],
    }
    api.tables.get.mockResolvedValue({ table: activeTable })
    renderAt('/tables/tbl_1')
    await waitFor(() => expect(document.querySelector('.animate-spin')).not.toBeNull())

    // Now simulate the lifecycle wave that would normally reload state +
    // surface COMPLETED — fire `playerDisconnected`, swap the api response.
    api.tables.get.mockResolvedValue({ table: completedTable })
    const { act } = await import('react')
    await act(async () => { fireLifecycle('tbl_1', { kind: 'playerDisconnected', mark: 'O' }) })

    // The page must NOT regress to the seat-browsing UI; GameView stays.
    await waitFor(() => expect(screen.queryByText(/empty seat/i)).toBeNull())
    expect(screen.queryByRole('button', { name: /take a seat/i })).toBeNull()
  })

  it('lifecycle:cancelled does NOT bounce after a GameView mounted', async () => {
    api.tables.get.mockResolvedValue({
      table: {
        ...baseTable,
        status: 'ACTIVE',
        seats: [
          { userId: 'u1', status: 'occupied' },
          { userId: 'u2', status: 'occupied' },
        ],
      },
    })
    renderAt('/tables/tbl_1')
    await waitFor(() => expect(document.querySelector('.animate-spin')).not.toBeNull())

    const { act } = await import('react')
    await act(async () => { fireLifecycle('tbl_1', { kind: 'cancelled' }) })

    // Forfeit survival: no /tables bounce when the game already started.
    expect(navigateMock).not.toHaveBeenCalledWith('/tables', expect.anything())
  })

  it('lifecycle:cancelled DOES bounce when no GameView ever mounted (FORMING-time host cancel)', async () => {
    api.tables.get.mockResolvedValue({ table: baseTable })  // FORMING
    renderAt('/tables/tbl_1')
    await waitFor(() => expect(screen.getByText(/xo \(tic-tac-toe\)/i)).toBeInTheDocument())

    const { act } = await import('react')
    await act(async () => { fireLifecycle('tbl_1', { kind: 'cancelled' }) })

    // No GameView was ever shown — the survival exception doesn't apply, so
    // the legacy "table is gone" navigate fires as before.
    expect(navigateMock).toHaveBeenCalledWith('/tables', { replace: true })
  })
})
