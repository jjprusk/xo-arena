import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ModeSelection from '../ModeSelection.jsx'
import { useGameStore } from '../../../store/gameStore.js'

// Mock api so tests don't hit the network
vi.mock('../../../lib/api.js', () => ({
  api: {
    ai: {
      implementations: vi.fn(() =>
        Promise.resolve({
          implementations: [
            { id: 'minimax', name: 'Minimax', description: 'Classic', supportedDifficulties: ['easy', 'medium', 'hard'] },
            { id: 'random', name: 'Random', description: 'Random moves', supportedDifficulties: ['easy'] },
          ],
        })
      ),
    },
  },
}))

describe('ModeSelection', () => {
  beforeEach(() => {
    useGameStore.getState().newGame()
  })

  it('renders three action sections', () => {
    render(<ModeSelection />)
    expect(screen.getByText('Play vs AI')).toBeTruthy()
    expect(screen.getByText('Invite a Friend')).toBeTruthy()
    expect(screen.getByText('Join a Room')).toBeTruthy()
  })

  it('shows difficulty options after expanding Play vs AI', async () => {
    render(<ModeSelection />)
    fireEvent.click(screen.getByText('Play vs AI'))
    await waitFor(() => {
      expect(screen.getByText('easy')).toBeTruthy()
      expect(screen.getByText('medium')).toBeTruthy()
      expect(screen.getByText('hard')).toBeTruthy()
    })
  })

  it('shows AI implementation list after expanding Play vs AI', async () => {
    render(<ModeSelection />)
    fireEvent.click(screen.getByText('Play vs AI'))
    await waitFor(() => {
      expect(screen.getByText('Minimax')).toBeTruthy()
    })
  })

  it('shows Play vs AI submit button inside expanded panel', async () => {
    render(<ModeSelection />)
    fireEvent.click(screen.getByText('Play vs AI'))
    await waitFor(() => {
      const buttons = screen.getAllByText('Play vs AI')
      expect(buttons.length).toBeGreaterThanOrEqual(2)
    })
  })

  it('calls onStart when Play vs AI submit button is clicked', async () => {
    const onStart = vi.fn()
    render(<ModeSelection onStart={onStart} />)
    fireEvent.click(screen.getByText('Play vs AI'))
    await waitFor(() => screen.getAllByText('Play vs AI').length >= 2)
    // Last match is the submit button inside the expanded panel
    const buttons = screen.getAllByText('Play vs AI')
    fireEvent.click(buttons[buttons.length - 1])
    expect(onStart).toHaveBeenCalled()
  })
})
