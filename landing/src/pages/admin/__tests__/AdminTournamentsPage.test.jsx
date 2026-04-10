import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../../../lib/useOptimisticSession.js', () => ({
  useOptimisticSession: vi.fn(),
}))

vi.mock('../../../lib/getToken.js', () => ({
  getToken: vi.fn(() => Promise.resolve('test-token')),
}))

global.fetch = vi.fn(() =>
  Promise.resolve({ ok: true, json: async () => ({ tournaments: [], total: 0, page: 1, totalPages: 1 }) })
)

import { useOptimisticSession } from '../../../lib/useOptimisticSession.js'
import AdminTournamentsPage from '../AdminTournamentsPage.jsx'

function renderAdmin() {
  return render(
    <MemoryRouter initialEntries={['/admin/tournaments']}>
      <Routes>
        <Route path="/admin/tournaments" element={<AdminTournamentsPage />} />
        <Route path="/" element={<div>Home</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('AdminTournamentsPage', () => {
  it('renders nothing while auth is pending', () => {
    useOptimisticSession.mockReturnValue({ data: null, isPending: true })
    const { container } = renderAdmin()
    expect(container.firstChild).toBeNull()
  })

  it('redirects to / when user is not signed in', () => {
    useOptimisticSession.mockReturnValue({ data: null, isPending: false })
    renderAdmin()
    expect(screen.getByText('Home')).toBeDefined()
  })

  it('redirects to / when user is not admin', () => {
    useOptimisticSession.mockReturnValue({
      data: { user: { id: 'u1', role: 'user' } },
      isPending: false,
    })
    renderAdmin()
    expect(screen.getByText('Home')).toBeDefined()
  })

  it('renders the tournaments heading for admin users', async () => {
    useOptimisticSession.mockReturnValue({
      data: { user: { id: 'u1', role: 'admin' } },
      isPending: false,
    })
    renderAdmin()
    expect(screen.getByRole('heading', { name: 'Tournaments' })).toBeDefined()
  })
})
