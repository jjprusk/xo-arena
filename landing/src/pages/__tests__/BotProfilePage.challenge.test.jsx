// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Phase B.2 — BotProfilePage exposes a Challenge section to all viewers
 * (guests + non-owners + owners), distinct from the owner-only Spar
 * section. This test covers the visibility contract; full BotProfile
 * coverage is intentionally not in scope.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const { mockApiGet, mockUseSession } = vi.hoisted(() => ({
  mockApiGet:     vi.fn(),
  mockUseSession: vi.fn(),
}))

vi.mock('../../lib/api.js', () => ({
  api: { get: mockApiGet, post: vi.fn(), patch: vi.fn() },
}))
vi.mock('../../lib/useOptimisticSession.js', () => ({
  useOptimisticSession: mockUseSession,
}))
vi.mock('../../lib/getToken.js', () => ({
  getToken: vi.fn().mockResolvedValue('fake-token'),
}))
vi.mock('../../components/guide/TrainGuidedModal.jsx', () => ({
  default: () => null,
}))
vi.mock('../../components/guide/Spotlight.jsx', () => ({
  default: () => null,
}))
vi.mock('../../lib/rtSession.js', () => ({
  rtFetch: vi.fn().mockResolvedValue({ slug: 's1' }),
}))

import BotProfilePage from '../BotProfilePage.jsx'

const BOT_USER = {
  id:             'b_xyz',
  displayName:    'Sterling Three',
  avatarUrl:      null,
  isBot:          true,
  botActive:      true,
  botProvisional: false,
  botCompetitive: false,
  botInTournament: false,
  botModelType:   'minimax',
  botModelId:     'builtin:minimax:medium',
  createdAt:      '2026-04-01T00:00:00Z',
  owner:          { id: 'u_other', displayName: 'Someone Else' },
  botOwnerId:     'u_other',
  mlModel:        null,
}

beforeEach(() => {
  vi.clearAllMocks()
  // /users/:id, /users/:id/bot-stats, /users/:id/elo-history
  mockApiGet.mockImplementation((path) => {
    if (path.endsWith('/bot-stats'))    return Promise.resolve({ total: 0 })
    if (path.endsWith('/elo-history'))  return Promise.resolve({ currentElo: 1450, eloHistory: [] })
    return Promise.resolve({ user: BOT_USER })
  })
})

function renderAt(viewerId = null) {
  mockUseSession.mockReturnValue({
    data: viewerId ? { user: { id: viewerId } } : null,
    isPending: false,
  })
  return render(
    <MemoryRouter initialEntries={['/bots/b_xyz']}>
      <Routes>
        <Route path="/bots/:id" element={<BotProfilePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('<BotProfilePage /> — Phase B.2 Challenge section', () => {
  it('shows the Challenge section to a guest viewer (no session)', async () => {
    renderAt(null)
    await waitFor(() => expect(screen.getByTestId('bot-profile-challenge')).toBeTruthy())
    const section = screen.getByTestId('bot-profile-challenge')
    expect(section.querySelector('[data-testid="challenge-button"]')).toBeTruthy()
    expect(section.querySelector('[data-testid="challenge-button"]').getAttribute('data-source')).toBe('bot-profile')
  })

  it('shows the Challenge section to a non-owner human viewer', async () => {
    renderAt('u_someone_random')
    await waitFor(() => expect(screen.getByTestId('bot-profile-challenge')).toBeTruthy())
  })

  it('shows the Challenge section to the owner too (test-from-the-other-seat)', async () => {
    renderAt('u_other')  // matches BOT_USER.botOwnerId
    await waitFor(() => expect(screen.getByTestId('bot-profile-challenge')).toBeTruthy())
  })

  it('hides the Challenge section when the bot is inactive', async () => {
    mockApiGet.mockImplementation((path) => {
      if (path.endsWith('/bot-stats'))    return Promise.resolve({ total: 0 })
      if (path.endsWith('/elo-history'))  return Promise.resolve({ currentElo: 1450, eloHistory: [] })
      return Promise.resolve({ user: { ...BOT_USER, botActive: false } })
    })
    renderAt(null)
    // Wait for the page to render past loading by asserting some other
    // element exists (ELO row is always present once loaded).
    await waitFor(() => expect(screen.getByText('ELO')).toBeTruthy())
    expect(screen.queryByTestId('bot-profile-challenge')).toBeNull()
  })
})
