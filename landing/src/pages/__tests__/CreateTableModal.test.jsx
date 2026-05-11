// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Phase C.1 — CreateTableModal exposes a tabbed bot picker (My / Community
 * / All) using the Phase A primitives. Clicking a bot card navigates
 * directly to /play (no Create button needed). The Open-seat path
 * preserves the existing PvP table-create behaviour.
 *
 * Tests render the modal directly (it's exported for this reason) — full
 * TablesPage coverage is in TablesPage.test.jsx.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const { mockUseBots, mockUseSession, mockApi, mockNavigate, mockGetToken } = vi.hoisted(() => ({
  mockUseBots:    vi.fn(),
  mockUseSession: vi.fn(),
  mockApi:        { tables: { create: vi.fn() } },
  mockNavigate:   vi.fn(),
  mockGetToken:   vi.fn().mockResolvedValue('fake-token'),
}))

vi.mock('../../lib/useBots.js', () => ({ useBots: mockUseBots }))
vi.mock('../../lib/useOptimisticSession.js', () => ({ useOptimisticSession: mockUseSession }))
vi.mock('../../lib/api.js', () => ({ api: mockApi }))
vi.mock('../../lib/getToken.js', () => ({ getToken: mockGetToken }))
vi.mock('../../lib/swr.js', () => ({ useSWRish: vi.fn().mockReturnValue({ data: null, isLoading: false, isStale: false }) }))
vi.mock('../../lib/useEventStream.js', () => ({ useEventStream: () => {} }))

vi.mock('react-router-dom', async (orig) => {
  const actual = await orig()
  return { ...actual, useNavigate: () => mockNavigate }
})

import { CreateTableModal } from '../TablesPage.jsx'

const BOTS = [
  { id: 'b_a', displayName: 'Sterling',     botOwnerId: 'u1',   gameElo: [{ rating: 1500 }], botGamesPlayed: 50  },
  { id: 'b_b', displayName: 'Copper Built', botOwnerId: null,   gameElo: [{ rating: 1100 }], botGamesPlayed: 100 },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockUseSession.mockReturnValue({ data: { user: { id: 'u1' } }, isPending: false })
  mockUseBots.mockReturnValue({
    bots: BOTS, allBots: BOTS,
    isLoading: false, isStale: false, error: null,
  })
})

function renderModal() {
  return render(
    <MemoryRouter>
      <CreateTableModal onClose={vi.fn()} onCreated={vi.fn()} />
    </MemoryRouter>,
  )
}

describe('CreateTableModal — Phase C.1 bot picker', () => {
  it('defaults to the human (open seat) tab', () => {
    renderModal()
    expect(
      screen.getByTestId('create-table-opponent-human').getAttribute('data-active'),
    ).toBe('true')
    expect(
      screen.getByTestId('create-table-opponent-bot').getAttribute('data-active'),
    ).toBe('false')
    expect(screen.queryByTestId('create-table-bot-picker')).toBeNull()
  })

  it('switching to Bot reveals the picker (filter bar + grid)', () => {
    renderModal()
    fireEvent.click(screen.getByTestId('create-table-opponent-bot'))
    expect(screen.getByTestId('create-table-bot-picker')).toBeTruthy()
    expect(screen.getByTestId('bot-filter-bar')).toBeTruthy()
    expect(screen.getByTestId('create-table-bot-grid')).toBeTruthy()
  })

  it('clicking a bot card navigates to /play?botUserId=<id>', () => {
    renderModal()
    fireEvent.click(screen.getByTestId('create-table-opponent-bot'))
    fireEvent.click(screen.getByText('Sterling'))
    expect(mockNavigate).toHaveBeenCalledWith('/play?botUserId=b_a')
  })

  it('hides the Create-table submit button when Bot is selected', () => {
    renderModal()
    fireEvent.click(screen.getByTestId('create-table-opponent-bot'))
    // The Bot tab path has no submit button; only the X close button.
    const submitBtns = screen.queryAllByRole('button', { name: /^create table$/i })
    expect(submitBtns).toHaveLength(0)
  })

  it('Open seat path: submit creates a Table via api.tables.create', async () => {
    mockApi.tables.create.mockResolvedValueOnce({ table: { id: 'tbl_new' } })
    renderModal()
    const submitBtn = screen.getByRole('button', { name: /^create table$/i })
    fireEvent.click(submitBtn)
    await waitFor(() => expect(mockApi.tables.create).toHaveBeenCalled())
    expect(mockNavigate).toHaveBeenCalledWith('/tables/tbl_new')
  })

  it('hides the "My bots" tab on the bot picker for guest sessions', () => {
    mockUseSession.mockReturnValue({ data: null, isPending: false })
    renderModal()
    fireEvent.click(screen.getByTestId('create-table-opponent-bot'))
    expect(screen.queryByTestId('bot-filter-owner-mine')).toBeNull()
    expect(screen.getByTestId('bot-filter-owner-community')).toBeTruthy()
    expect(screen.getByTestId('bot-filter-owner-all')).toBeTruthy()
  })

  it('shows empty state when filters yield 0 bots', () => {
    mockUseBots.mockReturnValue({ bots: [], allBots: BOTS, isLoading: false, isStale: false, error: null })
    renderModal()
    fireEvent.click(screen.getByTestId('create-table-opponent-bot'))
    expect(screen.getByTestId('create-table-bots-empty')).toBeTruthy()
  })
})
