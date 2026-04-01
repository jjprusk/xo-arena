import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// BotProfilePage uses:
//   useParams()          → { id }
//   useOptimisticSession()
//   api.get('/users/:id')
//   api.get('/users/:id/bot-stats')
//   api.get('/users/:id/elo-history')
//   api.ml.getSessions(mlModel.id)   — only when bot has an mlModel

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useParams: () => ({ id: 'usr_bot_1' }),
    useNavigate: () => vi.fn(),
  }
})

vi.mock('../../lib/useOptimisticSession.js', () => ({
  useOptimisticSession: vi.fn(),
}))

vi.mock('../../lib/getToken.js', () => ({
  getToken: () => Promise.resolve('test-token'),
}))

vi.mock('../../lib/api.js', () => ({
  api: {
    get: vi.fn(),
    ml: {
      getSessions: vi.fn(),
    },
    bots: {
      update: vi.fn(),
    },
  },
}))

import { useOptimisticSession } from '../../lib/useOptimisticSession.js'
import { api } from '../../lib/api.js'
import BotProfilePage from '../BotProfilePage.jsx'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const MOCK_BOT_USER = {
  id: 'usr_bot_1',
  isBot: true,
  displayName: 'TestBot',
  eloRating: 1350,
  botActive: true,
  botProvisional: false,
  botCompetitive: true,
  botAvailable: true,
  botInTournament: false,
  botModelType: 'DQN',
  mlModel: null,
  owner: null,
  ownerBetterAuthId: 'ba_owner_1',
  createdAt: new Date('2024-06-01').toISOString(),
}

const MOCK_BOT_STATS = {
  total: 20,
  vsHumans: { played: 15, wins: 10, rate: 0.667 },
  vsBots: { played: 5, wins: 2, rate: 0.4 },
}

const MOCK_ELO_DATA = {
  currentElo: 1350,
  eloHistory: [],
}

function renderPage() {
  return render(<MemoryRouter><BotProfilePage /></MemoryRouter>)
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()

  useOptimisticSession.mockReturnValue({ data: null })

  // Default: successful responses
  api.get.mockImplementation((path) => {
    if (path === '/users/usr_bot_1') return Promise.resolve({ user: MOCK_BOT_USER })
    if (path === '/users/usr_bot_1/bot-stats') return Promise.resolve({ stats: MOCK_BOT_STATS })
    if (path === '/users/usr_bot_1/elo-history') return Promise.resolve(MOCK_ELO_DATA)
    return Promise.reject(new Error(`Unexpected GET ${path}`))
  })
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('BotProfilePage — loading state', () => {
  it('shows a spinner initially before data loads', () => {
    // Keep requests pending
    api.get.mockImplementation(() => new Promise(() => {}))
    renderPage()
    const spinner = document.querySelector('.animate-spin')
    expect(spinner).toBeTruthy()
  })
})

describe('BotProfilePage — loaded state', () => {
  it('shows bot displayName after data loads', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('TestBot')).toBeDefined()
    })
  })

  it('shows the ELO rating', async () => {
    renderPage()
    await waitFor(() => {
      // currentElo 1350 is rendered as Math.round(eloData?.currentElo ?? bot.eloRating)
      expect(screen.getByText('1350')).toBeDefined()
    })
  })

  it('shows the bot badge', async () => {
    renderPage()
    await waitFor(() => {
      // The "🤖 Bot" badge is always shown for bots
      expect(screen.getByText('🤖 Bot')).toBeDefined()
    })
  })

  it('shows the "Powered by" row with model type label', async () => {
    renderPage()
    await waitFor(() => {
      // botModelType is DQN which maps to label 'DQN'
      expect(screen.getByText('DQN')).toBeDefined()
    })
  })

  it('shows "XO Arena (built-in)" for bots without an owner', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('XO Arena (built-in)')).toBeDefined()
    })
  })

  it('shows back to profile link', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('← Back to profile')).toBeDefined()
    })
  })
})

describe('BotProfilePage — game stats', () => {
  it('shows total games count', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('20')).toBeDefined()
    })
  })

  it('shows vs Humans games played', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('15')).toBeDefined()
    })
  })

  it('shows vs Bots games played', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('5')).toBeDefined()
    })
  })

  it('shows Performance section header', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Performance')).toBeDefined()
    })
  })

  it('does not show Performance section when bot has no stats', async () => {
    api.get.mockImplementation((path) => {
      if (path === '/users/usr_bot_1') return Promise.resolve({ user: MOCK_BOT_USER })
      if (path === '/users/usr_bot_1/bot-stats') return Promise.resolve({ stats: { total: 0, vsHumans: { played: 0, rate: 0 }, vsBots: { played: 0, rate: 0 } } })
      if (path === '/users/usr_bot_1/elo-history') return Promise.resolve(MOCK_ELO_DATA)
      return Promise.reject(new Error(`Unexpected GET ${path}`))
    })
    renderPage()
    // Wait for display name to appear to confirm data has loaded
    await waitFor(() => expect(screen.getByText('TestBot')).toBeDefined())
    expect(screen.queryByText('Performance')).toBeNull()
  })
})

