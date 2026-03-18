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

  it('renders mode cards', () => {
    render(<ModeSelection />)
    expect(screen.getByText('vs AI')).toBeTruthy()
    expect(screen.getByText('vs Player')).toBeTruthy()
  })

  it('shows difficulty options when PvAI selected', async () => {
    render(<ModeSelection />)
    fireEvent.click(screen.getByText('vs AI'))
    await waitFor(() => {
      expect(screen.getByText('easy')).toBeTruthy()
      expect(screen.getByText('medium')).toBeTruthy()
      expect(screen.getByText('hard')).toBeTruthy()
    })
  })

  it('shows AI implementation list after selecting PvAI', async () => {
    render(<ModeSelection />)
    fireEvent.click(screen.getByText('vs AI'))
    await waitFor(() => {
      expect(screen.getByText('Minimax')).toBeTruthy()
    })
  })

  it('shows start button after mode + impl selected', async () => {
    render(<ModeSelection />)
    fireEvent.click(screen.getByText('vs AI'))
    await waitFor(() => screen.getByText('Play vs AI'))
    expect(screen.getByText('Play vs AI')).toBeTruthy()
  })

  it('calls onStart when Play button clicked', async () => {
    const onStart = vi.fn()
    render(<ModeSelection onStart={onStart} />)
    fireEvent.click(screen.getByText('vs AI'))
    await waitFor(() => screen.getByText('Play vs AI'))
    fireEvent.click(screen.getByText('Play vs AI'))
    expect(onStart).toHaveBeenCalled()
  })
})
