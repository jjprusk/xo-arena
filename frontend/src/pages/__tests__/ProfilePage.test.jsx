import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../lib/useOptimisticSession.js', () => ({
  useOptimisticSession: vi.fn(),
  clearSessionCache: vi.fn(),
}))

vi.mock('../../lib/getToken.js', () => ({
  getToken: () => Promise.resolve('test-token'),
  clearTokenCache: vi.fn(),
}))

vi.mock('../../lib/api.js', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    users: {
      sync: vi.fn(),
      stats: vi.fn(),
      eloHistory: vi.fn(),
      credits: vi.fn(),
      updateSettings: vi.fn(),
    },
    bots: {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      resetElo: vi.fn(),
    },
  },
}))

vi.mock('../../lib/auth-client.js', () => ({
  signOut: vi.fn(),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn() }
})

vi.mock('../../components/ui/ListTable.jsx', () => ({
  ListTable: ({ children }) => <table>{children}</table>,
  ListTh: ({ children }) => <th>{children}</th>,
  ListTr: ({ children, dimmed, last, ...rest }) => <tr {...rest}>{children}</tr>,
  ListTd: ({ children, align }) => <td>{children}</td>,
}))

import { useOptimisticSession } from '../../lib/useOptimisticSession.js'
import { api } from '../../lib/api.js'
import ProfilePage from '../ProfilePage.jsx'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const MOCK_SESSION = { user: { id: 'ba_123', name: 'Alice' } }

const MOCK_DB_USER = {
  id: 'usr_1',
  betterAuthId: 'ba_123',
  displayName: 'Alice',
  username: 'alice',
  eloRating: 1200,
  createdAt: new Date('2024-01-01').toISOString(),
}

const MOCK_STATS = {
  totalGames: 5,
  wins: 3,
  losses: 1,
  draws: 1,
  winRate: 0.6,
  pvp: { wins: 1, played: 2 },
  pvai: {
    novice:       { wins: 1, played: 1 },
    intermediate: { wins: 1, played: 1 },
    advanced:     { wins: 0, played: 1 },
    master:       { wins: 0, played: 0 },
  },
  pvbot: { wins: 0, played: 0 },
}

function renderPage() {
  return render(<MemoryRouter><ProfilePage /></MemoryRouter>)
}

// ─── Setup ───────────────────────────────────────────────────────────────────

const MOCK_CREDITS = {
  hpc: 5, bpc: 2, tc: 0,
  activityScore: 7,
  tier: 0, tierName: 'Bronze', tierIcon: '🥉',
  nextTier: 1, pointsToNextTier: 18,
  emailAchievements: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()

  useOptimisticSession.mockReturnValue({ data: MOCK_SESSION, isPending: false })
  api.users.sync.mockResolvedValue({ user: MOCK_DB_USER })
  api.users.stats.mockResolvedValue({ stats: MOCK_STATS })
  api.users.eloHistory.mockResolvedValue({ history: [] })
  api.users.credits.mockResolvedValue(MOCK_CREDITS)
  api.bots.list.mockResolvedValue({
    bots: [],
    limitInfo: { count: 0, limit: 3 },
    provisionalThreshold: 5,
  })
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ProfilePage — loading state', () => {
  it('shows a spinner when the session is pending and no user yet', () => {
    useOptimisticSession.mockReturnValue({ data: null, isPending: true })
    renderPage()
    // The spinner element has animate-spin class
    const spinner = document.querySelector('.animate-spin')
    expect(spinner).toBeTruthy()
  })

  it('shows a spinner while profile data is being fetched', () => {
    // Delay sync so loading state stays up
    api.users.sync.mockImplementation(() => new Promise(() => {}))
    renderPage()
    const spinner = document.querySelector('.animate-spin')
    expect(spinner).toBeTruthy()
  })
})

describe('ProfilePage — unauthenticated', () => {
  it('shows sign-in prompt when not signed in', () => {
    useOptimisticSession.mockReturnValue({ data: null, isPending: false })
    renderPage()
    expect(screen.getByText('Sign in to view your profile')).toBeDefined()
  })

  it('does not call the API when signed out', () => {
    useOptimisticSession.mockReturnValue({ data: null, isPending: false })
    renderPage()
    expect(api.users.sync).not.toHaveBeenCalled()
  })
})

describe('ProfilePage — loaded state', () => {
  it('shows user displayName after data loads', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeDefined()
    })
  })

  it('shows "Create new bot" button when bots section loads', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('+ Create new bot')).toBeDefined()
    })
  })

  it('shows "You have no bots yet." when bot list is empty', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('You have no bots yet.')).toBeDefined()
    })
  })

  it('shows the Profile page heading', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /profile/i })).toBeDefined()
    })
  })

  it('shows the My Bots section label', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('My Bots')).toBeDefined()
    })
  })
})

