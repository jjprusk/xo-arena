// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Phase B.3 — RankingsPage shows a ChallengeButton (icon variant) on
 * every bot row and "—" on every human row. This test only covers the
 * new Play column; full Rankings coverage is intentionally not in scope.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const { mockUseSWRish, mockUseSession } = vi.hoisted(() => ({
  mockUseSWRish:  vi.fn(),
  mockUseSession: vi.fn(),
}))

vi.mock('../../lib/swr.js', () => ({
  useSWRish: mockUseSWRish,
}))
vi.mock('../../lib/useOptimisticSession.js', () => ({
  useOptimisticSession: mockUseSession,
}))
vi.mock('../../lib/api.js', () => ({
  api: { get: vi.fn() },
}))
vi.mock('../../lib/rtSession.js', () => ({
  rtFetch: vi.fn().mockResolvedValue({ slug: 's1' }),
}))

import RankingsPage from '../RankingsPage.jsx'

const LB = {
  leaderboard: [
    { rank: 1, user: { id: 'u_h', displayName: 'Alice', isBot: false }, total: 50, wins: 30, winRate: 0.6 },
    { rank: 2, user: { id: 'u_b', displayName: 'BotA',  isBot: true  }, total: 80, wins: 60, winRate: 0.75 },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseSession.mockReturnValue({ data: null, isPending: false })
  mockUseSWRish.mockReturnValue({ data: LB, isLoading: false, isStale: false })
})

function renderPage() {
  return render(
    <MemoryRouter>
      <RankingsPage />
    </MemoryRouter>,
  )
}

describe('<RankingsPage /> — challenge column', () => {
  it('renders exactly one challenge button — for the bot row', async () => {
    renderPage()
    await waitFor(() => expect(screen.getAllByText(/Alice|BotA/).length).toBeGreaterThan(0))
    const buttons = screen.getAllByTestId('challenge-button')
    expect(buttons).toHaveLength(1)
  })

  it('the challenge button on the bot row carries source="rankings"', async () => {
    renderPage()
    await waitFor(() => expect(screen.getAllByTestId('challenge-button').length).toBe(1))
    expect(screen.getByTestId('challenge-button').getAttribute('data-source')).toBe('rankings')
  })

  it('shows an em-dash on the human row Play cell', async () => {
    renderPage()
    await waitFor(() => expect(screen.getAllByText(/Alice|BotA/).length).toBeGreaterThan(0))
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1)
  })
})
