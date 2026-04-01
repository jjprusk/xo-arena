import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../lib/useOptimisticSession.js', () => ({
  useOptimisticSession: vi.fn(() => ({
    data: { user: { id: 'ba_1', name: 'Support User', role: 'user' } },
    isPending: false,
  })),
  clearSessionCache: vi.fn(),
}))

vi.mock('../../store/rolesStore.js', () => ({
  useRolesStore: vi.fn(() => ({
    roles: ['SUPPORT'],
    hasRole: vi.fn(() => true),
    isAdminOrSupport: vi.fn(() => true),
    fetch: vi.fn(),
    clear: vi.fn(),
  })),
}))

vi.mock('../../lib/auth-client.js', () => ({
  signOut: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../lib/getToken.js', () => ({
  getToken: () => Promise.resolve('test-token'),
  clearTokenCache: vi.fn(),
}))

vi.mock('../../components/feedback/FeedbackInbox.jsx', () => ({
  default: ({ apiBase }) => (
    <div data-testid="feedback-inbox" data-api-base={apiBase}>
      FeedbackInbox Stub
    </div>
  ),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn() }
})

import SupportPage from '../SupportPage.jsx'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_USER_RESULT = {
  id: 'usr_1',
  displayName: 'Bob Smith',
  name: 'Bob Smith',
  email: 'bob@example.com',
  banned: false,
  createdAt: new Date('2024-01-15').toISOString(),
  image: null,
}

const MOCK_BANNED_USER = {
  ...MOCK_USER_RESULT,
  id: 'usr_2',
  displayName: 'Eve Jones',
  name: 'Eve Jones',
  email: 'eve@example.com',
  banned: true,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderPage() {
  return render(
    <MemoryRouter>
      <SupportPage />
    </MemoryRouter>
  )
}

function stubUserSearch(users = [MOCK_USER_RESULT]) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ users }),
  }))
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SupportPage — header', () => {
  it('renders "Support" brand text in the header', () => {
    renderPage()
    // "Support" appears in both the header span and the h1 — getAllByText handles multiple matches
    const els = screen.getAllByText('Support')
    expect(els.length).toBeGreaterThan(0)
  })

  it('shows a sign-out button in the header', () => {
    renderPage()
    expect(screen.getByRole('button', { name: /sign out/i })).toBeDefined()
  })

  it('does not render full AppLayout nav (no nav element)', () => {
    renderPage()
    // The support page uses a minimal header — no <nav> from AppLayout
    const navEl = document.querySelector('nav')
    expect(navEl).toBeNull()
  })
})

describe('SupportPage — tabs', () => {
  it('shows Inbox tab button', () => {
    renderPage()
    expect(screen.getByRole('button', { name: 'Inbox' })).toBeDefined()
  })

  it('shows User Lookup tab button', () => {
    renderPage()
    expect(screen.getByRole('button', { name: 'User Lookup' })).toBeDefined()
  })

  it('Inbox tab is active by default — FeedbackInbox is visible', () => {
    renderPage()
    expect(screen.getByTestId('feedback-inbox')).toBeDefined()
  })

  it('FeedbackInbox passes /api/v1/support/feedback as apiBase', () => {
    renderPage()
    const inbox = screen.getByTestId('feedback-inbox')
    expect(inbox.getAttribute('data-api-base')).toBe('/api/v1/support/feedback')
  })

  it('switching to User Lookup tab shows search input', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'User Lookup' }))
    expect(screen.getByPlaceholderText(/search by name or email/i)).toBeDefined()
  })

  it('switching to User Lookup tab hides FeedbackInbox', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'User Lookup' }))
    expect(screen.queryByTestId('feedback-inbox')).toBeNull()
  })

  it('switching back to Inbox tab shows FeedbackInbox again', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'User Lookup' }))
    fireEvent.click(screen.getByRole('button', { name: 'Inbox' }))
    expect(screen.getByTestId('feedback-inbox')).toBeDefined()
  })
})

