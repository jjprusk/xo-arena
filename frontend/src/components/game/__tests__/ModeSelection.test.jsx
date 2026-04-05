import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ModeSelection from '../ModeSelection.jsx'
import { useGameStore } from '../../../store/gameStore.js'

const mockBots = [
  { id: 'bot1', username: 'Rusty', displayName: 'Rusty', eloRating: 800, botModelType: 'minimax' },
  { id: 'bot2', username: 'Magnus', displayName: 'Magnus', eloRating: 1400, botModelType: 'minimax' },
]

// Mock api so tests don't hit the network
vi.mock('../../../lib/api.js', () => ({
  api: {
    ml: {
      listModels: vi.fn(() => Promise.resolve({ models: [] })),
      listRuleSets: vi.fn(() => Promise.resolve({ ruleSets: [] })),
    },
    rooms: {
      list: vi.fn(() => Promise.resolve({ rooms: [] })),
    },
    users: {
      getHints: vi.fn(() => Promise.resolve({ playHintSeen: true, faqHintSeen: true, showGuideButton: false })),
      markPlayHint: vi.fn(() => Promise.resolve()),
    },
  },
  cachedFetch: vi.fn(() => ({
    immediate: null,
    refresh: Promise.resolve({ bots: mockBots }),
  })),
}))

vi.mock('../../../lib/getToken.js', () => ({
  getToken: vi.fn(() => Promise.resolve('mock-token')),
}))

vi.mock('../../../lib/useOptimisticSession.js', () => ({
  useOptimisticSession: vi.fn(() => ({
    data: { user: { id: 'u1', name: 'Tester' } },
    isPending: false,
  })),
}))

describe('ModeSelection', () => {
  beforeEach(() => {
    useGameStore.getState().newGame()
  })

  it('renders main action sections', () => {
    render(<ModeSelection />)
    expect(screen.getByText('Challenge a Bot')).toBeTruthy()
    expect(screen.getByText('Watch Bot vs Bot')).toBeTruthy()
    expect(screen.getByText('Invite a Friend')).toBeTruthy()
    expect(screen.getByText('Join a Room')).toBeTruthy()
  })

  it('shows bot list after expanding Challenge a Bot', async () => {
    render(<ModeSelection />)
    fireEvent.click(screen.getByText('Challenge a Bot'))
    await waitFor(() => screen.getByText(/Built-in/))
    fireEvent.click(screen.getByText(/Built-in/))
    await waitFor(() => {
      expect(screen.getByText('Rusty')).toBeTruthy()
      expect(screen.getByText('Magnus')).toBeTruthy()
    })
  })

  it('shows Challenge buttons for each bot when signed in', async () => {
    render(<ModeSelection />)
    fireEvent.click(screen.getByText('Challenge a Bot'))
    await waitFor(() => screen.getByText(/Built-in/))
    fireEvent.click(screen.getByText(/Built-in/))
    await waitFor(() => screen.getByText('Rusty'))
    const challengeButtons = screen.getAllByText('Challenge')
    expect(challengeButtons.length).toBe(mockBots.length)
  })

  it('calls onStart when Challenge button is clicked', async () => {
    const onStart = vi.fn()
    render(<ModeSelection onStart={onStart} />)
    fireEvent.click(screen.getByText('Challenge a Bot'))
    await waitFor(() => screen.getByText(/Built-in/))
    fireEvent.click(screen.getByText(/Built-in/))
    await waitFor(() => screen.getByText('Rusty'))
    fireEvent.click(screen.getAllByText('Challenge')[0])
    expect(onStart).toHaveBeenCalled()
  })
})
