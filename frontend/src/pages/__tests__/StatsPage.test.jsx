import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../lib/useOptimisticSession.js', () => ({
  useOptimisticSession: vi.fn(),
}))

vi.mock('../../lib/getToken.js', () => ({
  getToken: () => Promise.resolve('test-token'),
}))

vi.mock('../../lib/api.js', () => ({
  api: {
    users: {
      sync: vi.fn(),
      stats: vi.fn(),
      eloHistory: vi.fn(),
      mlProfiles: vi.fn(),
    },
  },
}))

vi.mock('../../components/ui/Skeleton.jsx', () => ({
  StatsSkeleton: () => <div data-testid="stats-skeleton">Loading...</div>,
}))

import { useOptimisticSession } from '../../lib/useOptimisticSession.js'
import { api } from '../../lib/api.js'
import StatsPage from '../StatsPage.jsx'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_USER = { id: 'ba_1', name: 'Alice' }

const MOCK_STATS = {
  totalGames: 20,
  wins: 14,
  draws: 2,
  winRate: 0.7,
  hvh: { rate: 0.6, played: 10 },
  hva: {
    novice:       { rate: 0.9, played: 3 },
    intermediate: { rate: 0.7, played: 3 },
    advanced:     { rate: 0.5, played: 2 },
    master:       { rate: 0.2, played: 2 },
  },
  hvb: { played: 0, rate: 0, byBot: {} },
  recentGames: [],
}

const MOCK_ELO = {
  currentElo: 1350,
  eloHistory: [{ delta: 12 }],
}

function signedIn(overrides = {}) {
  useOptimisticSession.mockReturnValue({
    data: { user: { ...MOCK_USER, ...overrides } },
    isPending: false,
  })
}

function signedOut() {
  useOptimisticSession.mockReturnValue({ data: null, isPending: false })
}

function pending() {
  useOptimisticSession.mockReturnValue({ data: null, isPending: true })
}

function setupApis({ stats = MOCK_STATS, elo = MOCK_ELO, profiles = null } = {}) {
  api.users.sync.mockResolvedValue({ user: { id: 'db_usr_1' } })
  api.users.stats.mockResolvedValue({ stats })
  api.users.eloHistory.mockResolvedValue(elo)
  api.users.mlProfiles.mockResolvedValue(profiles ? { profiles } : null)
}

const renderPage = () =>
  render(<MemoryRouter><StatsPage /></MemoryRouter>)

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  // Clear sessionStorage between tests to avoid cache hits
  sessionStorage.clear()
  setupApis()
})

describe('StatsPage — unauthenticated', () => {
  it('shows sign-in prompt when not signed in', () => {
    signedOut()
    renderPage()
    expect(screen.getByText('Sign in to see your stats')).toBeDefined()
  })

  it('shows the Stats heading when signed out', () => {
    signedOut()
    renderPage()
    expect(screen.getByRole('heading', { name: /stats/i })).toBeDefined()
  })

  it('does not call the API when signed out', () => {
    signedOut()
    renderPage()
    expect(api.users.stats).not.toHaveBeenCalled()
  })
})

describe('StatsPage — loading', () => {
  it('shows skeleton while auth is pending with no data', () => {
    pending()
    renderPage()
    expect(screen.getByTestId('stats-skeleton')).toBeDefined()
  })

  it('shows skeleton while fetching stats', async () => {
    signedIn()
    // delay the stats response so the loading state is visible
    api.users.stats.mockImplementation(() => new Promise(() => {}))
    renderPage()
    expect(screen.getByTestId('stats-skeleton')).toBeDefined()
  })
})

describe('StatsPage — error state', () => {
  it('shows error message when stats fetch fails', async () => {
    signedIn()
    api.users.stats.mockRejectedValue(new Error('Network error'))
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Failed to load stats.')).toBeDefined()
    })
  })
})

describe('StatsPage — no games yet', () => {
  it('shows "No games yet" empty state when totalGames is 0', async () => {
    signedIn()
    setupApis({ stats: { ...MOCK_STATS, totalGames: 0, recentGames: [] } })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('No games yet')).toBeDefined()
    })
  })
})

