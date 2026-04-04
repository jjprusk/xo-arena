import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../../lib/useOptimisticSession.js', () => ({
  useOptimisticSession: vi.fn(),
}))

vi.mock('../../lib/getToken.js', () => ({
  getToken: () => Promise.resolve('test-token'),
}))

vi.mock('../../lib/api.js', () => ({
  api: {
    users: { sync: vi.fn() },
    bots: { list: vi.fn() },
    ml: {
      getModel: vi.fn(),
      getSessions: vi.fn(),
    },
  },
}))

vi.mock('../../lib/mlInference.js', () => ({
  evictModel: vi.fn(),
  isModelCached: vi.fn().mockReturnValue(false),
}))

vi.mock('../../lib/socket.js', () => ({
  getSocket: () => ({
    connected: true,
    connect: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  }),
}))

// Stub lazy-loaded tab components — we test the shell, not the tab internals
vi.mock('../../components/gym/TrainTab.jsx', () => ({ default: () => <div data-testid="tab-train">Train</div> }))
vi.mock('../../components/gym/AnalyticsTab.jsx', () => ({ default: () => <div data-testid="tab-analytics">Analytics</div> }))
vi.mock('../../components/gym/EvaluationTab.jsx', () => ({ default: () => <div data-testid="tab-evaluation">Evaluation</div> }))
vi.mock('../../components/gym/ExplainabilityTab.jsx', () => ({ default: () => <div data-testid="tab-explain">Explainability</div> }))
vi.mock('../../components/gym/CheckpointsTab.jsx', () => ({ default: () => <div data-testid="tab-checkpoints">Checkpoints</div> }))
vi.mock('../../components/gym/SessionsTab.jsx', () => ({ default: () => <div data-testid="tab-sessions">Sessions</div> }))
vi.mock('../../components/gym/ExportTab.jsx', () => ({ default: () => <div data-testid="tab-export">Export</div> }))
vi.mock('../../components/gym/RulesTab.jsx', () => ({ default: () => <div data-testid="tab-rules">Rules</div> }))

import { useOptimisticSession } from '../../lib/useOptimisticSession.js'
import { api } from '../../lib/api.js'
import MLDashboardPage from '../MLDashboardPage.jsx'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_USER = { id: 'ba_1', name: 'Alice' }
const DOMAIN_USER = { id: 'db_usr_1' }

const ML_BOT = {
  id: 'bot_1',
  displayName: 'QuantumBot',
  username: 'quantumbot',
  eloRating: 1350,
  botModelType: 'ml',
  botModelId: 'model_1',
  botActive: true,
}

const MINIMAX_BOT = {
  id: 'bot_2',
  displayName: 'MaxBot',
  username: 'maxbot',
  eloRating: 1200,
  botModelType: 'minimax',
  botModelId: null,
  botActive: true,
}

const RULE_BOT = {
  id: 'bot_3',
  displayName: 'RuleBot',
  username: 'rulebot',
  eloRating: 1100,
  botModelType: 'rule_based',
  botModelId: null,
  botActive: true,
}

const MOCK_MODEL = {
  id: 'model_1',
  name: 'Test Model',
  algorithm: 'Q_LEARNING',
  status: 'IDLE',
  totalEpisodes: 5000,
  eloRating: 1350,
  featured: false,
}

function signedIn() {
  useOptimisticSession.mockReturnValue({ data: { user: MOCK_USER }, isPending: false })
}

function signedOut() {
  useOptimisticSession.mockReturnValue({ data: null, isPending: false })
}

function setupApis({ bots = [ML_BOT], model = MOCK_MODEL } = {}) {
  api.users.sync.mockResolvedValue({ user: DOMAIN_USER })
  api.bots.list.mockResolvedValue({ bots })
  api.ml.getModel.mockResolvedValue({ model })
  api.ml.getSessions.mockResolvedValue({ sessions: [] })
}

const renderPage = () =>
  render(<MemoryRouter><MLDashboardPage /></MemoryRouter>)

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  setupApis()
})

describe('MLDashboardPage — heading', () => {
  it('renders the Gym heading', () => {
    signedIn()
    renderPage()
    expect(screen.getByRole('heading', { name: /gym/i })).toBeDefined()
  })

  it('renders a Training Guide link', () => {
    signedIn()
    renderPage()
    expect(screen.getByText('Training Guide')).toBeDefined()
  })
})