describe('SupportPage — User Lookup', () => {
  beforeEach(() => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'User Lookup' }))
  })

  it('search input is present on User Lookup tab', () => {
    expect(screen.getByPlaceholderText(/search by name or email/i)).toBeDefined()
  })

  it('typing in search triggers API call to /api/v1/support/users after debounce', async () => {
    vi.useFakeTimers()
    stubUserSearch([MOCK_USER_RESULT])

    const input = screen.getByPlaceholderText(/search by name or email/i)
    fireEvent.change(input, { target: { value: 'bob' } })

    // advanceTimersByTimeAsync advances timers AND flushes pending Promise microtasks
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/support/users'),
      expect.any(Object)
    )

    vi.useRealTimers()
  })

  it('shows user displayName in results', async () => {
    vi.useFakeTimers()
    stubUserSearch([MOCK_USER_RESULT])

    const input = screen.getByPlaceholderText(/search by name or email/i)
    fireEvent.change(input, { target: { value: 'bob' } })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    expect(screen.getByText('Bob Smith')).toBeDefined()

    vi.useRealTimers()
  })

  it('shows user email in results', async () => {
    vi.useFakeTimers()
    stubUserSearch([MOCK_USER_RESULT])

    const input = screen.getByPlaceholderText(/search by name or email/i)
    fireEvent.change(input, { target: { value: 'bob' } })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    // Email appears alongside "· Joined ..." in the same div — use regex for partial match
    expect(screen.getByText(/bob@example\.com/)).toBeDefined()

    vi.useRealTimers()
  })

  it('shows "Ban" button for active user', async () => {
    vi.useFakeTimers()
    stubUserSearch([MOCK_USER_RESULT])

    const input = screen.getByPlaceholderText(/search by name or email/i)
    fireEvent.change(input, { target: { value: 'bob' } })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    expect(screen.getByRole('button', { name: /^ban$/i })).toBeDefined()

    vi.useRealTimers()
  })

  it('shows "Unban" button for banned user', async () => {
    vi.useFakeTimers()
    stubUserSearch([MOCK_BANNED_USER])

    const input = screen.getByPlaceholderText(/search by name or email/i)
    fireEvent.change(input, { target: { value: 'eve' } })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    expect(screen.getByRole('button', { name: /^unban$/i })).toBeDefined()

    vi.useRealTimers()
  })

  it('clicking Ban calls the ban API endpoint', async () => {
    vi.useFakeTimers()

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ users: [MOCK_USER_RESULT] }),
      })
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ user: { ...MOCK_USER_RESULT, banned: true } }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const input = screen.getByPlaceholderText(/search by name or email/i)
    fireEvent.change(input, { target: { value: 'bob' } })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    expect(screen.getByRole('button', { name: /^ban$/i })).toBeDefined()

    // Wrap click in act so the toggleBan async chain flushes before asserting
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^ban$/i }))
    })

    const calls = fetchMock.mock.calls
    const banCall = calls.find(([url, opts]) =>
      url.includes(`/api/v1/support/users/${MOCK_USER_RESULT.id}/ban`) &&
      opts?.method === 'PATCH'
    )
    expect(banCall).toBeDefined()

    vi.useRealTimers()
  })

  it('shows "No users found." when search returns empty results', async () => {
    vi.useFakeTimers()
    stubUserSearch([])

    const input = screen.getByPlaceholderText(/search by name or email/i)
    fireEvent.change(input, { target: { value: 'nobody' } })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    expect(screen.getByText('No users found.')).toBeDefined()

    vi.useRealTimers()
  })
})

describe('SupportPage — sign out', () => {
  it('clicking sign out calls signOut', async () => {
    const { signOut } = await import('../../lib/auth-client.js')
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))
    await waitFor(() => {
      expect(signOut).toHaveBeenCalled()
    })
  })
})
