// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * A4.1 — BotProfilePage renders a per-skill cards section sourced from
 * GET /api/v1/bots/:id. Each card calls out the primary skill and links
 * to the per-skill Gym training surface (`/gym?bot=&gameId=`). The
 * "Add skill" affordance is owner-only.
 *
 * The wider page surfaces (Challenge / Spar / etc.) are covered by
 * sibling test files — this one is scoped to the A4 contract.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const { mockApiGet, mockBotsGet, mockUseSession } = vi.hoisted(() => ({
  mockApiGet:     vi.fn(),
  mockBotsGet:    vi.fn(),
  mockUseSession: vi.fn(),
}))

vi.mock('../../lib/api.js', () => ({
  api: {
    get:   mockApiGet,
    post:  vi.fn(),
    patch: vi.fn(),
    bots:  { get: mockBotsGet },
    ml:    { getSessions: vi.fn().mockResolvedValue({ sessions: [] }) },
  },
}))
vi.mock('../../lib/useOptimisticSession.js', () => ({
  useOptimisticSession: mockUseSession,
}))
vi.mock('../../lib/getToken.js', () => ({
  getToken: vi.fn().mockResolvedValue('fake-token'),
}))
vi.mock('../../components/guide/TrainGuidedModal.jsx', () => ({ default: () => null }))
vi.mock('../../components/guide/Spotlight.jsx',        () => ({ default: () => null }))
vi.mock('../../components/bots/ChallengeButton.jsx',   () => ({ default: () => <button /> }))

import BotProfilePage from '../BotProfilePage.jsx'

const OWNER_ID = 'u_alice'
const NON_OWNER_ID = 'u_bob'

const BOT_USER = {
  id:             'b_42',
  displayName:    'Multi-Skill Megan',
  avatarUrl:      null,
  isBot:          true,
  botActive:      true,
  botProvisional: false,
  botCompetitive: false,
  botInTournament: false,
  botModelType:   'qlearning',
  botModelId:     'skill_xo',
  createdAt:      '2026-04-01T00:00:00Z',
  ownerBetterAuthId: OWNER_ID,
  botOwnerId:     'u_alice_domain',
  mlModel:        null,
}

const BOT_WITH_SKILLS = {
  ...BOT_USER,
  skills: [
    {
      id: 'skill_xo', gameId: 'tic-tac-toe', algorithm: 'qlearning',
      elo: { rating: 1485.6 }, lastTrainedAt: '2026-05-01T10:00:00Z',
    },
    {
      id: 'skill_c4', gameId: 'connect-four', algorithm: 'dqn',
      elo: null, lastTrainedAt: null,
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockApiGet.mockImplementation((path) => {
    if (path.endsWith('/bot-stats'))   return Promise.resolve({ total: 0 })
    if (path.endsWith('/elo-history')) return Promise.resolve({ currentElo: 1485, eloHistory: [] })
    return Promise.resolve({ user: BOT_USER })
  })
  mockBotsGet.mockResolvedValue({ bot: BOT_WITH_SKILLS })
})

function renderAs(viewerId) {
  mockUseSession.mockReturnValue({
    data: viewerId ? { user: { id: viewerId } } : null,
    isPending: false,
  })
  return render(
    <MemoryRouter initialEntries={['/bots/b_42']}>
      <Routes>
        <Route path="/bots/:id" element={<BotProfilePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('<BotProfilePage /> — A4 Skills section', () => {
  it('renders one card per BotSkill row', async () => {
    renderAs(NON_OWNER_ID)
    await screen.findByTestId('bot-profile-skills')
    expect(screen.getByTestId('bot-profile-skill-tic-tac-toe')).toBeInTheDocument()
    expect(screen.getByTestId('bot-profile-skill-connect-four')).toBeInTheDocument()
  })

  it('marks the primary skill (matches User.botModelId)', async () => {
    renderAs(NON_OWNER_ID)
    const primary = await screen.findByTestId('bot-profile-skill-tic-tac-toe')
    expect(primary.getAttribute('data-primary')).toBe('true')
    expect(screen.getByTestId('bot-profile-skill-primary-tic-tac-toe')).toBeInTheDocument()
    const secondary = screen.getByTestId('bot-profile-skill-connect-four')
    expect(secondary.getAttribute('data-primary')).toBe('false')
  })

  it('shows ELO + last-trained date for trained skills, "Not trained yet" otherwise', async () => {
    renderAs(NON_OWNER_ID)
    const primary = await screen.findByTestId('bot-profile-skill-tic-tac-toe')
    // ELO rounded from 1485.6 → 1486
    expect(primary.textContent).toContain('1486')
    expect(primary.textContent).toMatch(/Last trained:/)
    const secondary = screen.getByTestId('bot-profile-skill-connect-four')
    expect(secondary.textContent).toMatch(/Not trained yet/)
  })

  it('owner sees the Add skill button + per-skill Train links; non-owners do not', async () => {
    renderAs(OWNER_ID)
    await screen.findByTestId('bot-profile-skills')
    expect(screen.getByTestId('bot-profile-add-skill')).toBeInTheDocument()
    // Deep-link includes the bot id + skill gameId (A4.5).
    const link = screen.getByTestId('bot-profile-skill-train-tic-tac-toe')
    expect(link.getAttribute('href')).toBe('/gym?bot=b_42&gameId=tic-tac-toe')
  })

  it('non-owner sees the Skills section but no Add/Train affordances', async () => {
    renderAs(NON_OWNER_ID)
    await screen.findByTestId('bot-profile-skills')
    expect(screen.queryByTestId('bot-profile-add-skill')).toBeNull()
    expect(screen.queryByTestId('bot-profile-skill-train-tic-tac-toe')).toBeNull()
  })

  it('skill-less bots do not render the Skills section', async () => {
    mockBotsGet.mockResolvedValue({ bot: { ...BOT_USER, skills: [] } })
    renderAs(OWNER_ID)
    // Wait for at least one network call to complete before asserting absence
    await waitFor(() => expect(mockBotsGet).toHaveBeenCalled())
    expect(screen.queryByTestId('bot-profile-skills')).toBeNull()
  })
})