describe('BotProfilePage — error state', () => {
  it('shows error message when the user fetch fails', async () => {
    api.get.mockImplementation(() => Promise.reject(new Error('Not found')))
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Failed to load bot profile.')).toBeDefined()
    })
  })

  it('shows "Not a bot profile." when the user is not a bot', async () => {
    api.get.mockImplementation((path) => {
      if (path === '/users/usr_bot_1') return Promise.resolve({ user: { ...MOCK_BOT_USER, isBot: false } })
      if (path === '/users/usr_bot_1/bot-stats') return Promise.resolve({ stats: MOCK_BOT_STATS })
      if (path === '/users/usr_bot_1/elo-history') return Promise.resolve(MOCK_ELO_DATA)
      return Promise.reject(new Error(`Unexpected GET ${path}`))
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Not a bot profile.')).toBeDefined()
    })
  })

  it('shows back-to-profile link in the error state', async () => {
    api.get.mockImplementation(() => Promise.reject(new Error('Network error')))
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('← Back to profile')).toBeDefined()
    })
  })
})

describe('BotProfilePage — ELO history', () => {
  it('shows Recent ELO changes section when eloHistory has entries', async () => {
    api.get.mockImplementation((path) => {
      if (path === '/users/usr_bot_1') return Promise.resolve({ user: MOCK_BOT_USER })
      if (path === '/users/usr_bot_1/bot-stats') return Promise.resolve({ stats: MOCK_BOT_STATS })
      if (path === '/users/usr_bot_1/elo-history') return Promise.resolve({
        currentElo: 1350,
        eloHistory: [
          { id: 'elo_1', delta: 15, eloRating: 1350, outcome: 'win', opponentType: 'human' },
        ],
      })
      return Promise.reject(new Error(`Unexpected GET ${path}`))
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Recent ELO changes')).toBeDefined()
    })
  })

  it('shows delta value with + prefix for positive ELO change', async () => {
    api.get.mockImplementation((path) => {
      if (path === '/users/usr_bot_1') return Promise.resolve({ user: MOCK_BOT_USER })
      if (path === '/users/usr_bot_1/bot-stats') return Promise.resolve({ stats: MOCK_BOT_STATS })
      if (path === '/users/usr_bot_1/elo-history') return Promise.resolve({
        currentElo: 1350,
        eloHistory: [
          { id: 'elo_1', delta: 20, eloRating: 1350, outcome: 'win', opponentType: 'human' },
        ],
      })
      return Promise.reject(new Error(`Unexpected GET ${path}`))
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('+20')).toBeDefined()
    })
  })
})

describe('BotProfilePage — owner controls', () => {
  it('shows tournament availability section for the bot owner', async () => {
    useOptimisticSession.mockReturnValue({ data: { user: { id: 'ba_owner_1' } } })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Tournament availability')).toBeDefined()
    })
  })

  it('does not show tournament availability section for non-owners', async () => {
    useOptimisticSession.mockReturnValue({ data: { user: { id: 'ba_other_user' } } })
    renderPage()
    await waitFor(() => expect(screen.getByText('TestBot')).toBeDefined())
    expect(screen.queryByText('Tournament availability')).toBeNull()
  })

  it('shows "Opt out" button when bot is available for tournaments', async () => {
    useOptimisticSession.mockReturnValue({ data: { user: { id: 'ba_owner_1' } } })
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Opt out' })).toBeDefined()
    })
  })
})

describe('BotProfilePage — ML training sessions', () => {
  it('shows Training sessions section when sessions exist', async () => {
    const botWithModel = {
      ...MOCK_BOT_USER,
      mlModel: {
        id: 'model_1',
        name: 'TestModel',
        algorithm: 'DQN',
        totalEpisodes: 1000,
        updatedAt: new Date('2025-01-01').toISOString(),
      },
    }
    api.get.mockImplementation((path) => {
      if (path === '/users/usr_bot_1') return Promise.resolve({ user: botWithModel })
      if (path === '/users/usr_bot_1/bot-stats') return Promise.resolve({ stats: MOCK_BOT_STATS })
      if (path === '/users/usr_bot_1/elo-history') return Promise.resolve(MOCK_ELO_DATA)
      return Promise.reject(new Error(`Unexpected GET ${path}`))
    })
    api.ml.getSessions.mockResolvedValue({
      sessions: [
        {
          id: 'sess_1',
          startedAt: new Date('2025-01-01').toISOString(),
          completedAt: new Date('2025-01-01T00:05:00').toISOString(),
          mode: 'self_play',
          iterations: 500,
          status: 'completed',
          summary: { winRate: 0.65, finalEpsilon: 0.01 },
        },
      ],
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Training sessions')).toBeDefined()
    })
  })

  it('does not show Training sessions section when bot has no mlModel', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('TestBot')).toBeDefined())
    expect(screen.queryByText('Training sessions')).toBeNull()
    expect(api.ml.getSessions).not.toHaveBeenCalled()
  })
})
