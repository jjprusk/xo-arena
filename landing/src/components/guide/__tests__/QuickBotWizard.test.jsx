// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * QuickBotWizard — Curriculum step 3 friction-reduced bot creation (§5.3).
 *
 * Covers:
 *   - Three-step navigation: Name → Persona → Confirm with Back working
 *   - Empty-name validation blocks Next
 *   - Confirm POSTs to api.bots.quickCreate with the right body
 *   - Server NAME_TAKEN bounces the user back to the Name step
 *   - Cancel button on first step calls onCancel
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../../lib/api.js', () => ({
  api: { bots: { quickCreate: vi.fn() } },
}))

import { api } from '../../../lib/api.js'
import QuickBotWizard from '../QuickBotWizard.jsx'

const getToken = () => Promise.resolve('test-token')

beforeEach(() => {
  vi.clearAllMocks()
})

function renderWizard(props = {}) {
  return render(
    <QuickBotWizard
      onCreated={vi.fn()}
      onCancel={vi.fn()}
      getToken={getToken}
      {...props}
    />
  )
}

describe('QuickBotWizard', () => {
  it('walks through Name → Persona → Confirm and POSTs the right body', async () => {
    const onCreated = vi.fn()
    api.bots.quickCreate.mockResolvedValue({ bot: { id: 'bot_42', displayName: 'Spark' } })
    renderWizard({ onCreated })

    // Step 1 — Name
    expect(screen.getByText(/Name your bot/i)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Bot name/i), { target: { value: 'Spark' } })
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))

    // Step 2 — Persona (defaults to Aggressive)
    expect(screen.getByText(/Pick a persona/i)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/Cautious/i))
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))

    // Step 3 — Confirm — match the heading specifically (the step-strip
    // also has a "Confirm" label).
    expect(screen.getByRole('heading', { name: /^Confirm$/i })).toBeInTheDocument()
    expect(screen.getByText('Spark')).toBeInTheDocument()
    expect(screen.getByText('Cautious')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Create my bot/i }))

    await waitFor(() => {
      expect(api.bots.quickCreate).toHaveBeenCalledWith(
        { name: 'Spark', persona: 'cautious' },
        'test-token',
      )
    })
    expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'bot_42' }),
      expect.objectContaining({ persona: 'cautious' }),
    )
  })

  it('blocks the Next button when the name is empty', async () => {
    renderWizard()
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/give your bot a name/i)
    // Still on the Name step.
    expect(screen.getByText(/Name your bot/i)).toBeInTheDocument()
  })

  it('Back from step 2 returns to Name with the value preserved', () => {
    renderWizard()
    fireEvent.change(screen.getByLabelText(/Bot name/i), { target: { value: 'Spark' } })
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))
    fireEvent.click(screen.getByRole('button', { name: /Back/i }))
    expect(screen.getByLabelText(/Bot name/i).value).toBe('Spark')
  })

  it('NAME_TAKEN response bounces the user back to the Name step with a friendly error', async () => {
    api.bots.quickCreate.mockRejectedValue(
      Object.assign(new Error('"Spark" is already taken'), { code: 'NAME_TAKEN', status: 409 }),
    )
    renderWizard()
    fireEvent.change(screen.getByLabelText(/Bot name/i), { target: { value: 'Spark' } })
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))
    fireEvent.click(screen.getByRole('button', { name: /Create my bot/i }))

    await waitFor(() => expect(screen.getByText(/Name your bot/i)).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent(/already in use/i)
  })

  it('Cancel on step 1 calls onCancel', () => {
    const onCancel = vi.fn()
    renderWizard({ onCancel })
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }))
    expect(onCancel).toHaveBeenCalled()
  })
})
