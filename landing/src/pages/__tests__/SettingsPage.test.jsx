import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../lib/useOptimisticSession.js', () => ({
  useOptimisticSession: vi.fn(),
}))

vi.mock('../../lib/getToken.js', () => ({
  getToken: vi.fn(() => Promise.resolve('test-token')),
}))

// Mock fetch globally
global.fetch = vi.fn()

import { useOptimisticSession } from '../../lib/useOptimisticSession.js'
import SettingsPage from '../SettingsPage.jsx'

function renderSettings() {
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SettingsPage', () => {
  it('shows sign-in prompt when not authenticated', () => {
    useOptimisticSession.mockReturnValue({ data: null, isPending: false })
    renderSettings()
    expect(screen.getByText(/Sign in to manage settings/i)).toBeDefined()
  })

  it('renders nothing while auth is pending', () => {
    useOptimisticSession.mockReturnValue({ data: null, isPending: true })
    const { container } = renderSettings()
    expect(container.firstChild).toBeNull()
  })

  it('shows the settings heading when signed in and prefs have loaded', async () => {
    useOptimisticSession.mockReturnValue({
      data: { user: { id: 'u1', role: 'user' } },
      isPending: false,
    })
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tournamentResultNotifPref: 'AS_PLAYED', flashStartAlerts: true }),
    })

    renderSettings()
    await waitFor(() => expect(screen.getByText('Settings')).toBeDefined())
  })

  it('shows both notification preference options', async () => {
    useOptimisticSession.mockReturnValue({
      data: { user: { id: 'u1', role: 'user' } },
      isPending: false,
    })
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tournamentResultNotifPref: 'AS_PLAYED', flashStartAlerts: true }),
    })

    renderSettings()
    await waitFor(() => screen.getByText('As played'))
    expect(screen.getByText('End of tournament')).toBeDefined()
  })

  it('saves notification preference when an option is clicked', async () => {
    useOptimisticSession.mockReturnValue({
      data: { user: { id: 'u1', role: 'user' } },
      isPending: false,
    })
    // Initial load
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tournamentResultNotifPref: 'AS_PLAYED', flashStartAlerts: false }),
    })
    // Save call
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tournamentResultNotifPref: 'END_OF_TOURNAMENT', flashStartAlerts: false }),
    })

    renderSettings()
    await waitFor(() => screen.getByText('End of tournament'))
    fireEvent.click(screen.getByText('End of tournament'))

    await waitFor(() => {
      const saveCalls = global.fetch.mock.calls.filter(([, opts]) => opts?.method === 'PATCH')
      expect(saveCalls.length).toBe(1)
      const body = JSON.parse(saveCalls[0][1].body)
      expect(body.tournamentResultNotifPref).toBe('END_OF_TOURNAMENT')
    })
  })

  it('toggles flash alerts', async () => {
    useOptimisticSession.mockReturnValue({
      data: { user: { id: 'u1', role: 'user' } },
      isPending: false,
    })
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tournamentResultNotifPref: 'AS_PLAYED', flashStartAlerts: true }),
    })
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ flashStartAlerts: false }),
    })

    renderSettings()
    await waitFor(() => screen.getByLabelText('Disable flash alerts'))
    fireEvent.click(screen.getByLabelText('Disable flash alerts'))

    await waitFor(() => {
      const saveCalls = global.fetch.mock.calls.filter(([, opts]) => opts?.method === 'PATCH')
      expect(saveCalls.length).toBe(1)
      const body = JSON.parse(saveCalls[0][1].body)
      expect(body.flashStartAlerts).toBe(false)
    })
  })
})
