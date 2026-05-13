import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../../../lib/useOptimisticSession.js', () => ({
  useOptimisticSession: vi.fn(),
}))
vi.mock('../../../lib/getToken.js', () => ({
  getToken: vi.fn(async () => 'tok'),
}))

const mockGetRoles = vi.fn()
vi.mock('../../../lib/api.js', () => ({
  api: { me: { getRoles: (...a) => mockGetRoles(...a) } },
}))

import { useOptimisticSession } from '../../../lib/useOptimisticSession.js'
import AdminLandingRoute from '../AdminLandingRoute.jsx'
import HelpAdminRoute from '../HelpAdminRoute.jsx'

function renderAt(path, RouteComp) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<div>Home</div>} />
        <Route path="/admin" element={<RouteComp><div>Dashboard</div></RouteComp>} />
        <Route path="/admin/help" element={<div>Help admin</div>} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  mockGetRoles.mockReset()
})

describe('AdminLandingRoute', () => {
  it('shows spinner while session is pending', () => {
    useOptimisticSession.mockReturnValue({ data: null, isPending: true })
    const { container } = renderAt('/admin', AdminLandingRoute)
    expect(container.querySelector('.animate-spin')).not.toBeNull()
  })

  it('passes through for BetterAuth admin role', async () => {
    useOptimisticSession.mockReturnValue({
      data: { user: { id: 'u1', role: 'admin' } }, isPending: false,
    })
    renderAt('/admin', AdminLandingRoute)
    await waitFor(() => expect(screen.getByText('Dashboard')).toBeDefined())
    // No need to call /me/roles for BA admin
    expect(mockGetRoles).not.toHaveBeenCalled()
  })

  it('passes through for domain ADMIN role', async () => {
    useOptimisticSession.mockReturnValue({
      data: { user: { id: 'u1', role: 'user' } }, isPending: false,
    })
    mockGetRoles.mockResolvedValue({ roles: ['ADMIN'] })

    renderAt('/admin', AdminLandingRoute)
    await waitFor(() => expect(screen.getByText('Dashboard')).toBeDefined())
  })

  it('redirects HELP_ADMIN-only user to /admin/help', async () => {
    useOptimisticSession.mockReturnValue({
      data: { user: { id: 'u1', role: 'user' } }, isPending: false,
    })
    mockGetRoles.mockResolvedValue({ roles: ['HELP_ADMIN'] })

    renderAt('/admin', AdminLandingRoute)
    await waitFor(() => expect(screen.getByText('Help admin')).toBeDefined())
  })

  it('redirects to / when user has no relevant role', async () => {
    useOptimisticSession.mockReturnValue({
      data: { user: { id: 'u1', role: 'user' } }, isPending: false,
    })
    mockGetRoles.mockResolvedValue({ roles: ['SUPPORT'] })

    renderAt('/admin', AdminLandingRoute)
    await waitFor(() => expect(screen.getByText('Home')).toBeDefined())
  })

  it('redirects to / when not signed in', async () => {
    useOptimisticSession.mockReturnValue({ data: null, isPending: false })
    renderAt('/admin', AdminLandingRoute)
    await waitFor(() => expect(screen.getByText('Home')).toBeDefined())
  })
})

describe('HelpAdminRoute', () => {
  it('admits HELP_ADMIN users', async () => {
    useOptimisticSession.mockReturnValue({
      data: { user: { id: 'u1', role: 'user' } }, isPending: false,
    })
    mockGetRoles.mockResolvedValue({ roles: ['HELP_ADMIN'] })

    render(
      <MemoryRouter initialEntries={['/admin/help']}>
        <Routes>
          <Route path="/" element={<div>Home</div>} />
          <Route path="/admin/help" element={<HelpAdminRoute><div>Help page</div></HelpAdminRoute>} />
        </Routes>
      </MemoryRouter>
    )
    await waitFor(() => expect(screen.getByText('Help page')).toBeDefined())
  })

  it('rejects users with no admin role', async () => {
    useOptimisticSession.mockReturnValue({
      data: { user: { id: 'u1', role: 'user' } }, isPending: false,
    })
    mockGetRoles.mockResolvedValue({ roles: [] })

    render(
      <MemoryRouter initialEntries={['/admin/help']}>
        <Routes>
          <Route path="/" element={<div>Home</div>} />
          <Route path="/admin/help" element={<HelpAdminRoute><div>Help page</div></HelpAdminRoute>} />
        </Routes>
      </MemoryRouter>
    )
    await waitFor(() => expect(screen.getByText('Home')).toBeDefined())
  })
})
