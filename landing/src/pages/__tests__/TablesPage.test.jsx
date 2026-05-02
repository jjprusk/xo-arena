import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../lib/api.js', () => ({
  api: {
    tables: {
      list:   vi.fn(),
      get:    vi.fn(),
      create: vi.fn(),
      join:   vi.fn(),
      leave:  vi.fn(),
    },
  },
}))

vi.mock('../../lib/getToken.js', () => ({
  getToken: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../lib/useOptimisticSession.js', () => ({
  useOptimisticSession: vi.fn(),
}))

vi.mock('../../lib/socket.js', () => ({
  getSocket: vi.fn(() => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn() })),
}))

// Capture useEventStream subscriptions so tests can dispatch synthetic bus
// events and observe the page's reaction.
const eventStreamSubs = []
vi.mock('../../lib/useEventStream.js', () => ({
  useEventStream: (opts) => { eventStreamSubs.push(opts) },
}))

import TablesPage from '../TablesPage.jsx'
import { api } from '../../lib/api.js'
import { useOptimisticSession } from '../../lib/useOptimisticSession.js'

function renderPage() {
  return render(
    <MemoryRouter>
      <TablesPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  eventStreamSubs.length = 0
  useOptimisticSession.mockReturnValue({ data: null, isPending: false })
})

/** Fire a synthetic guide:notification bus event into TablesPage. */
function fireBusEvent(payload) {
  const sub = eventStreamSubs.find(s =>
    Array.isArray(s.channels) && s.channels.includes('guide:notification'),
  )
  expect(sub).toBeTruthy()
  sub.onEvent('guide:notification', payload)
}

describe('TablesPage', () => {
  it('renders the page heading', async () => {
    api.tables.list.mockResolvedValue({ tables: [] })
    renderPage()
    expect(screen.getByRole('heading', { name: /tables/i })).toBeInTheDocument()
  })

  it('shows empty state when no tables exist (guest view)', async () => {
    api.tables.list.mockResolvedValue({ tables: [] })
    renderPage()
    await waitFor(() => expect(api.tables.list).toHaveBeenCalled())
    expect(screen.getByText(/no tables open right now/i)).toBeInTheDocument()
    expect(screen.getByText(/sign in to create the first table/i)).toBeInTheDocument()
    // Guest: no create button
    expect(screen.queryByRole('button', { name: /create table/i })).toBeNull()
  })

  it('shows the Create button for signed-in users', async () => {
    api.tables.list.mockResolvedValue({ tables: [] })
    useOptimisticSession.mockReturnValue({ data: { user: { id: 'u1' } }, isPending: false })
    renderPage()
    await waitFor(() => expect(api.tables.list).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /\+ create table/i })).toBeInTheDocument()
  })

  it('renders table rows when the list has entries', async () => {
    api.tables.list.mockResolvedValue({
      tables: [
        {
          id: 'tbl_1',
          gameId: 'xo',
          status: 'FORMING',
          maxPlayers: 2,
          seats: [
            { userId: 'u1', status: 'occupied' },
            { userId: null, status: 'empty' },
          ],
        },
      ],
    })
    renderPage()
    await waitFor(() => expect(screen.queryByText(/no tables open/i)).toBeNull())
    // ListTable renders a <table>. The game cell shows the human-readable label.
    const row = screen.getByRole('row', { name: /xo .tic-tac-toe./i })
    expect(row).toBeInTheDocument()
    expect(row).toHaveTextContent(/1 \/ 2/)
    // "Forming" appears in both the filter bar AND the row status badge; verify at least one
    expect(screen.getAllByText(/forming/i).length).toBeGreaterThan(0)
  })

  it('surfaces API errors in the page', async () => {
    api.tables.list.mockRejectedValue(new Error('boom'))
    renderPage()
    await waitFor(() => expect(screen.getByText(/boom/)).toBeInTheDocument())
  })

  // ── Bus-event refresh (Future_Ideas Known-Bugs §1 follow-up) ─────────────
  //
  // After a forfeit or natural game-end, the backend dispatches
  // `table.released`. Without that event in the refresh-trigger set, the
  // survivor's TablesPage kept showing the old ACTIVE/FORMING row even
  // after the underlying table had flipped to COMPLETED.

  it('refetches the list when a `table.released` bus event arrives', async () => {
    api.tables.list.mockResolvedValue({ tables: [] })
    renderPage()
    await waitFor(() => expect(api.tables.list).toHaveBeenCalledTimes(1))

    vi.useFakeTimers()
    fireBusEvent({ type: 'table.released', payload: { tableId: 'tbl_x', reason: 'leave' } })
    // Coalescing debounce is 250ms — advance past it.
    await vi.advanceTimersByTimeAsync(300)
    vi.useRealTimers()

    await waitFor(() => expect(api.tables.list).toHaveBeenCalledTimes(2))
  })

  it('ignores unrelated bus events (e.g. guide:journeyStep) — no refetch', async () => {
    api.tables.list.mockResolvedValue({ tables: [] })
    renderPage()
    await waitFor(() => expect(api.tables.list).toHaveBeenCalledTimes(1))

    vi.useFakeTimers()
    fireBusEvent({ type: 'guide:journeyStep', payload: { step: 3 } })
    await vi.advanceTimersByTimeAsync(300)
    vi.useRealTimers()

    expect(api.tables.list).toHaveBeenCalledTimes(1)
  })
})
