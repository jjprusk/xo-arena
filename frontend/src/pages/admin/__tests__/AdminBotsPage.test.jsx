import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../../../lib/api.js', () => ({
  api: {
    admin: {
      listBots: vi.fn(),
      updateBot: vi.fn(),
      deleteBot: vi.fn(),
      getAivaiConfig: vi.fn(),
      setAivaiConfig: vi.fn(),
    },
    botGames: {
      start: vi.fn(),
    },
  },
}))

vi.mock('../../../lib/getToken.js', () => ({
  getToken: () => Promise.resolve('test-token'),
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
  ListTd: ({ children }) => <td>{children}</td>,
  ListTr: ({ children }) => <tr>{children}</tr>,
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

import { api } from '../../../lib/api.js'
import AdminBotsPage from '../AdminBotsPage.jsx'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_BOT = {
  id: 'bot_1',
  displayName: 'QuantumBot',
  username: 'quantumbot',
  eloRating: 1350,
  botModelType: 'ml',
  botActive: true,
  botAvailable: true,
  botInTournament: false,
  botProvisional: false,
  avatarUrl: null,
  owner: { displayName: 'Alice', username: 'alice' },
}

const INACTIVE_BOT = { ...MOCK_BOT, id: 'bot_2', displayName: 'SleepyBot', botActive: false }

const renderPage = () =>
  render(<MemoryRouter><AdminBotsPage /></MemoryRouter>)

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  // getAivaiConfig always resolves to avoid unhandled rejections
  api.admin.getAivaiConfig.mockResolvedValue({ maxGames: 5 })
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AdminBotsPage — heading', () => {
  it('renders "Bots" heading', async () => {
    api.admin.listBots.mockResolvedValue({ bots: [], total: 0 })
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /^bots$/i })).toBeDefined()
    })
  })
})

describe('AdminBotsPage — empty state', () => {
  it('shows "No bots found." when API returns empty array', async () => {
    api.admin.listBots.mockResolvedValue({ bots: [], total: 0 })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('No bots found.')).toBeDefined()
    })
  })
})

describe('AdminBotsPage — bot list', () => {
  it('renders bot displayName in the table', async () => {
    api.admin.listBots.mockResolvedValue({ bots: [MOCK_BOT], total: 1 })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('QuantumBot')).toBeDefined()
    })
  })

  it('shows "Active" status for active bot', async () => {
    api.admin.listBots.mockResolvedValue({ bots: [MOCK_BOT], total: 1 })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Active')).toBeDefined()
    })
  })

  it('shows "Inactive" status for inactive bot', async () => {
    api.admin.listBots.mockResolvedValue({ bots: [INACTIVE_BOT], total: 1 })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Inactive')).toBeDefined()
    })
  })

  it('shows bot owner name in the table', async () => {
    api.admin.listBots.mockResolvedValue({ bots: [MOCK_BOT], total: 1 })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeDefined()
    })
  })
})

describe('AdminBotsPage — action buttons', () => {
  it('shows "Disable" button for active bot', async () => {
    api.admin.listBots.mockResolvedValue({ bots: [MOCK_BOT], total: 1 })
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^disable$/i })).toBeDefined()
    })
  })

  it('shows "Enable" button for inactive bot', async () => {
    api.admin.listBots.mockResolvedValue({ bots: [INACTIVE_BOT], total: 1 })
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^enable$/i })).toBeDefined()
    })
  })

  it('clicking "Disable" calls api.admin.updateBot with { botActive: false }', async () => {
    api.admin.listBots.mockResolvedValue({ bots: [MOCK_BOT], total: 1 })
    api.admin.updateBot.mockResolvedValue({ bot: { ...MOCK_BOT, botActive: false } })
    renderPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^disable$/i })).toBeDefined()
    })

    fireEvent.click(screen.getByRole('button', { name: /^disable$/i }))

    await waitFor(() => {
      expect(api.admin.updateBot).toHaveBeenCalledWith(
        MOCK_BOT.id,
        { botActive: false },
        'test-token',
      )
    })
  })
})

describe('AdminBotsPage — error state', () => {
  it('shows error message when api.admin.listBots rejects', async () => {
    api.admin.listBots.mockRejectedValue(new Error('network error'))
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('error')).toBeDefined()
      expect(screen.getByTestId('error').textContent).toContain('Failed to load bots.')
    })
  })
})

describe('AdminBotsPage — Start Bot vs Bot panel', () => {
  it('"Start Bot vs Bot Game" panel is visible', async () => {
    api.admin.listBots.mockResolvedValue({ bots: [], total: 0 })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Start Bot vs Bot Game')).toBeDefined()
    })
  })
})