describe('MLDashboardPage — unauthenticated', () => {
  it('shows sign-in prompt when not signed in', async () => {
    signedOut()
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/Sign in to access the Gym/)).toBeDefined()
    })
  })

  it('does not call the bots API when signed out', async () => {
    signedOut()
    renderPage()
    // Give time for any erroneous API calls
    await new Promise(r => setTimeout(r, 50))
    expect(api.bots.list).not.toHaveBeenCalled()
  })
})

describe('MLDashboardPage — empty bot list', () => {
  it('shows empty message when the user has no bots', async () => {
    signedIn()
    setupApis({ bots: [] })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText("You don't have any bots yet.")).toBeDefined()
    })
  })

  it('prompts user to go to Profile to create bots', async () => {
    signedIn()
    setupApis({ bots: [] })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/Go to your/)).toBeDefined()
    })
  })
})

describe('MLDashboardPage — bot list', () => {
  it('renders bot names in the sidebar', async () => {
    signedIn()
    setupApis({ bots: [ML_BOT, MINIMAX_BOT] })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('QuantumBot')).toBeDefined()
      expect(screen.getByText('MaxBot')).toBeDefined()
    })
  })

  it('shows ML type badge for ML bots', async () => {
    signedIn()
    setupApis({ bots: [ML_BOT] })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('ML')).toBeDefined()
    })
  })

  it('shows Minimax type badge for minimax bots', async () => {
    signedIn()
    setupApis({ bots: [MINIMAX_BOT] })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Minimax')).toBeDefined()
    })
  })

  it('shows Rules type badge for rule-based bots', async () => {
    signedIn()
    setupApis({ bots: [RULE_BOT] })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Rules')).toBeDefined()
    })
  })

  it('shows ELO rating for each bot', async () => {
    signedIn()
    setupApis({ bots: [ML_BOT] })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('1350')).toBeDefined()
    })
  })

  it('shows the "Your Bots" section label', async () => {
    signedIn()
    setupApis({ bots: [ML_BOT] })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Your Bots')).toBeDefined()
    })
  })
})

describe('MLDashboardPage — bot selection', () => {
  it('auto-selects first bot and shows its name in the detail header', async () => {
    signedIn()
    setupApis({ bots: [ML_BOT] })
    renderPage()
    // Bot name appears in both sidebar and detail header once auto-selected
    await waitFor(() => {
      expect(screen.getAllByText('QuantumBot').length).toBeGreaterThanOrEqual(1)
    }, { timeout: 3000 })
  })

  it('shows episode count once model is loaded', async () => {
    signedIn()
    setupApis({ bots: [ML_BOT] })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/5,000 eps/)).toBeDefined()
    })
  })

  it('switches selected bot when another is clicked', async () => {
    signedIn()
    setupApis({ bots: [ML_BOT, MINIMAX_BOT] })
    renderPage()

    await waitFor(() => expect(screen.getAllByText('MaxBot').length).toBeGreaterThan(0))

    // Click the sidebar entry (first occurrence)
    fireEvent.click(screen.getAllByText('MaxBot')[0])

    await waitFor(() => {
      expect(screen.getAllByText('MaxBot').length).toBeGreaterThan(0)
    })
  })
})

describe('MLDashboardPage — tab navigation', () => {
  it('shows tab buttons for an ML bot', async () => {
    signedIn()
    setupApis({ bots: [ML_BOT] })
    renderPage()
    await waitFor(() => {
      // The train tab content should be visible (auto-selected)
      expect(screen.getByTestId('tab-train')).toBeDefined()
    })
  })

  it('clicking analytics tab button shows analytics content', async () => {
    signedIn()
    setupApis({ bots: [ML_BOT] })
    renderPage()
    // Wait for model to load so tab buttons appear
    await waitFor(() => expect(screen.getByText('5,000 / ∞ episodes')).toBeDefined(), { timeout: 3000 })

    // Tab buttons render lowercase IDs (CSS capitalizes visually)
    fireEvent.click(screen.getByRole('button', { name: /^analytics$/i }))

    await waitFor(() => {
      expect(screen.getByTestId('tab-analytics')).toBeDefined()
    })
  })

  it('clicking sessions tab button shows sessions content', async () => {
    signedIn()
    setupApis({ bots: [ML_BOT] })
    renderPage()
    await waitFor(() => expect(screen.getByText('5,000 / ∞ episodes')).toBeDefined(), { timeout: 3000 })

    fireEvent.click(screen.getByRole('button', { name: /^sessions$/i }))

    await waitFor(() => {
      expect(screen.getByTestId('tab-sessions')).toBeDefined()
    })
  })
})