describe('ProfilePage — error state', () => {
  it('shows error message when api.users.sync rejects', async () => {
    api.users.sync.mockRejectedValue(new Error('Network error'))
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Failed to load profile.')).toBeDefined()
    })
  })
})

describe('ProfilePage — edit display name', () => {
  it('shows an input field after clicking the Edit button', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeDefined()
    })
    const editButton = screen.getByTitle('Edit display name')
    fireEvent.click(editButton)
    const input = screen.getByDisplayValue('Alice')
    expect(input.tagName.toLowerCase()).toBe('input')
  })

  it('shows Save and Cancel buttons while editing', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTitle('Edit display name')).toBeDefined())
    fireEvent.click(screen.getByTitle('Edit display name'))
    expect(screen.getByRole('button', { name: /save/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDefined()
  })
})

describe('ProfilePage — bot list', () => {
  it('shows a bot name when bots API returns data', async () => {
    api.bots.list.mockResolvedValue({
      bots: [
        {
          id: 'bot_1',
          displayName: 'MyBot',
          botModelType: 'DQN',
          eloRating: 1250,
          botActive: true,
          botProvisional: false,
          botGamesPlayed: 10,
        },
      ],
      limitInfo: { count: 1, limit: 3 },
      provisionalThreshold: 5,
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('MyBot')).toBeDefined()
    })
  })

  it('shows bot model type label in the table', async () => {
    api.bots.list.mockResolvedValue({
      bots: [
        {
          id: 'bot_2',
          displayName: 'AlphaBot',
          botModelType: 'ALPHA_ZERO',
          eloRating: 1400,
          botActive: true,
          botProvisional: false,
          botGamesPlayed: 20,
        },
      ],
      limitInfo: { count: 1, limit: 3 },
      provisionalThreshold: 5,
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('ALPHA_ZERO')).toBeDefined()
    })
  })

  it('shows bot count in limit info', async () => {
    api.bots.list.mockResolvedValue({
      bots: [],
      limitInfo: { count: 2, limit: 3 },
      provisionalThreshold: 5,
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('2 / 3 bots')).toBeDefined()
    })
  })
})

describe('ProfilePage — danger zone', () => {
  it('shows delete account button for non-admin users', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Delete my account…')).toBeDefined()
    })
  })

  it('shows confirmation prompt after clicking delete account', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Delete my account…')).toBeDefined())
    fireEvent.click(screen.getByText('Delete my account…'))
    expect(screen.getByText('Yes, delete my account')).toBeDefined()
  })

  it('hides danger zone for admin users', async () => {
    api.users.sync.mockResolvedValue({
      user: { ...MOCK_DB_USER, baRole: 'admin' },
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('Alice')).toBeDefined())
    expect(screen.queryByText('Delete my account…')).toBeNull()
  })
})

describe('ProfilePage — sessionStorage cache', () => {
  it('skips api.users.sync when cached dbUser is in sessionStorage', async () => {
    sessionStorage.setItem('xo_dbuser_ba_123', JSON.stringify(MOCK_DB_USER))
    renderPage()
    await waitFor(() => expect(screen.getByText('Alice')).toBeDefined())
    expect(api.users.sync).not.toHaveBeenCalled()
  })
})

describe('ProfilePage — credits section', () => {
  it('shows the Credits & Tier section heading', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Credits & Tier')).toBeDefined())
  })

  it('shows the tier name and icon', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Bronze')).toBeDefined())
  })

  it('shows activity score', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/Activity Score: 7/)).toBeDefined())
  })

  it('shows HPC, BPC and TC counts', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTitle('Human Play Credits')).toBeDefined()
      expect(screen.getByTitle('Bot Play Credits')).toBeDefined()
      expect(screen.getByTitle('Tournament Credits')).toBeDefined()
    })
  })

  it('shows points to next tier', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/18 pts to next tier/)).toBeDefined())
  })

  it('does not show credits section when api.users.credits rejects', async () => {
    api.users.credits.mockRejectedValue(new Error('network'))
    renderPage()
    await waitFor(() => expect(screen.getByText('Alice')).toBeDefined())
    expect(screen.queryByText('Credits & Tier')).toBeNull()
  })

  it('shows email achievements toggle', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/Email me when I earn an achievement/)).toBeDefined())
  })

  it('calls api.users.updateSettings when email toggle is clicked', async () => {
    api.users.updateSettings.mockResolvedValue({})
    renderPage()
    await waitFor(() => expect(screen.getByText(/Email me when I earn an achievement/)).toBeDefined())
    const toggleTrack = document.querySelector('[class*="rounded-full"][class*="w-9"]')
    fireEvent.click(toggleTrack)
    await waitFor(() => expect(api.users.updateSettings).toHaveBeenCalledWith({ emailAchievements: true }, 'test-token'))
  })
})
