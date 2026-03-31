import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../../../lib/api.js', () => ({
  api: {
    admin: {
      games: vi.fn(),
      deleteGame: vi.fn(),
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
import AdminGamesPage from '../AdminGamesPage.jsx'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const MOCK_GAME = {
  id: 'game_1',
  player1: { displayName: 'Alice' },
  player2: { displayName: 'Bob' },
  mode: 'PVP',
  outcome: 'PLAYER1_WIN',
  totalMoves: 9,
  durationMs: 45000,
  endedAt: '2026-01-01T00:00:00Z',
  difficulty: null,
}

const renderPage = () =>
  render(<MemoryRouter><AdminGamesPage /></MemoryRouter>)

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AdminGamesPage — heading', () => {
  it('renders "Games" heading', async () => {
    api.admin.games.mockResolvedValue({ games: [], total: 0 })
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /^games$/i })).toBeDefined()
    })
  })
})

describe('AdminGamesPage — empty state', () => {
  it('shows "No games found." when API returns empty array', async () => {
    api.admin.games.mockResolvedValue({ games: [], total: 0 })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('No games found.')).toBeDefined()
    })
  })
})

describe('AdminGamesPage — error state', () => {
  it('shows error message when API rejects', async () => {
    api.admin.games.mockRejectedValue(new Error('network error'))
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('error')).toBeDefined()
      expect(screen.getByTestId('error').textContent).toContain('Failed to load games.')
    })
  })
})

describe('AdminGamesPage — game list', () => {
  it('renders player names in the table', async () => {
    api.admin.games.mockResolvedValue({ games: [MOCK_GAME], total: 1 })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeDefined()
      expect(screen.getByText(/vs Bob/)).toBeDefined()
    })
  })

  it('shows "PvP" mode label for PVP mode game', async () => {
    api.admin.games.mockResolvedValue({ games: [MOCK_GAME], total: 1 })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('PvP')).toBeDefined()
    })
  })

  it('shows "P1 Win" outcome label for PLAYER1_WIN', async () => {
    api.admin.games.mockResolvedValue({ games: [MOCK_GAME], total: 1 })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('P1 Win')).toBeDefined()
    })
  })
})

describe('AdminGamesPage — delete', () => {
  it('delete button calls deleteGame with correct id on click', async () => {
    api.admin.games.mockResolvedValue({ games: [MOCK_GAME], total: 1 })
    api.admin.deleteGame.mockResolvedValue({})
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /✕/ })).toBeDefined()
    })

    fireEvent.click(screen.getByRole('button', { name: /✕/ }))

    await waitFor(() => {
      expect(api.admin.deleteGame).toHaveBeenCalledWith('game_1', 'test-token')
    })
  })
})
