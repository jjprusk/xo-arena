import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'

// ── Hoisted shared state ───────────────────────────────────────────────────────
// vi.hoisted ensures these are available inside mock factories (which are hoisted
// ahead of normal module code by Vitest's transform).

const { paths, socketHandlers, mockSocket, mockPlay, mockNavigate } = vi.hoisted(() => {
  const paths = { current: '/play' }
  const socketHandlers = {}
  const mockSocket = {
    on:  (event, fn) => { socketHandlers[event] = fn },
    off: () => {},
  }
  const mockPlay = vi.fn()
  const mockNavigate = vi.fn()
  return { paths, socketHandlers, mockSocket, mockPlay, mockNavigate }
})

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation:  () => ({ pathname: paths.current, key: paths.current }),
    NavLink: ({ to, children, className, onClick }) => {
      const isActive = paths.current === to
      const cls = typeof className === 'function' ? className({ isActive }) : (className || '')
      return <a href={to} className={cls} onClick={onClick}>{children}</a>
    },
    Link:   ({ to, children, onClick }) => <a href={to} onClick={onClick}>{children}</a>,
    Outlet: () => null,
  }
})

vi.mock('../../../lib/socket.js', () => ({
  getSocket: vi.fn(() => mockSocket),
}))

vi.mock('../../../store/soundStore.js', () => ({
  useSoundStore: { getState: vi.fn(() => ({ play: mockPlay })) },
}))

vi.mock('../../../lib/getToken.js', () => ({
  getToken: () => Promise.resolve('test-token'),
}))

vi.mock('../../../lib/useOptimisticSession.js', () => ({
  useOptimisticSession: vi.fn(),
}))

vi.mock('../../../store/rolesStore.js', () => ({
  useRolesStore: vi.fn(),
}))

vi.mock('../../../store/gameStore.js', () => ({
  useGameStore: { getState: vi.fn(() => ({ newGame: vi.fn() })) },
}))

vi.mock('../../../store/pvpStore.js', () => ({
  usePvpStore: { getState: vi.fn(() => ({ reset: vi.fn() })) },
}))

vi.mock('../../../lib/api.js', () => ({
  api:      { users: { sync: vi.fn(() => Promise.resolve()) } },
  prefetch: vi.fn(),
}))

vi.mock('../../ui/ThemeToggle.jsx',  () => ({ default: () => null }))
vi.mock('../../ui/MuteToggle.jsx',   () => ({ default: () => null }))
vi.mock('../../auth/AuthModal.jsx',  () => ({ default: () => null }))
vi.mock('../../auth/UserButton.jsx', () => ({ default: () => null }))
vi.mock('../../auth/SignedIn.jsx',   () => ({ default: ({ children }) => <>{children}</> }))
vi.mock('../../auth/SignedOut.jsx',  () => ({ default: () => null }))
vi.mock('../../feedback/FeedbackButton.jsx', () => ({ default: () => null }))
vi.mock('../IdleLogoutManager.jsx', () => ({ default: () => null }))

// ── Imports (after mocks) ──────────────────────────────────────────────────────

import { useOptimisticSession } from '../../../lib/useOptimisticSession.js'
import { useRolesStore } from '../../../store/rolesStore.js'
import AppLayout from '../AppLayout.jsx'

// ── Setup helpers ──────────────────────────────────────────────────────────────

function setupAdmin() {
  useOptimisticSession.mockReturnValue({
    data: { user: { id: 'usr_admin', role: 'admin' } },
    isPending: false,
  })
  useRolesStore.mockReturnValue({
    roles: [],
    hasRole: () => false,
    fetch:   vi.fn(),
    clear:   vi.fn(),
  })
}

function setupSupport() {
  useOptimisticSession.mockReturnValue({
    data: { user: { id: 'usr_sup', role: 'user' } },
    isPending: false,
  })
  useRolesStore.mockReturnValue({
    roles: ['SUPPORT'],
    hasRole: (role) => role === 'SUPPORT',
    fetch:   vi.fn(),
    clear:   vi.fn(),
  })
}

function setupUser() {
  useOptimisticSession.mockReturnValue({
    data: { user: { id: 'usr_1', role: 'user' } },
    isPending: false,
  })
  useRolesStore.mockReturnValue({
    roles: [],
    hasRole: () => false,
    fetch:   vi.fn(),
    clear:   vi.fn(),
  })
}

function stubFetch(count) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok:   true,
    json: () => Promise.resolve({ count }),
  }))
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  paths.current = '/play'
  // Clear hoisted handler registry between tests
  Object.keys(socketHandlers).forEach(k => delete socketHandlers[k])
  sessionStorage.clear()
})

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('AppLayout — Phase 3: polling', () => {
  it('admin: polls /api/v1/admin/feedback/unread-count on mount', async () => {
    setupAdmin()
    stubFetch(0)
    await act(async () => { render(<AppLayout />) })
    const url = global.fetch.mock.calls.find(([u]) =>
      typeof u === 'string' && u.includes('admin/feedback/unread-count')
    )?.[0]
    expect(url).toBeDefined()
    expect(url).toContain('/api/v1/admin/feedback/unread-count')
  })

  it('support: polls /api/v1/support/feedback/unread-count on mount', async () => {
    setupSupport()
    stubFetch(0)
    await act(async () => { render(<AppLayout />) })
    const url = global.fetch.mock.calls.find(([u]) =>
      typeof u === 'string' && u.includes('support/feedback/unread-count')
    )?.[0]
    expect(url).toBeDefined()
    expect(url).toContain('/api/v1/support/feedback/unread-count')
  })

  it('regular user does NOT poll the unread-count endpoint', async () => {
    setupUser()
    stubFetch(0)
    await act(async () => { render(<AppLayout />) })
    const countCall = global.fetch.mock.calls.find(([u]) =>
      typeof u === 'string' && u.includes('feedback/unread-count')
    )
    expect(countCall).toBeUndefined()
  })

  it('shows FeedbackToast when poll returns count > 0', async () => {
    setupAdmin()
    stubFetch(3)
    await act(async () => { render(<AppLayout />) })
    await waitFor(() => {
      expect(screen.getByText(/3 new feedback/i)).toBeDefined()
    })
  })

  it('polls again after 60 seconds', async () => {
    setupAdmin()
    stubFetch(0)
    vi.useFakeTimers()
    await act(async () => { render(<AppLayout />) })
    const callsBefore = global.fetch.mock.calls.filter(([u]) =>
      typeof u === 'string' && u.includes('feedback/unread-count')
    ).length
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    const callsAfter = global.fetch.mock.calls.filter(([u]) =>
      typeof u === 'string' && u.includes('feedback/unread-count')
    ).length
    expect(callsAfter).toBeGreaterThan(callsBefore)
    vi.useRealTimers()
  })
})

