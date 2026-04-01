import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../store/rolesStore.js', () => ({
  useRolesStore: vi.fn(),
}))

vi.mock('../../store/gameStore.js', () => ({
  useGameStore: vi.fn(),
}))

vi.mock('../feedback/FeedbackModal.jsx', () => ({
  default: ({ open, onClose }) =>
    open ? (
      <div data-testid="feedback-modal">
        <button onClick={onClose} data-testid="modal-close">
          Close Modal
        </button>
      </div>
    ) : null,
}))

import { useRolesStore } from '../../store/rolesStore.js'
import { useGameStore } from '../../store/gameStore.js'
import FeedbackButton from '../feedback/FeedbackButton.jsx'

// ── Helpers ───────────────────────────────────────────────────────────────────

function setupDefaults({ hasSupport = false, status = 'idle', mode = null } = {}) {
  useRolesStore.mockImplementation(selector =>
    selector({ hasRole: (role) => role === 'SUPPORT' && hasSupport })
  )
  useGameStore.mockImplementation(selector => {
    const state = { status, mode }
    return selector(state)
  })
}

function renderButton(props = {}) {
  return render(
    <MemoryRouter>
      <FeedbackButton {...props} />
    </MemoryRouter>
  )
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  setupDefaults()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FeedbackButton — rendering', () => {
  it('renders the feedback button by default', () => {
    renderButton()
    expect(screen.getByRole('button', { name: /send feedback/i })).toBeDefined()
  })

  it('button has title "Send feedback"', () => {
    renderButton()
    expect(screen.getByTitle('Send feedback')).toBeDefined()
  })

  it('does not render when user has SUPPORT role', () => {
    setupDefaults({ hasSupport: true })
    renderButton()
    expect(screen.queryByRole('button', { name: /send feedback/i })).toBeNull()
  })

  it('does not render when game is actively playing and hideWhenPlaying is true', () => {
    setupDefaults({ status: 'playing', mode: 'pvai' })
    renderButton({ hideWhenPlaying: true })
    expect(screen.queryByRole('button', { name: /send feedback/i })).toBeNull()
  })

  it('renders even when game is playing if hideWhenPlaying is false', () => {
    setupDefaults({ status: 'playing', mode: 'pvai' })
    renderButton({ hideWhenPlaying: false })
    expect(screen.getByRole('button', { name: /send feedback/i })).toBeDefined()
  })

  it('renders when game mode is null even if status is playing', () => {
    setupDefaults({ status: 'playing', mode: null })
    renderButton({ hideWhenPlaying: true })
    expect(screen.getByRole('button', { name: /send feedback/i })).toBeDefined()
  })

  it('renders when status is "won" (not actively playing)', () => {
    setupDefaults({ status: 'won', mode: 'pvai' })
    renderButton({ hideWhenPlaying: true })
    expect(screen.getByRole('button', { name: /send feedback/i })).toBeDefined()
  })

  it('renders when status is "idle" and mode is set', () => {
    setupDefaults({ status: 'idle', mode: 'pvp' })
    renderButton({ hideWhenPlaying: true })
    expect(screen.getByRole('button', { name: /send feedback/i })).toBeDefined()
  })
})

describe('FeedbackButton — modal behavior', () => {
  it('FeedbackModal is closed (not rendered) by default', () => {
    renderButton()
    expect(screen.queryByTestId('feedback-modal')).toBeNull()
  })

  it('opens FeedbackModal when the button is clicked', () => {
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: /send feedback/i }))
    expect(screen.getByTestId('feedback-modal')).toBeDefined()
  })

  it('FeedbackModal closes when onClose is called', () => {
    renderButton()
    // Open the modal
    fireEvent.click(screen.getByRole('button', { name: /send feedback/i }))
    expect(screen.getByTestId('feedback-modal')).toBeDefined()

    // Close via the stub's close button
    fireEvent.click(screen.getByTestId('modal-close'))
    expect(screen.queryByTestId('feedback-modal')).toBeNull()
  })
})
