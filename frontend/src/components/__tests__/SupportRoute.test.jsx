import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../lib/useOptimisticSession.js', () => ({
  useOptimisticSession: vi.fn(),
}))

vi.mock('../../store/rolesStore.js', () => ({
  useRolesStore: vi.fn(),
}))

import { useOptimisticSession } from '../../lib/useOptimisticSession.js'
import { useRolesStore } from '../../store/rolesStore.js'
import SupportRoute from '../admin/SupportRoute.jsx'

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderRoute(children = <div data-testid="protected">Protected Content</div>) {
  return render(
    <MemoryRouter initialEntries={['/support']}>
      <SupportRoute>{children}</SupportRoute>
    </MemoryRouter>
  )
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SupportRoute — loading state', () => {
  it('shows loading spinner when session isPending', () => {
    useOptimisticSession.mockReturnValue({ data: null, isPending: true })
    useRolesStore.mockImplementation(selector =>
      selector({ hasRole: () => false })
    )
    renderRoute()
    const spinner = document.querySelector('.animate-spin')
    expect(spinner).toBeTruthy()
  })

  it('does not render children while loading', () => {
    useOptimisticSession.mockReturnValue({ data: null, isPending: true })
    useRolesStore.mockImplementation(selector =>
      selector({ hasRole: () => false })
    )
    renderRoute()
    expect(screen.queryByTestId('protected')).toBeNull()
  })
})

describe('SupportRoute — unauthenticated redirect', () => {
  it('redirects to /play when session is null and not pending', () => {
    useOptimisticSession.mockReturnValue({ data: null, isPending: false })
    useRolesStore.mockImplementation(selector =>
      selector({ hasRole: () => false })
    )
    renderRoute()
    // Protected content should not be visible — redirect happened
    expect(screen.queryByTestId('protected')).toBeNull()
  })
})

describe('SupportRoute — lacks SUPPORT role', () => {
  it('redirects to /play when authenticated but has no SUPPORT role and is not admin', () => {
    useOptimisticSession.mockReturnValue({
      data: { user: { id: 'u_1', role: 'user' } },
      isPending: false,
    })
    useRolesStore.mockImplementation(selector =>
      selector({ hasRole: () => false })
    )
    renderRoute()
    expect(screen.queryByTestId('protected')).toBeNull()
  })
})

describe('SupportRoute — admin access', () => {
  it('renders children when session role is admin', () => {
    useOptimisticSession.mockReturnValue({
      data: { user: { id: 'ba_admin', role: 'admin' } },
      isPending: false,
    })
    useRolesStore.mockImplementation(selector =>
      selector({ hasRole: () => false })
    )
    renderRoute()
    expect(screen.getByTestId('protected')).toBeDefined()
  })

  it('does not show a spinner when admin session is ready', () => {
    useOptimisticSession.mockReturnValue({
      data: { user: { id: 'ba_admin', role: 'admin' } },
      isPending: false,
    })
    useRolesStore.mockImplementation(selector =>
      selector({ hasRole: () => false })
    )
    renderRoute()
    expect(document.querySelector('.animate-spin')).toBeNull()
  })
})

describe('SupportRoute — SUPPORT role access', () => {
  it('renders children when user has SUPPORT domain role', () => {
    useOptimisticSession.mockReturnValue({
      data: { user: { id: 'u_1', role: 'user' } },
      isPending: false,
    })
    useRolesStore.mockImplementation(selector =>
      selector({ hasRole: (role) => role === 'SUPPORT' })
    )
    renderRoute()
    expect(screen.getByTestId('protected')).toBeDefined()
  })

  it('renders children for user with SUPPORT role even when not admin', () => {
    useOptimisticSession.mockReturnValue({
      data: { user: { id: 'u_2', role: 'user' } },
      isPending: false,
    })
    useRolesStore.mockImplementation(selector =>
      selector({ hasRole: (role) => role === 'SUPPORT' })
    )
    const children = <p data-testid="child-content">Support Panel</p>
    renderRoute(children)
    expect(screen.getByTestId('child-content')).toBeDefined()
    expect(screen.getByText('Support Panel')).toBeDefined()
  })
})
