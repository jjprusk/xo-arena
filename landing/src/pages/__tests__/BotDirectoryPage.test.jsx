// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const { mockUseBots, mockUseSession } = vi.hoisted(() => ({
  mockUseBots:    vi.fn(),
  mockUseSession: vi.fn(),
}))

vi.mock('../../lib/useBots.js', () => ({
  useBots: mockUseBots,
}))
vi.mock('../../lib/useOptimisticSession.js', () => ({
  useOptimisticSession: mockUseSession,
}))
// ChallengeButton needs no real network in this page test — its own
// suite covers its behaviour. Keep it real-rendered so the data-testid
// shows up for "is the icon button there per row" assertions.
vi.mock('../../lib/rtSession.js', () => ({
  rtFetch: vi.fn().mockResolvedValue({ slug: 's1' }),
}))

import BotDirectoryPage from '../BotDirectoryPage.jsx'

beforeEach(() => {
  vi.clearAllMocks()
  mockUseSession.mockReturnValue({ data: null, isPending: false })
})

const BOTS = [
  { id: 'b_a', displayName: 'Sterling',     botOwnerId: 'u1', gameElo: [{ rating: 1500 }], botGamesPlayed: 50 },
  { id: 'b_b', displayName: 'Copper',       botOwnerId: null, gameElo: [{ rating: 1100 }], botGamesPlayed: 100 },
]

function renderAt(initialEntry = '/bots') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/bots" element={<BotDirectoryPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('<BotDirectoryPage />', () => {
  it('renders the page heading + active-count line', () => {
    mockUseBots.mockReturnValue({ bots: BOTS, allBots: BOTS, isLoading: false, isStale: false, error: null })
    renderAt()
    expect(screen.getByText('Bots')).toBeTruthy()
    expect(screen.getByText(/2 active/)).toBeTruthy()
  })

  it('renders a row per filtered bot, each with a challenge icon', () => {
    mockUseBots.mockReturnValue({ bots: BOTS, allBots: BOTS, isLoading: false, isStale: false, error: null })
    renderAt()
    expect(screen.getByTestId('bot-directory-row-b_a')).toBeTruthy()
    expect(screen.getByTestId('bot-directory-row-b_b')).toBeTruthy()
    // Each row owns a ChallengeButton (data-testid="challenge-button")
    expect(screen.getAllByTestId('challenge-button')).toHaveLength(2)
  })

  it('shows the loading state when isLoading=true and no cached bots', () => {
    mockUseBots.mockReturnValue({ bots: [], allBots: [], isLoading: true, isStale: false, error: null })
    renderAt()
    expect(screen.getByTestId('bot-directory-loading')).toBeTruthy()
  })

  it('shows the empty state with a Reset filters action when filtered list is empty', () => {
    mockUseBots.mockReturnValue({ bots: [], allBots: BOTS, isLoading: false, isStale: false, error: null })
    renderAt('/bots?owner=mine')
    const empty = screen.getByTestId('bot-directory-empty')
    expect(empty).toBeTruthy()
    expect(empty.textContent).toMatch(/No bots match/i)
    expect(empty.querySelector('button')).toBeTruthy()
  })

  it('surfaces a fetch error via an inline alert', () => {
    mockUseBots.mockReturnValue({ bots: [], allBots: [], isLoading: false, isStale: false, error: new Error('boom') })
    renderAt()
    expect(screen.getByRole('alert').textContent).toMatch(/boom/)
  })

  it('shows the guest ribbon when there is no session and bots are present', () => {
    mockUseBots.mockReturnValue({ bots: BOTS, allBots: BOTS, isLoading: false, isStale: false, error: null })
    renderAt()
    expect(screen.getByTestId('bot-directory-guest-ribbon')).toBeTruthy()
  })

  it('hides the guest ribbon when a session is present', () => {
    mockUseSession.mockReturnValue({ data: { user: { id: 'u1' } }, isPending: false })
    mockUseBots.mockReturnValue({ bots: BOTS, allBots: BOTS, isLoading: false, isStale: false, error: null })
    renderAt()
    expect(screen.queryByTestId('bot-directory-guest-ribbon')).toBeNull()
  })

  it('seeds filter values from URL params and passes them to useBots', () => {
    mockUseBots.mockReturnValue({ bots: BOTS, allBots: BOTS, isLoading: false, isStale: false, error: null })
    renderAt('/bots?owner=community&eloMin=1200&search=copper')
    const filtersArg = mockUseBots.mock.calls[0][0]
    expect(filtersArg).toEqual({ owner: 'community', eloMin: 1200, search: 'copper' })
  })

  it('writes filter changes back to the URL via the filter bar', async () => {
    mockUseBots.mockReturnValue({ bots: BOTS, allBots: BOTS, isLoading: false, isStale: false, error: null })
    renderAt()
    fireEvent.change(screen.getByTestId('bot-filter-search'), { target: { value: 'sterling' } })
    // useBots should be re-invoked with the new search value
    await waitFor(() => {
      const lastCall = mockUseBots.mock.calls.at(-1)
      expect(lastCall?.[0]).toMatchObject({ search: 'sterling' })
    })
  })
})
