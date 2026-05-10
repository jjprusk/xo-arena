// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const { mockNavigate, mockRtFetch } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockRtFetch:  vi.fn(),
}))

vi.mock('react-router-dom', async (orig) => {
  const actual = await orig()
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('../../../lib/rtSession.js', () => ({
  rtFetch: mockRtFetch,
}))

import ChallengeButton from '../ChallengeButton.jsx'

beforeEach(() => {
  vi.clearAllMocks()
})

function renderInRouter(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('<ChallengeButton />', () => {
  it('POSTs /rt/tables { kind: hvb, botUserId } and navigates to /play?join=<slug>', async () => {
    mockRtFetch.mockResolvedValueOnce({ slug: 'abc123' })
    renderInRouter(<ChallengeButton botUserId="bot_xyz" source="profile" />)

    fireEvent.click(screen.getByTestId('challenge-button'))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled())
    expect(mockRtFetch).toHaveBeenCalledWith('/rt/tables', {
      body: { kind: 'hvb', botUserId: 'bot_xyz', gameId: 'xo', spectatorAllowed: true },
    })
    expect(mockNavigate).toHaveBeenCalledWith('/play?join=abc123')
  })

  it('does NOT navigate when the server returns no slug', async () => {
    mockRtFetch.mockResolvedValueOnce({})
    renderInRouter(<ChallengeButton botUserId="bot_xyz" source="rankings" />)
    fireEvent.click(screen.getByTestId('challenge-button'))

    await waitFor(() => expect(screen.getByTestId('challenge-error')).toBeTruthy())
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(screen.getByTestId('challenge-error').textContent).toMatch(/no slug|failed/i)
  })

  it('shows the server error message and re-enables the button', async () => {
    mockRtFetch.mockRejectedValueOnce(Object.assign(new Error('Bot not found'), { status: 404, code: 'BOT_NOT_FOUND' }))
    renderInRouter(<ChallengeButton botUserId="bot_xyz" source="directory" />)

    const btn = screen.getByTestId('challenge-button')
    fireEvent.click(btn)

    await waitFor(() => expect(screen.getByTestId('challenge-error')).toBeTruthy())
    expect(screen.getByTestId('challenge-error').textContent).toBe('Bot not found')
    expect(btn.disabled).toBe(false)  // re-enabled after error
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('disables itself while the request is in flight (no double-fire)', async () => {
    let resolve
    mockRtFetch.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    renderInRouter(<ChallengeButton botUserId="bot_xyz" source="profile" />)

    const btn = screen.getByTestId('challenge-button')
    fireEvent.click(btn)
    expect(btn.disabled).toBe(true)
    expect(btn.textContent).toMatch(/joining/i)

    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(mockRtFetch).toHaveBeenCalledTimes(1)

    resolve({ slug: 's1' })
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/play?join=s1'))
  })

  it('icon variant: still POSTs and navigates; aria-label set', async () => {
    mockRtFetch.mockResolvedValueOnce({ slug: 'icon-slug' })
    renderInRouter(<ChallengeButton botUserId="bot_xyz" variant="icon" source="rankings" />)

    const btn = screen.getByTestId('challenge-button')
    expect(btn.getAttribute('aria-label')).toMatch(/challenge/i)
    fireEvent.click(btn)
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/play?join=icon-slug'))
  })

  it('does nothing when botUserId is missing', () => {
    renderInRouter(<ChallengeButton botUserId={null} source="directory" />)
    fireEvent.click(screen.getByTestId('challenge-button'))
    expect(mockRtFetch).not.toHaveBeenCalled()
  })

  it('respects external `disabled` prop', () => {
    renderInRouter(<ChallengeButton botUserId="b" disabled={true} source="picker" />)
    const btn = screen.getByTestId('challenge-button')
    expect(btn.disabled).toBe(true)
    fireEvent.click(btn)
    expect(mockRtFetch).not.toHaveBeenCalled()
  })

  it('calls onChallengeStart and onChallengeError callbacks', async () => {
    mockRtFetch.mockRejectedValueOnce(new Error('nope'))
    const onStart = vi.fn()
    const onError = vi.fn()
    renderInRouter(
      <ChallengeButton
        botUserId="b"
        source="profile"
        onChallengeStart={onStart}
        onChallengeError={onError}
      />,
    )
    fireEvent.click(screen.getByTestId('challenge-button'))
    await waitFor(() => expect(onError).toHaveBeenCalled())
    expect(onStart).toHaveBeenCalledWith({ botUserId: 'b', source: 'profile' })
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      botUserId: 'b',
      source:    'profile',
      error:     expect.any(Error),
    }))
  })
})
