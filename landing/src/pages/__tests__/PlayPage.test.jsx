import React, { act } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// Mock useGameSDK — PlayPage reads phase/session/abandoned from this hook
vi.mock('../../lib/useGameSDK.js', () => ({
  useGameSDK: vi.fn(),
}))

// Mock the XO game component — renders a simple 9-cell board for testing
vi.mock('@callidity/game-xo', () => ({
  default: () => (
    <div>
      {Array(9).fill(null).map((_, i) => (
        <button key={i} aria-label={`Cell ${i}`} />
      ))}
    </div>
  ),
  meta: { layout: { preferredWidth: 'standard' }, theme: {} },
}))

// Mock socket module — PlayPage imports getSocket
vi.mock('../../lib/socket.js', () => ({
  getSocket:        vi.fn(() => ({ on: vi.fn(), off: vi.fn(), once: vi.fn() })),
  connectSocket:    vi.fn(() => ({ on: vi.fn(), off: vi.fn(), once: vi.fn(), emit: vi.fn(), connect: vi.fn() })),
  disconnectSocket: vi.fn(),
}))

// Mock the guide store so individual tests can drive the journey phase
// (Hook = empty completedSteps; Curriculum = step 2 completed). The selector
// signature `useGuideStore(s => ...)` is preserved so call sites work.
let mockCompletedSteps = []
vi.mock('../../store/guideStore.js', () => ({
  useGuideStore: (selector) => selector({
    journeyProgress: { completedSteps: mockCompletedSteps, dismissedAt: null },
  }),
}))

import { useGameSDK } from '../../lib/useGameSDK.js'
import PlayPage from '../PlayPage.jsx'

const mockSdk = { _onGameEnd: vi.fn(), onMove: vi.fn(() => () => {}) }
const defaultSDKReturn = {
  session: null,
  sdk: mockSdk,
  phase: 'connecting',
  abandoned: null,
  kicked: false,
  seriesResult: null,
}

function renderPlay(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/play${search}`]}>
      <Routes>
        <Route path="/play" element={<PlayPage />} />
        <Route path="/"    element={<div>Home</div>} />
        <Route path="/tables" element={<div>Tables</div>} />
        <Route path="/tournaments/:id" element={<div>Tournament</div>} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  useGameSDK.mockReturnValue({ ...defaultSDKReturn })
  mockCompletedSteps = []
})

describe('PlayPage', () => {
  it('redirects to / when no join slug is provided', () => {
    renderPlay()
    expect(screen.getByText('Home')).toBeDefined()
  })

  it('shows a waiting spinner when status is "waiting"', () => {
    useGameSDK.mockReturnValue({ ...defaultSDKReturn, phase: 'waiting' })
    renderPlay('?join=some-room')
    const spinner = document.querySelector('.animate-spin')
    expect(spinner).not.toBeNull()
  })

  it('shows FormingPanel when waiting with an active session', () => {
    useGameSDK.mockReturnValue({
      ...defaultSDKReturn,
      phase: 'waiting',
      session: { tableId: 'tbl-1', players: [], settings: {}, isSpectator: false },
    })
    renderPlay('?join=some-room&tournamentMatch=match-1&tournamentId=t-1')
    expect(screen.getByText('Waiting for opponent')).toBeDefined()
  })

  it('shows a spinner while connecting to a non-tournament room', () => {
    renderPlay('?join=some-room')
    expect(document.querySelector('.animate-spin')).not.toBeNull()
  })

  it('shows abandoned message when room is abandoned', () => {
    useGameSDK.mockReturnValue({ ...defaultSDKReturn, abandoned: { reason: 'idle' } })
    renderPlay('?join=some-room')
    expect(screen.getByText('Table closed due to inactivity')).toBeDefined()
  })

  it('renders the game board when status is "playing"', async () => {
    useGameSDK.mockReturnValue({
      ...defaultSDKReturn,
      phase: 'playing',
      session: { tableId: 'room-1', settings: {}, players: [] },
    })
    await act(async () => { renderPlay('?join=some-room') })
    const cells = document.querySelectorAll('[aria-label^="Cell"]')
    expect(cells.length).toBe(9)
  })

  it('renders the game board when status is "finished"', async () => {
    useGameSDK.mockReturnValue({
      ...defaultSDKReturn,
      phase: 'finished',
      session: { tableId: 'room-1', settings: {}, players: [] },
    })
    await act(async () => { renderPlay('?join=some-room') })
    expect(document.querySelectorAll('[aria-label^="Cell"]').length).toBe(9)
  })

  // Leave-destination logic — see PlayPage.jsx `leaveHref`. The Back link in
  // PlatformShell is wired to the same href used by the Leave Table /
  // abandoned / opponentLeft navigations, so asserting on it covers all three.
  describe('leave destination by journey phase', () => {
    it('Hook user (default empty completedSteps) → Back goes to /', async () => {
      mockCompletedSteps = []
      useGameSDK.mockReturnValue({
        ...defaultSDKReturn,
        phase: 'playing',
        session: { tableId: 'room-1', settings: {}, players: [] },
      })
      await act(async () => { renderPlay('?join=some-room') })
      const back = screen.getByRole('link', { name: /^← Back$/ })
      expect(back.getAttribute('href')).toBe('/')
    })

    it('Curriculum user (step 2 done) → Back goes to /tables', async () => {
      mockCompletedSteps = [1, 2]
      useGameSDK.mockReturnValue({
        ...defaultSDKReturn,
        phase: 'playing',
        session: { tableId: 'room-1', settings: {}, players: [] },
      })
      await act(async () => { renderPlay('?join=some-room') })
      const back = screen.getByRole('link', { name: /^← Back$/ })
      expect(back.getAttribute('href')).toBe('/tables')
    })

    it('Tournament context → Back goes to /tournaments/<id> regardless of phase', async () => {
      mockCompletedSteps = []  // even a Hook user in a tournament returns to the bracket
      useGameSDK.mockReturnValue({
        ...defaultSDKReturn,
        phase: 'playing',
        session: { tableId: 'room-1', settings: {}, players: [] },
      })
      await act(async () => { renderPlay('?join=some-room&tournamentId=t-42') })
      const back = screen.getByRole('link', { name: /^← Back$/ })
      expect(back.getAttribute('href')).toBe('/tournaments/t-42')
    })
  })
})