describe('AppLayout — Phase 3: socket + chime', () => {
  it('registers a feedback:new socket listener for admin', async () => {
    setupAdmin()
    stubFetch(0)
    await act(async () => { render(<AppLayout />) })
    expect(typeof socketHandlers['feedback:new']).toBe('function')
  })

  it('registers a feedback:new socket listener for support', async () => {
    setupSupport()
    stubFetch(0)
    await act(async () => { render(<AppLayout />) })
    expect(typeof socketHandlers['feedback:new']).toBe('function')
  })

  it('does NOT register a feedback:new listener for regular users', async () => {
    setupUser()
    stubFetch(0)
    await act(async () => { render(<AppLayout />) })
    expect(socketHandlers['feedback:new']).toBeUndefined()
  })

  it('feedback:new plays win chime', async () => {
    setupAdmin()
    stubFetch(0)
    await act(async () => { render(<AppLayout />) })
    act(() => { socketHandlers['feedback:new']?.() })
    expect(mockPlay).toHaveBeenCalledWith('win')
  })

  it('feedback:new increments unread count and shows toast', async () => {
    setupAdmin()
    stubFetch(0)
    await act(async () => { render(<AppLayout />) })
    act(() => { socketHandlers['feedback:new']?.() })
    await waitFor(() => {
      expect(screen.getByText(/1 new feedback/i)).toBeDefined()
    })
  })
})

describe('AppLayout — Phase 3: FeedbackToast', () => {
  it('toast shows "View feedback" for admin and navigates to /admin/feedback', async () => {
    setupAdmin()
    stubFetch(2)
    await act(async () => { render(<AppLayout />) })
    await waitFor(() => expect(screen.getByText(/view feedback/i)).toBeDefined())
    fireEvent.click(screen.getByText(/view feedback/i))
    expect(mockNavigate).toHaveBeenCalledWith('/admin/feedback')
  })

  it('toast shows "View feedback" for support and navigates to /support', async () => {
    setupSupport()
    stubFetch(1)
    await act(async () => { render(<AppLayout />) })
    await waitFor(() => expect(screen.getByText(/view feedback/i)).toBeDefined())
    fireEvent.click(screen.getByText(/view feedback/i))
    expect(mockNavigate).toHaveBeenCalledWith('/support')
  })

  it('Dismiss button hides the toast', async () => {
    setupAdmin()
    stubFetch(1)
    await act(async () => { render(<AppLayout />) })
    await waitFor(() => expect(screen.getByText(/1 new feedback/i)).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(screen.queryByText(/new feedback/i)).toBeNull()
  })
})

describe('AppLayout — Phase 3: badge clearing on navigation', () => {
  it('admin: badge clears when path is /admin/feedback', async () => {
    setupAdmin()
    stubFetch(5)
    const { rerender } = await act(async () => render(<AppLayout />))
    await waitFor(() => expect(screen.getByText(/5 new feedback/i)).toBeDefined())

    // Navigate to the feedback page
    paths.current = '/admin/feedback'
    await act(async () => { rerender(<AppLayout />) })
    expect(screen.queryByText(/new feedback/i)).toBeNull()
  })

  it('support: badge clears when path is /support', async () => {
    setupSupport()
    stubFetch(2)
    const { rerender } = await act(async () => render(<AppLayout />))
    await waitFor(() => expect(screen.getByText(/2 new feedback/i)).toBeDefined())

    paths.current = '/support'
    await act(async () => { rerender(<AppLayout />) })
    expect(screen.queryByText(/new feedback/i)).toBeNull()
  })
})

describe('AppLayout — Phase 3: hamburger badge', () => {
  it('Feedback link in hamburger shows unread badge count', async () => {
    setupAdmin()
    stubFetch(4)
    await act(async () => { render(<AppLayout />) })
    await waitFor(() => expect(screen.getByText(/4 new feedback/i)).toBeDefined())

    // Open hamburger menu
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }))
    await waitFor(() => {
      // Badge "4" appears in hamburger Feedback link
      const badges = screen.getAllByText('4')
      expect(badges.length).toBeGreaterThan(0)
    })
  })

  it('hamburger badge shows "9+" when count > 9', async () => {
    setupAdmin()
    stubFetch(12)
    await act(async () => { render(<AppLayout />) })
    await waitFor(() => expect(screen.getByText(/12 new feedback/i)).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: /open menu/i }))
    await waitFor(() => {
      const badges = screen.getAllByText('9+')
      expect(badges.length).toBeGreaterThan(0)
    })
  })
})
