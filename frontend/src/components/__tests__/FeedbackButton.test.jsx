import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../store/rolesStore.js', () => ({
  useRolesStore: vi.fn(),
}))

vi.mock('../../store/gameStore.js', () => ({
  useGameStore: vi.fn(),
}))

vi.mock('html2canvas', () => ({
  default: vi.fn(() =>
    Promise.resolve({
      toDataURL: vi.fn(() => 'data:image/jpeg;base64,rawcapture'),
    })
  ),
}))

vi.mock('../../lib/screenshotUtils.js', () => ({
  isMobile: vi.fn(() => false),
  compressImage: vi.fn(() => Promise.resolve('data:image/jpeg;base64,compressed')),
}))

vi.mock('../feedback/FeedbackModal.jsx', () => ({
  default: ({ open, onClose, screenshotData }) =>
    open ? (
      <div data-testid="feedback-modal" data-screenshot={screenshotData ?? ''}>
        <button onClick={onClose} data-testid="modal-close">Close Modal</button>
      </div>
    ) : null,
}))

import html2canvas from 'html2canvas'
import { isMobile, compressImage } from '../../lib/screenshotUtils.js'
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
  isMobile.mockReturnValue(false)
  compressImage.mockResolvedValue('data:image/jpeg;base64,compressed')
  html2canvas.mockResolvedValue({
    toDataURL: vi.fn(() => 'data:image/jpeg;base64,rawcapture'),
  })
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

  it('FeedbackModal closes when onClose is called', async () => {
    renderButton()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send feedback/i }))
    })
    expect(screen.getByTestId('feedback-modal')).toBeDefined()

    fireEvent.click(screen.getByTestId('modal-close'))
    expect(screen.queryByTestId('feedback-modal')).toBeNull()
  })
})

// ── Desktop screenshot capture ────────────────────────────────────────────────

describe('FeedbackButton — desktop screenshot capture', () => {
  it('calls html2canvas when button is clicked on desktop', async () => {
    renderButton()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send feedback/i }))
    })
    expect(html2canvas).toHaveBeenCalledWith(document.body, expect.objectContaining({ logging: false }))
  })

  it('opens the modal after capture', async () => {
    renderButton()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send feedback/i }))
    })
    expect(screen.getByTestId('feedback-modal')).toBeDefined()
  })

  it('calls compressImage with the canvas output', async () => {
    renderButton()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send feedback/i }))
    })
    expect(compressImage).toHaveBeenCalledWith('data:image/jpeg;base64,rawcapture')
  })

  it('passes compressed screenshotData to FeedbackModal', async () => {
    renderButton()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send feedback/i }))
    })
    const modal = screen.getByTestId('feedback-modal')
    expect(modal.getAttribute('data-screenshot')).toBe('data:image/jpeg;base64,compressed')
  })

  it('opens modal with null screenshotData when html2canvas throws', async () => {
    html2canvas.mockRejectedValueOnce(new Error('canvas failed'))
    renderButton()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send feedback/i }))
    })
    const modal = screen.getByTestId('feedback-modal')
    expect(modal.getAttribute('data-screenshot')).toBe('')
  })

  it('button is disabled while capturing', async () => {
    // html2canvas never resolves so capturing stays true
    html2canvas.mockReturnValueOnce(new Promise(() => {}))
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: /send feedback/i }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /send feedback/i }).disabled).toBe(true)
    })
  })

  it('clears screenshotData when modal is closed and reopened', async () => {
    renderButton()
    // Open
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send feedback/i }))
    })
    expect(screen.getByTestId('feedback-modal').getAttribute('data-screenshot')).toBe(
      'data:image/jpeg;base64,compressed'
    )
    // Close
    fireEvent.click(screen.getByTestId('modal-close'))
    // Reopen — compressImage returns empty this time
    compressImage.mockResolvedValueOnce(null)
    html2canvas.mockResolvedValueOnce({ toDataURL: vi.fn(() => '') })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send feedback/i }))
    })
    // Second open: whatever compressImage returned (null)
    const modal = screen.getByTestId('feedback-modal')
    expect(modal.getAttribute('data-screenshot')).toBe('')
  })
})

// ── Mobile (no auto-capture) ──────────────────────────────────────────────────

describe('FeedbackButton — mobile (no auto-capture)', () => {
  beforeEach(() => {
    isMobile.mockReturnValue(true)
  })

  it('does NOT call html2canvas on mobile', async () => {
    renderButton()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send feedback/i }))
    })
    expect(html2canvas).not.toHaveBeenCalled()
  })

  it('opens the modal immediately on mobile (no capture delay)', async () => {
    renderButton()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send feedback/i }))
    })
    expect(screen.getByTestId('feedback-modal')).toBeDefined()
  })

  it('passes null screenshotData to FeedbackModal on mobile', async () => {
    renderButton()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send feedback/i }))
    })
    const modal = screen.getByTestId('feedback-modal')
    expect(modal.getAttribute('data-screenshot')).toBe('')
  })

  it('does NOT call compressImage on mobile (no auto-capture)', async () => {
    renderButton()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send feedback/i }))
    })
    expect(compressImage).not.toHaveBeenCalled()
  })
})
