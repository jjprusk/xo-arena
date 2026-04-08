import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { configurePvp, usePvpStore } from '@xo-arena/xo'

// Mock socket module — PlayPage imports getSocket for series:complete listener
vi.mock('../../lib/socket.js', () => ({
  getSocket:        vi.fn(() => ({ on: vi.fn(), off: vi.fn() })),
  connectSocket:    vi.fn(() => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn(), connect: vi.fn() })),
  disconnectSocket: vi.fn(),
}))

import PlayPage from '../PlayPage.jsx'

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
  const mockSocket = { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }
  configurePvp({
    connectSocket:    vi.fn(() => mockSocket),
    disconnectSocket: vi.fn(),
    getSocket:        vi.fn(() => mockSocket),
    getToken:         vi.fn(() => Promise.resolve(null)),
  })
  usePvpStore.getState().reset()
  usePvpStore.setState({ _listenersRegistered: false })
})

describe('PlayPage', () => {
  it('redirects to / when no join slug is provided', () => {
    renderPlay()
    expect(screen.getByText('Home')).toBeDefined()
  })

  it('shows a waiting spinner when status is "waiting"', () => {
    usePvpStore.setState({ status: 'waiting' })
    renderPlay('?join=some-room')
    const spinner = document.querySelector('.animate-spin')
    expect(spinner).not.toBeNull()
  })

  it('shows "Waiting for opponent" text for tournament matches', () => {
    usePvpStore.setState({ status: 'waiting' })
    renderPlay('?join=some-room&tournamentMatch=match-1&tournamentId=t-1')
    expect(screen.getByText('Waiting for opponent…')).toBeDefined()
  })

  it('shows "Joining room" text for non-tournament joins', () => {
    usePvpStore.setState({ status: 'waiting' })
    renderPlay('?join=some-room')
    expect(screen.getByText('Joining room…')).toBeDefined()
  })

  it('shows abandoned message when room is abandoned', () => {
    usePvpStore.setState({ status: 'playing', abandoned: { reason: 'idle' } })
    renderPlay('?join=some-room')
    expect(screen.getByText('Room ended due to inactivity')).toBeDefined()
  })

  it('renders the PvP board when status is "playing"', () => {
    usePvpStore.setState({
      status: 'playing',
      board: Array(9).fill(null),
      myMark: 'X',
      role: 'player',
      currentTurn: 'X',
      scores: { X: 0, O: 0 },
      round: 1,
    })
    renderPlay('?join=some-room')
    // Board has 9 cells
    const cells = document.querySelectorAll('[aria-label^="Cell"]')
    expect(cells.length).toBe(9)
  })

  it('renders the PvP board when status is "finished" (showing game-end actions)', () => {
    usePvpStore.setState({
      status: 'finished',
      board: ['X', 'X', 'X', null, null, null, null, null, null],
      winner: 'X',
      winLine: [0, 1, 2],
      myMark: 'X',
      role: 'player',
      currentTurn: 'X',
      scores: { X: 1, O: 0 },
      round: 1,
    })
    renderPlay('?join=some-room')
    expect(document.querySelectorAll('[aria-label^="Cell"]').length).toBe(9)
  })
})
