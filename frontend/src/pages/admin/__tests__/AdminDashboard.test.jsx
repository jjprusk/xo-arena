import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../../../lib/api.js', () => ({
  api: {
    admin: {
      stats: vi.fn(),
      getMLLimits: vi.fn(),
      setMLLimits: vi.fn(),
      getLogLimit: vi.fn(),
      setLogLimit: vi.fn(),
    },
  },
}))

vi.mock('../../../lib/getToken.js', () => ({
  getToken: () => Promise.resolve('test-token'),
}))

import { api } from '../../../lib/api.js'
import AdminDashboard from '../AdminDashboard.jsx'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_STATS = {
  totalUsers: 42,
  totalGames: 150,
  gamesToday: 7,
  bannedUsers: 1,
  totalModels: 5,
}

const MOCK_LIMITS = {
  maxEpisodesPerModel: 10000,
  maxEpisodesPerSession: 1000,
  maxConcurrentSessions: 5,
  maxModelsPerUser: 3,
  dqnDefaultHiddenLayers: [32],
  dqnMaxHiddenLayers: 3,
  dqnMaxUnitsPerLayer: 256,
}

// Helper: never-resolving promise keeps sub-panels in loading state
const pending = () => new Promise(() => {})

const renderPage = () =>
  render(<MemoryRouter><AdminDashboard /></MemoryRouter>)

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  // Default: stats resolves, panels stay pending (no panel sections rendered)
  api.admin.stats.mockResolvedValue({ stats: MOCK_STATS })
  api.admin.getMLLimits.mockReturnValue(pending())
  api.admin.getLogLimit.mockReturnValue(pending())
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AdminDashboard — heading', () => {
  it('renders "Admin" heading', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /^admin$/i })).toBeDefined()
  })
})

describe('AdminDashboard — loading state', () => {
  it('shows spinner while stats are loading', () => {
    api.admin.stats.mockReturnValue(pending())
    renderPage()
    // The Spinner renders a spinning div; confirm loading state by absence of stat tiles
    expect(screen.queryByText('Total Users')).toBeNull()
  })
})

describe('AdminDashboard — error state', () => {
  it('shows error message when api.admin.stats rejects', async () => {
    api.admin.stats.mockRejectedValue(new Error('network error'))
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Failed to load stats.')).toBeDefined()
    })
  })
})

describe('AdminDashboard — stat tiles', () => {
  it('shows Total Users tile with correct value', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Total Users')).toBeDefined()
    })
    expect(screen.getByText('42')).toBeDefined()
  })

  it('shows Total Games tile with correct value', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Total Games')).toBeDefined()
    })
    expect(screen.getByText('150')).toBeDefined()
  })

  it('shows Games Today tile with correct value', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Games Today')).toBeDefined()
    })
    expect(screen.getByText('7')).toBeDefined()
  })
})

describe('AdminDashboard — quick links', () => {
  it('shows all 6 quick links', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('User Management')).toBeDefined()
    })
    expect(screen.getByText('Game Log')).toBeDefined()
    expect(screen.getAllByText('ML Models').length).toBeGreaterThan(0)
    expect(screen.getByText('Bot Management')).toBeDefined()
    expect(screen.getByText('AI Metrics')).toBeDefined()
    expect(screen.getByText('Log Viewer')).toBeDefined()
  })
})

describe('AdminDashboard — MLLimitsPanel', () => {
  it('renders nothing for ML Training Limits while limits are pending', async () => {
    api.admin.stats.mockReturnValue(pending())
    renderPage()
    // Give microtasks a chance to run
    await new Promise(r => setTimeout(r, 50))
    expect(screen.queryByText('ML Training Limits')).toBeNull()
  })

  it('shows "ML Training Limits" section once limits resolve', async () => {
    api.admin.getMLLimits.mockResolvedValue({ limits: MOCK_LIMITS })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('ML Training Limits')).toBeDefined()
    })
  })
})

describe('AdminDashboard — LogRetentionPanel', () => {
  it('shows "Log Retention" section once log limit resolves', async () => {
    api.admin.getLogLimit.mockResolvedValue({ maxEntries: 50000 })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Log Retention')).toBeDefined()
    })
  })
})
