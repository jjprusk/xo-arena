import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

vi.mock('../../lib/api.js', () => ({
  api: {
    puzzles: {
      list: vi.fn(),
    },
  },
}))

import { api } from '../../lib/api.js'
import PuzzlePage from '../PuzzlePage.jsx'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makePuzzle(overrides = {}) {
  return {
    id: `p_${Math.random()}`,
    title: 'Puzzle One',
    description: 'Find the best move.',
    type: 'win1',
    toPlay: 'X',
    board: [null, null, null, null, null, null, null, null, null],
    solutions: [4],
    ...overrides,
  }
}

const WIN1_PUZZLE = makePuzzle({ id: 'p1', title: 'Win in One', type: 'win1', solutions: [0] })
const BLOCK_PUZZLE = makePuzzle({ id: 'p2', title: 'Block Threat', type: 'block1', solutions: [2] })

function defaultPuzzles() {
  api.puzzles.list.mockResolvedValue({ puzzles: [WIN1_PUZZLE, BLOCK_PUZZLE] })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  defaultPuzzles()
})

describe('PuzzlePage', () => {
  it('renders the page heading', () => {
    render(<PuzzlePage />)
    expect(screen.getByText('Puzzles')).toBeDefined()
  })

  it('shows all four type filter buttons', () => {
    render(<PuzzlePage />)
    expect(screen.getByText('Win in 1')).toBeDefined()
    expect(screen.getByText('Block')).toBeDefined()
    expect(screen.getByText('Fork')).toBeDefined()
    expect(screen.getByText('Draw or Die')).toBeDefined()
  })

  it('loads and shows a puzzle after mount', async () => {
    render(<PuzzlePage />)
    await waitFor(() => {
      expect(screen.getByText('Win in One')).toBeDefined()
    })
  })

  it('shows solve progress counter', async () => {
    render(<PuzzlePage />)
    await waitFor(() => {
      expect(screen.getByText('0/2 solved')).toBeDefined()
    })
  })

  it('shows correct feedback when the right cell is clicked', async () => {
    render(<PuzzlePage />)
    await waitFor(() => expect(screen.getByText('Win in One')).toBeDefined())

    // Board is 3x3; solution is index 0 — click the first cell button
    // Cells render as buttons (9 total); the first clickable empty cell is index 0
    const cellButtons = screen.getAllByRole('button').filter(b => {
      // Narrow to the 9 board cells by looking for buttons with the dot character or X/O
      const style = b.getAttribute('style') || ''
      return style.includes('clamp')
    })
    fireEvent.click(cellButtons[0]) // solution cell

    await waitFor(() => {
      expect(screen.getByText(/Correct!/)).toBeDefined()
    })
  })

  it('shows wrong feedback when an incorrect cell is clicked', async () => {
    render(<PuzzlePage />)
    await waitFor(() => expect(screen.getByText('Win in One')).toBeDefined())

    const cellButtons = screen.getAllByRole('button').filter(b => {
      const style = b.getAttribute('style') || ''
      return style.includes('clamp')
    })
    fireEvent.click(cellButtons[1]) // non-solution cell (solution is index 0)

    await waitFor(() => {
      expect(screen.getByText(/Not quite/)).toBeDefined()
    })
  })

  it('shows Try again button on wrong answer', async () => {
    render(<PuzzlePage />)
    await waitFor(() => expect(screen.getByText('Win in One')).toBeDefined())

    const cellButtons = screen.getAllByRole('button').filter(b =>
      (b.getAttribute('style') || '').includes('clamp')
    )
    fireEvent.click(cellButtons[1])

    await waitFor(() => {
      expect(screen.getByText('Try again')).toBeDefined()
    })
  })

  it('clears result when Try again is clicked', async () => {
    render(<PuzzlePage />)
    await waitFor(() => expect(screen.getByText('Win in One')).toBeDefined())

    const cellButtons = screen.getAllByRole('button').filter(b =>
      (b.getAttribute('style') || '').includes('clamp')
    )
    fireEvent.click(cellButtons[1])
    await waitFor(() => expect(screen.getByText('Try again')).toBeDefined())

    fireEvent.click(screen.getByText('Try again'))
    await waitFor(() => {
      expect(screen.queryByText(/Not quite/)).toBeNull()
    })
  })

  it('increments solved count after correct answer', async () => {
    render(<PuzzlePage />)
    await waitFor(() => expect(screen.getByText('Win in One')).toBeDefined())

    const cellButtons = screen.getAllByRole('button').filter(b =>
      (b.getAttribute('style') || '').includes('clamp')
    )
    fireEvent.click(cellButtons[0]) // correct (solution = 0)

    await waitFor(() => {
      expect(screen.getByText('1/2 solved')).toBeDefined()
    })
  })

  it('shows "Next puzzle" button after answering', async () => {
    render(<PuzzlePage />)
    await waitFor(() => expect(screen.getByText('Win in One')).toBeDefined())

    const cellButtons = screen.getAllByRole('button').filter(b =>
      (b.getAttribute('style') || '').includes('clamp')
    )
    fireEvent.click(cellButtons[0])

    await waitFor(() => {
      expect(screen.getByText('Next puzzle')).toBeDefined()
    })
  })

  it('navigates to the next puzzle when Next puzzle is clicked', async () => {
    render(<PuzzlePage />)
    await waitFor(() => expect(screen.getByText('Win in One')).toBeDefined())

    const cellButtons = screen.getAllByRole('button').filter(b =>
      (b.getAttribute('style') || '').includes('clamp')
    )
    fireEvent.click(cellButtons[0])
    await waitFor(() => expect(screen.getByText('Next puzzle')).toBeDefined())

    fireEvent.click(screen.getByText('Next puzzle'))
    await waitFor(() => {
      expect(screen.getByText('Block Threat')).toBeDefined()
    })
  })

  it('clicking a type filter re-fetches with that type', async () => {
    render(<PuzzlePage />)
    await waitFor(() => expect(screen.getByText('Win in One')).toBeDefined())

    api.puzzles.list.mockResolvedValue({ puzzles: [makePuzzle({ type: 'fork', title: 'Fork Puzzle' })] })
    fireEvent.click(screen.getByText('Fork'))

    await waitFor(() => {
      const calls = api.puzzles.list.mock.calls
      expect(calls.some(([type]) => type === 'fork')).toBe(true)
    })
  })

  it('shows "All" deactivate button after selecting a type filter', async () => {
    render(<PuzzlePage />)
    await waitFor(() => expect(screen.getByText('Win in One')).toBeDefined())

    api.puzzles.list.mockResolvedValue({ puzzles: [WIN1_PUZZLE] })
    // Click the filter button specifically (there are multiple "Win in 1" texts once a puzzle loads)
    const filterButtons = screen.getAllByText('Win in 1')
    fireEvent.click(filterButtons[0]) // first is always the filter button

    await waitFor(() => {
      expect(screen.getByText('All')).toBeDefined()
    })
  })

  it('shows error message on API failure', async () => {
    api.puzzles.list.mockRejectedValue(new Error('Network error'))
    render(<PuzzlePage />)

    await waitFor(() => {
      expect(screen.getByText('Failed to load puzzles.')).toBeDefined()
    })
  })

  it('shows Retry button on error', async () => {
    api.puzzles.list.mockRejectedValue(new Error('Network error'))
    render(<PuzzlePage />)

    await waitFor(() => {
      expect(screen.getByText('Retry')).toBeDefined()
    })
  })

  it('Retry button re-fetches puzzles', async () => {
    api.puzzles.list.mockRejectedValueOnce(new Error('Network error'))
    api.puzzles.list.mockResolvedValue({ puzzles: [WIN1_PUZZLE] })

    render(<PuzzlePage />)
    await waitFor(() => expect(screen.getByText('Retry')).toBeDefined())

    fireEvent.click(screen.getByText('Retry'))
    await waitFor(() => {
      expect(screen.getByText('Win in One')).toBeDefined()
    })
  })

  it('shows Previous and Next navigation buttons when multiple puzzles loaded', async () => {
    render(<PuzzlePage />)
    await waitFor(() => {
      expect(screen.getByText('← Previous')).toBeDefined()
      expect(screen.getByText('Next →')).toBeDefined()
    })
  })

  it('Previous/Next navigation wraps around', async () => {
    render(<PuzzlePage />)
    await waitFor(() => expect(screen.getByText('← Previous')).toBeDefined())

    // On first puzzle; clicking Previous should go to last (Block Threat)
    fireEvent.click(screen.getByText('← Previous'))
    await waitFor(() => {
      expect(screen.getByText('Block Threat')).toBeDefined()
    })
  })
})
