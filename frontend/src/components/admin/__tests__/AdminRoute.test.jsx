import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../../../lib/useOptimisticSession.js', () => ({
  useOptimisticSession: vi.fn(),
}))

import { useOptimisticSession } from '../../../lib/useOptimisticSession.js'
import AdminRoute from '../AdminRoute.jsx'

function renderRoute(children) {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/admin" element={<AdminRoute>{children}</AdminRoute>} />
        <Route path="/play" element={<div>Play page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('AdminRoute', () => {
  it('shows a spinner while auth is pending', () => {
    useOptimisticSession.mockReturnValue({ data: null, isPending: true })
    renderRoute(<div>Admin content</div>)
    // Spinner is a div with animate-spin class
    const spinner = document.querySelector('.animate-spin')
    expect(spinner).not.toBeNull()
    expect(screen.queryByText('Admin content')).toBeNull()
  })

  it('redirects to /play when user is not admin', () => {
    useOptimisticSession.mockReturnValue({
      data: { user: { id: '1', role: 'user' } },
      isPending: false,
    })
    renderRoute(<div>Admin content</div>)
    expect(screen.getByText('Play page')).toBeDefined()
    expect(screen.queryByText('Admin content')).toBeNull()
  })

  it('redirects to /play when signed out', () => {
    useOptimisticSession.mockReturnValue({ data: null, isPending: false })
    renderRoute(<div>Admin content</div>)
    expect(screen.getByText('Play page')).toBeDefined()
  })

  it('renders children when user is admin', () => {
    useOptimisticSession.mockReturnValue({
      data: { user: { id: '1', role: 'admin' } },
      isPending: false,
    })
    renderRoute(<div>Admin content</div>)
    expect(screen.getByText('Admin content')).toBeDefined()
  })
})
