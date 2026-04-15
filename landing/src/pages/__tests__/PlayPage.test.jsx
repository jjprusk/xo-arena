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

import { useGameSDK } from '../../lib/useGameSDK.js'
import PlayPage from '../PlayPage.jsx'

const mockSdk = { _onGameEnd: vi.fn() }
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
        <Route path="/tournaments/:id" element={<div>Tournament</div>} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  useGameSDK.mockReturnValue({ ...defaultSDKReturn })
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

  it('shows "Waiting for opponent" text for tournament matches', () => {
    useGameSDK.mockReturnValue({ ...defaultSDKReturn, phase: 'waiting' })
    renderPlay('?join=some-room&tournamentMatch=match-1&tournamentId=t-1')
    expect(screen.getByText('Waiting for opponent…')).toBeDefined()
  })

  it('shows "Connecting" text while joining a non-tournament room', () => {
    renderPlay('?join=some-room')
    expect(screen.getByText('Connecting…')).toBeDefined()
  })

  it('shows abandoned message when room is abandoned', () => {
    useGameSDK.mockReturnValue({ ...defaultSDKReturn, abandoned: { reason: 'idle' } })
    renderPlay('?join=some-room')
    expect(screen.getByText('Room ended due to inactivity')).toBeDefined()
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
})
