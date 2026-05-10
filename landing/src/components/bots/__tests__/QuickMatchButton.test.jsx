// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const { mockNavigate, mockRtFetch, mockApi, mockGetToken } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockRtFetch:  vi.fn(),
  mockApi:      { bots: { quickMatch: vi.fn() } },
  mockGetToken: vi.fn(),
}))

vi.mock('react-router-dom', async (orig) => {
  const actual = await orig()
  return { ...actual, useNavigate: () => mockNavigate }
})
vi.mock('../../../lib/rtSession.js', () => ({ rtFetch: mockRtFetch }))
vi.mock('../../../lib/api.js', () => ({ api: mockApi }))
vi.mock('../../../lib/getToken.js', () => ({ getToken: mockGetToken }))

import QuickMatchButton from '../QuickMatchButton.jsx'

beforeEach(() => {
  vi.clearAllMocks()
  mockGetToken.mockResolvedValue(null)  // guest by default
})

function renderInRouter(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('<QuickMatchButton />', () => {
  it('happy path: quickMatch → rtFetch → navigate to /play?join=<slug>', async () => {
    mockApi.bots.quickMatch.mockResolvedValueOnce({ botUserId: 'b_picked', displayName: 'Sterling' })
    mockRtFetch.mockResolvedValueOnce({ slug: 'qm-slug' })

    renderInRouter(<QuickMatchButton />)
    fireEvent.click(screen.getByTestId('quick-match-button'))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled())
    expect(mockApi.bots.quickMatch).toHaveBeenCalledWith({ gameId: 'xo', eloWindow: 100, token: null })
    expect(mockRtFetch).toHaveBeenCalledWith('/rt/tables', {
      body: { kind: 'hvb', botUserId: 'b_picked', gameId: 'xo', spectatorAllowed: true },
    })
    expect(mockNavigate).toHaveBeenCalledWith('/play?join=qm-slug')
  })

  it('shows the friendly empty-pool message on 404 NO_CANDIDATES', async () => {
    mockApi.bots.quickMatch.mockRejectedValueOnce(
      Object.assign(new Error('No bots available'), { status: 404, code: 'NO_CANDIDATES' }),
    )
    renderInRouter(<QuickMatchButton />)
    fireEvent.click(screen.getByTestId('quick-match-button'))
    await waitFor(() => expect(screen.getByTestId('quick-match-error')).toBeTruthy())
    expect(screen.getByTestId('quick-match-error').textContent).toMatch(/No bots available/i)
    expect(mockRtFetch).not.toHaveBeenCalled()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('shows a generic error if rtFetch fails after a successful quick-match', async () => {
    mockApi.bots.quickMatch.mockResolvedValueOnce({ botUserId: 'b_picked', displayName: 'X' })
    mockRtFetch.mockRejectedValueOnce(new Error('boom'))
    renderInRouter(<QuickMatchButton />)
    fireEvent.click(screen.getByTestId('quick-match-button'))
    await waitFor(() => expect(screen.getByTestId('quick-match-error')).toBeTruthy())
    expect(screen.getByTestId('quick-match-error').textContent).toBe('boom')
  })

  it('disables the button while in flight (no double-fire)', async () => {
    let resolve
    mockApi.bots.quickMatch.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    renderInRouter(<QuickMatchButton />)

    const btn = screen.getByTestId('quick-match-button')
    fireEvent.click(btn)
    // Wait for getToken() and the quickMatch call to fire, then assert
    // the disabled state.
    await waitFor(() => expect(mockApi.bots.quickMatch).toHaveBeenCalledTimes(1))
    expect(btn.disabled).toBe(true)
    expect(btn.textContent).toMatch(/finding/i)

    // Subsequent clicks while the first request is still pending should
    // be no-ops — the button is disabled and the busy guard short-circuits.
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(mockApi.bots.quickMatch).toHaveBeenCalledTimes(1)

    resolve({ botUserId: 'b', displayName: 'x' })
    mockRtFetch.mockResolvedValueOnce({ slug: 's' })
    await waitFor(() => expect(mockNavigate).toHaveBeenCalled())
  })

  it('passes the auth token through to api.bots.quickMatch when signed in', async () => {
    mockGetToken.mockResolvedValueOnce('jwt-token')
    mockApi.bots.quickMatch.mockResolvedValueOnce({ botUserId: 'b1', displayName: 'X' })
    mockRtFetch.mockResolvedValueOnce({ slug: 's' })
    renderInRouter(<QuickMatchButton />)
    fireEvent.click(screen.getByTestId('quick-match-button'))
    await waitFor(() => expect(mockApi.bots.quickMatch).toHaveBeenCalled())
    expect(mockApi.bots.quickMatch.mock.calls[0][0].token).toBe('jwt-token')
  })

  it('honors gameId + eloWindow props', async () => {
    mockApi.bots.quickMatch.mockResolvedValueOnce({ botUserId: 'b1', displayName: 'X' })
    mockRtFetch.mockResolvedValueOnce({ slug: 's' })
    renderInRouter(<QuickMatchButton gameId="connect4" eloWindow={250} />)
    fireEvent.click(screen.getByTestId('quick-match-button'))
    await waitFor(() => expect(mockApi.bots.quickMatch).toHaveBeenCalled())
    expect(mockApi.bots.quickMatch).toHaveBeenCalledWith({ gameId: 'connect4', eloWindow: 250, token: null })
  })
})