describe('StatsPage — with stats', () => {
  it('renders the Stats heading', async () => {
    signedIn()
    renderPage()
    await waitFor(() => expect(screen.getByRole('heading', { name: /stats/i })).toBeDefined())
  })

  it('shows total games count', async () => {
    signedIn()
    renderPage()
    await waitFor(() => expect(screen.getByText('20')).toBeDefined())
  })

  it('shows win percentage', async () => {
    signedIn()
    renderPage()
    // winRate 0.7 → 70% — appears in the MiniStat strip
    await waitFor(() => {
      const matches = screen.getAllByText('70%')
      expect(matches.length).toBeGreaterThan(0)
    })
  })

  it('shows wins count', async () => {
    signedIn()
    renderPage()
    await waitFor(() => expect(screen.getByText('14')).toBeDefined())
  })

  it('shows draws count', async () => {
    signedIn()
    renderPage()
    await waitFor(() => expect(screen.getByText('2')).toBeDefined())
  })

  it('shows "Win Rate by Mode" section', async () => {
    signedIn()
    renderPage()
    await waitFor(() => expect(screen.getByText('Win Rate by Mode')).toBeDefined())
  })

  it('shows all four AI difficulty bars', async () => {
    signedIn()
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/Rusty/)).toBeDefined()
      expect(screen.getByText(/Copper/)).toBeDefined()
      expect(screen.getByText(/Sterling/)).toBeDefined()
      expect(screen.getByText(/Magnus/)).toBeDefined()
    })
  })

  it('shows "vs Humans" win rate bar', async () => {
    signedIn()
    renderPage()
    await waitFor(() => expect(screen.getByText('vs Humans')).toBeDefined())
  })

  it('displays ELO rating from eloHistory', async () => {
    signedIn()
    renderPage()
    await waitFor(() => expect(screen.getByText('1350')).toBeDefined())
  })

  it('shows positive ELO delta with + prefix', async () => {
    signedIn()
    renderPage()
    await waitFor(() => expect(screen.getByText('+12')).toBeDefined())
  })
})

describe('StatsPage — recent games', () => {
  it('shows recent games section when games exist', async () => {
    const recentGames = [
      { winnerId: 'db_usr_1', outcome: 'WIN', mode: 'HVH', difficulty: null, player2: null },
      { winnerId: null, outcome: 'DRAW', mode: 'HVA', difficulty: 'novice', player2: null },
    ]
    signedIn()
    setupApis({ stats: { ...MOCK_STATS, totalGames: 2, recentGames } })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/Last \d+ Games/)).toBeDefined()
    })
  })

  it('does not show recent games section when list is empty', async () => {
    signedIn()
    setupApis({ stats: { ...MOCK_STATS, recentGames: [] } })
    renderPage()
    await waitFor(() => expect(screen.getByText('14')).toBeDefined()) // wins count, unique on page
    expect(screen.queryByText(/Last \d+ Games/)).toBeNull()
  })
})

describe('StatsPage — bot challenges', () => {
  it('shows Bot Challenges section when hvb games exist', async () => {
    const pvbot = {
      played: 3,
      rate: 0.33,
      byBot: {
        bot_1: {
          bot: { id: 'bot_1', displayName: 'TestBot', avatarUrl: null },
          played: 3,
          rate: 0.33,
        },
      },
    }
    signedIn()
    setupApis({ stats: { ...MOCK_STATS, hvb: pvbot } })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Bot Challenges')).toBeDefined()
      expect(screen.getByText('TestBot')).toBeDefined()
    })
  })

  it('does not show Bot Challenges when no hvb games', async () => {
    signedIn()
    renderPage()
    await waitFor(() => expect(screen.getByText('14')).toBeDefined()) // wins count, unique on page
    expect(screen.queryByText('Bot Challenges')).toBeNull()
  })
})

describe('StatsPage — ML behavior profiles', () => {
  it('shows AI Behavior Profiles section when profiles exist', async () => {
    const profiles = [
      {
        id: 'prof_1',
        modelId: 'model_1',
        model: { name: 'AlphaBot' },
        gamesRecorded: 5,
        updatedAt: new Date().toISOString(),
        tendencies: { centerRate: 0.4, cornerRate: 0.3 },
        openingPreferences: {},
      },
    ]
    signedIn()
    setupApis({ profiles })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('AI Behavior Profiles')).toBeDefined()
    })
  })

  it('does not show AI Behavior Profiles when no profiles', async () => {
    signedIn()
    setupApis({ profiles: null })
    renderPage()
    await waitFor(() => expect(screen.getByText('14')).toBeDefined()) // wins count, unique on page
    expect(screen.queryByText('AI Behavior Profiles')).toBeNull()
  })
})
