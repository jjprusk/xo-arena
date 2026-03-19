import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

vi.mock('../../lib/api.js', () => ({
  api: {
    get: vi.fn(),
  },
}))

import { api } from '../../lib/api.js'
import LeaderboardPage from '../LeaderboardPage.jsx'

const MOCK_LEADERBOARD = [
  {
    rank: 1,
    user: { id: 'u1', displayName: 'Alice', avatarUrl: null },
    total: 20,
    wins: 16,
    winRate: 0.8,
  },
  {
    rank: 2,
    user: { id: 'u2', displayName: 'Bob', avatarUrl: null },
    total: 15,
    wins: 9,
    winRate: 0.6,
  },
  {
    rank: 3,
    user: { id: 'u3', displayName: 'Carol', avatarUrl: null },
    total: 10,
    wins: 5,
    winRate: 0.5,
  },
]

beforeEach(() => {
  api.get.mockResolvedValue({ leaderboard: MOCK_LEADERBOARD })
})

describe('LeaderboardPage', () => {
  it('renders heading', async () => {
    render(<LeaderboardPage />)
    expect(screen.getByRole('heading', { name: /leaderboard/i })).toBeInTheDocument()
  })

  it('shows period and mode filter buttons', async () => {
    render(<LeaderboardPage />)
    // "all" appears in both period and mode filters — use getAllByRole
    expect(screen.getAllByRole('button', { name: /^all$/i }).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('button', { name: /monthly/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /weekly/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^pvp$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^pvai$/i })).toBeInTheDocument()
  })

  it('fetches and displays player names', async () => {
    render(<LeaderboardPage />)
    // Names appear in both podium and table — use getAllByText
    await waitFor(() => expect(screen.getAllByText('Alice').length).toBeGreaterThan(0))
    expect(screen.getAllByText('Bob').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Carol').length).toBeGreaterThan(0)
  })

  it('displays win rates', async () => {
    render(<LeaderboardPage />)
    await waitFor(() => expect(screen.getAllByText('Alice').length).toBeGreaterThan(0))
    expect(screen.getAllByText('80%').length).toBeGreaterThan(0)
    expect(screen.getAllByText('60%').length).toBeGreaterThan(0)
  })

  it('renders podium for top 3', async () => {
    render(<LeaderboardPage />)
    await waitFor(() => expect(screen.getAllByText('Alice').length).toBeGreaterThan(0))
    expect(screen.getByText('👑')).toBeInTheDocument()
    expect(screen.getByText('🥈')).toBeInTheDocument()
    expect(screen.getByText('🥉')).toBeInTheDocument()
  })

  it('shows rank numbers in table', async () => {
    render(<LeaderboardPage />)
    await waitFor(() => expect(screen.getAllByText('Alice').length).toBeGreaterThan(0))
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('filters players by search input', async () => {
    render(<LeaderboardPage />)
    await waitFor(() => expect(screen.getAllByText('Alice').length).toBeGreaterThan(0))

    const search = screen.getByPlaceholderText(/search player/i)
    fireEvent.change(search, { target: { value: 'bob' } })

    expect(screen.queryByText('Alice')).not.toBeInTheDocument()
    expect(screen.getAllByText('Bob').length).toBeGreaterThan(0)
  })

  it('shows empty state when no players', async () => {
    api.get.mockResolvedValueOnce({ leaderboard: [] })
    render(<LeaderboardPage />)
    await waitFor(() => expect(screen.getByText(/no players yet/i)).toBeInTheDocument())
  })

  it('refetches when period filter changes', async () => {
    render(<LeaderboardPage />)
    await waitFor(() => expect(screen.getAllByText('Alice').length).toBeGreaterThan(0))

    fireEvent.click(screen.getByRole('button', { name: 'weekly' }))
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(expect.stringContaining('period=weekly')))
  })
})
