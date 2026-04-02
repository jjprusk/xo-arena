import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../../../lib/api.js', () => ({
  api: {
    admin: {
      users: vi.fn(),
      updateUser: vi.fn(),
      deleteUser: vi.fn(),
    },
  },
}))

vi.mock('../../../lib/getToken.js', () => ({
  getToken: () => Promise.resolve('test-token'),
}))

vi.mock('../../../lib/useOptimisticSession.js', () => ({
  useOptimisticSession: vi.fn(),
}))

vi.mock('../AdminDashboard.jsx', () => ({
  AdminHeader: ({ title, subtitle }) => (
    <div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
  ),
  Spinner: () => <div data-testid="spinner">Loading</div>,
  ErrorMsg: ({ children }) => <p data-testid="error">{children}</p>,
}))

vi.mock('../../../components/ui/ListTable.jsx', () => ({
  ListTable: ({ children }) => <table>{children}</table>,
  ListTh: ({ children }) => <th>{children}</th>,
  ListTd: ({ children, align, className }) => <td>{children}</td>,
  ListTr: ({ children }) => <tr>{children}</tr>,
  UserAvatar: ({ user }) => <span>{user?.displayName?.[0] ?? '?'}</span>,
  SearchBar: ({ value, onChange, placeholder }) => (
    <input
      data-testid="search"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
    />
  ),
  ListPagination: () => null,
}))

import { useOptimisticSession } from '../../../lib/useOptimisticSession.js'
import { api } from '../../../lib/api.js'
import AdminUsersPage from '../AdminUsersPage.jsx'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_USER = {
  id: 'usr_1',
  betterAuthId: 'ba_other',
  displayName: 'Alice',
  username: 'alice',
  email: 'alice@example.com',
  emailVerified: true,
  eloRating: 1350,
  banned: false,
  baRole: null,
  roles: [],
  mlModelLimit: null,
  online: false,
  signedInAt: null,
  _count: { gamesAsPlayer1: 10 },
}

const BANNED_USER = { ...MOCK_USER, id: 'usr_2', betterAuthId: 'ba_banned', banned: true }
const ONLINE_USER = { ...MOCK_USER, id: 'usr_3', betterAuthId: 'ba_online', online: true, signedInAt: new Date(Date.now() - 5 * 60_000).toISOString() }

// Session signed in as admin — different betterAuthId so isSelf is false
function signedInAsAdmin() {
  useOptimisticSession.mockReturnValue({
    data: { user: { id: 'ba_admin', role: 'admin' } },
  })
}

const renderPage = () =>
  render(<MemoryRouter><AdminUsersPage /></MemoryRouter>)

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  signedInAsAdmin()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AdminUsersPage — heading', () => {
  it('renders "Users" heading', async () => {
    api.admin.users.mockResolvedValue({ users: [], total: 0 })
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /^users$/i })).toBeDefined()
    })
  })
})

describe('AdminUsersPage — empty state', () => {
  it('shows "No users found." when API returns empty array', async () => {
    api.admin.users.mockResolvedValue({ users: [], total: 0 })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('No users found.')).toBeDefined()
    })
  })
})

describe('AdminUsersPage — user list', () => {
  it('renders user display names in the table', async () => {
    api.admin.users.mockResolvedValue({ users: [MOCK_USER], total: 1 })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeDefined()
    })
  })

  it('shows "Active" status badge for non-banned user', async () => {
    api.admin.users.mockResolvedValue({ users: [MOCK_USER], total: 1 })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Active')).toBeDefined()
    })
  })

  it('shows "Banned" status badge for banned user', async () => {
    api.admin.users.mockResolvedValue({ users: [BANNED_USER], total: 1 })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Banned')).toBeDefined()
    })
  })
})

describe('AdminUsersPage — online indicator', () => {
  it('shows "Online" badge for an online user', async () => {
    api.admin.users.mockResolvedValue({ users: [ONLINE_USER], total: 1 })
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('online-badge')).toBeDefined()
    })
  })

  it('shows sign-in time below the online badge', async () => {
    api.admin.users.mockResolvedValue({ users: [ONLINE_USER], total: 1 })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('5m ago')).toBeDefined()
    })
  })

  it('does not show "Online" badge for offline user', async () => {
    api.admin.users.mockResolvedValue({ users: [MOCK_USER], total: 1 })
    renderPage()
    await waitFor(() => {
      expect(screen.queryByTestId('online-badge')).toBeNull()
    })
  })
})

describe('AdminUsersPage — error state', () => {
  it('shows error message when api.admin.users rejects', async () => {
    api.admin.users.mockRejectedValue(new Error('network error'))
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('error')).toBeDefined()
      expect(screen.getByTestId('error').textContent).toContain('Failed to load users.')
    })
  })
})

describe('AdminUsersPage — ban/unban buttons', () => {
  it('shows "Ban" button label for active user', async () => {
    api.admin.users.mockResolvedValue({ users: [MOCK_USER], total: 1 })
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^ban$/i })).toBeDefined()
    })
  })

  it('shows "Unban" button label for banned user', async () => {
    api.admin.users.mockResolvedValue({ users: [BANNED_USER], total: 1 })
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^unban$/i })).toBeDefined()
    })
  })

  it('clicking "Ban" calls api.admin.updateUser with { banned: true }', async () => {
    api.admin.users.mockResolvedValue({ users: [MOCK_USER], total: 1 })
    api.admin.updateUser.mockResolvedValue({ user: { ...MOCK_USER, banned: true } })
    renderPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^ban$/i })).toBeDefined()
    })

    fireEvent.click(screen.getByRole('button', { name: /^ban$/i }))

    await waitFor(() => {
      expect(api.admin.updateUser).toHaveBeenCalledWith(
        MOCK_USER.id,
        { banned: true },
        'test-token',
      )
    })
  })
})
