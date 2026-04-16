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
  getSocket: vi.fn(() => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn() })),
}))

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
  useOptimisticSession.mockReturnValue({ data: { user: { id: 'u1' } }, isPending: false })
})

describe('TableDetailPage', () => {
  it('renders the table heading and seat list', async () => {
    api.tables.get.mockResolvedValue({ table: baseTable })
    renderAt('/tables/tbl_1')
    await waitFor(() => expect(screen.getByText(/xo \(tic-tac-toe\)/i)).toBeInTheDocument())
    expect(screen.getAllByText(/empty seat/i)).toHaveLength(2)
    expect(screen.getByRole('button', { name: /take a seat/i })).toBeInTheDocument()
  })

  it('shows 404 state when the table does not exist', async () => {
    const err = Object.assign(new Error('not found'), { status: 404 })
    api.tables.get.mockRejectedValue(err)
    renderAt('/tables/missing')
    await waitFor(() => expect(screen.getAllByText(/table not found/i).length).toBeGreaterThan(0))
    expect(screen.getByRole('link', { name: /back to tables/i })).toBeInTheDocument()
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
    await waitFor(() => expect(screen.getByText('You')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /leave seat/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /take a seat/i })).toBeNull()
  })

  it('does not show Join/Leave buttons for guests', async () => {
    useOptimisticSession.mockReturnValue({ data: null, isPending: false })
    api.tables.get.mockResolvedValue({ table: baseTable })
    renderAt('/tables/tbl_1')
    await waitFor(() => expect(screen.getByText(/xo \(tic-tac-toe\)/i)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /take a seat/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /leave seat/i })).toBeNull()
  })
})
