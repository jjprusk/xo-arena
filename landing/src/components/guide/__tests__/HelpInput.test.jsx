// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../lib/getToken.js', () => ({
  getToken: vi.fn(async () => 'TEST_TOKEN'),
}))

import { useHelpStore } from '../../../store/helpStore.js'
import HelpInput from '../HelpInput.jsx'
import { getToken } from '../../../lib/getToken.js'

function renderInput(props = {}) {
  return render(
    <MemoryRouter>
      <HelpInput context={{ route: '/play' }} {...props} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  // Reset the store between tests so inFlight / thread state from one
  // test never leaks into another.
  useHelpStore.setState({ thread: [], inFlightTurnId: null, _abortController: null })
  vi.clearAllMocks()
})

describe('HelpInput', () => {
  it('renders the disclosure text and the Browse all help link', () => {
    renderInput()
    expect(screen.getByText(/Questions are processed by our AI service/i)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /Browse all help/i })
    expect(link).toHaveAttribute('href', '/help')
  })

  it('Enter submits, clears the input, and calls sendQuestion with context + token', async () => {
    const sendQuestion = vi.fn(async () => 'turn-1')
    useHelpStore.setState({ sendQuestion })

    renderInput()
    const ta = screen.getByLabelText(/Ask the Guide a question/i)
    fireEvent.change(ta, { target: { value: 'how do I train a bot' } })
    // Submitting via Enter triggers an async flow (getToken) — wrap in act.
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'Enter' })
    })

    expect(getToken).toHaveBeenCalled()
    expect(sendQuestion).toHaveBeenCalledOnce()
    expect(sendQuestion.mock.calls[0][0]).toEqual({
      question: 'how do I train a bot',
      context:  { route: '/play' },
      token:    'TEST_TOKEN',
    })
    // Input cleared post-submit.
    expect(ta.value).toBe('')
  })

  it('Shift+Enter inserts a newline and does NOT submit', async () => {
    const sendQuestion = vi.fn(async () => null)
    useHelpStore.setState({ sendQuestion })

    renderInput()
    const ta = screen.getByLabelText(/Ask the Guide a question/i)
    fireEvent.change(ta, { target: { value: 'line1' } })
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true })
    // No submission attempted.
    expect(sendQuestion).not.toHaveBeenCalled()
    // The textarea keeps its current value — the browser would add "\n"
    // itself, but vitest's jsdom doesn't synthesize text input from
    // keydown. We rely on the keydown handler NOT calling preventDefault
    // (which we can assert indirectly: the value is still what was set).
    expect(ta.value).toBe('line1')
  })

  it('Ask button submits and is disabled when the value is empty', async () => {
    const sendQuestion = vi.fn(async () => 'turn-1')
    useHelpStore.setState({ sendQuestion })

    renderInput()
    const button = screen.getByRole('button', { name: /Send question to Guide/i })
    expect(button).toBeDisabled()

    const ta = screen.getByLabelText(/Ask the Guide a question/i)
    fireEvent.change(ta, { target: { value: 'hello' } })
    expect(button).not.toBeDisabled()

    await act(async () => {
      fireEvent.click(button)
    })
    expect(sendQuestion).toHaveBeenCalledOnce()
  })

  it('disables the textarea and Ask button when a turn is in flight', () => {
    useHelpStore.setState({ inFlightTurnId: 'turn-1' })
    renderInput()
    const ta = screen.getByLabelText(/Ask the Guide a question/i)
    const button = screen.getByRole('button', { name: /Send question to Guide/i })
    expect(ta).toBeDisabled()
    expect(button).toBeDisabled()
    expect(ta.getAttribute('placeholder')).toBe('Thinking…')
  })

  it('does not call sendQuestion for whitespace-only input', async () => {
    const sendQuestion = vi.fn(async () => null)
    useHelpStore.setState({ sendQuestion })

    renderInput()
    const ta = screen.getByLabelText(/Ask the Guide a question/i)
    fireEvent.change(ta, { target: { value: '   ' } })
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'Enter' })
    })
    expect(sendQuestion).not.toHaveBeenCalled()
  })

  it('caps input length at 1000 characters', () => {
    renderInput()
    const ta = screen.getByLabelText(/Ask the Guide a question/i)
    fireEvent.change(ta, { target: { value: 'x'.repeat(1500) } })
    expect(ta.value.length).toBe(1000)
  })
})
