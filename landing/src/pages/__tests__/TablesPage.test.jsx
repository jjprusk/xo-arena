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
  useOptimisticSession.mockReturnValue({ data: null, isPending: false })
})

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

  it('renders table cards when the list has entries', async () => {
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
    // The card links to the table detail page — use that to scope the match
    const link = screen.getByRole('link', { name: /xo .tic-tac-toe./i })
    expect(link).toBeInTheDocument()
    expect(link.getAttribute('href')).toBe('/tables/tbl_1')
    expect(link).toHaveTextContent(/1 \/ 2 seated/)
    // "Forming" appears in both the filter bar AND the card status badge; just
    // verify at least one exists
    expect(screen.getAllByText(/forming/i).length).toBeGreaterThan(0)
  })

  it('surfaces API errors in the page', async () => {
    api.tables.list.mockRejectedValue(new Error('boom'))
    renderPage()
    await waitFor(() => expect(screen.getByText(/boom/)).toBeInTheDocument())
  })
})
