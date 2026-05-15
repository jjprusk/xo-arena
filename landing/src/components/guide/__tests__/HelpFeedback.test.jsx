// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../../lib/getToken.js', () => ({
  getToken: vi.fn(async () => 'TEST_TOKEN'),
}))

import { useHelpStore } from '../../../store/helpStore.js'
import HelpFeedback from '../HelpFeedback.jsx'

function makeTurn(overrides = {}) {
  return {
    id:       't-1',
    queryId:  'q-1',
    answerId: 'a-1',
    status:   'done',
    ...overrides,
  }
}

function renderFeedback(turnOverrides = {}, opts = {}) {
  const turn = makeTurn(turnOverrides)
  useHelpStore.setState({
    submitFeedback: opts.submitFeedback ?? vi.fn(async () => ({})),
    loadFeedback:   opts.loadFeedback   ?? vi.fn(async () => null),
  })
  return render(<HelpFeedback turn={turn} />)
}

beforeEach(() => {
  useHelpStore.setState({ thread: [], inFlightTurnId: null })
})

describe('HelpFeedback — render gating', () => {
  it('renders nothing for a turn without queryId/answerId', () => {
    const { container } = renderFeedback({ queryId: null, answerId: null })
    expect(container.firstChild).toBeNull()
  })

  it('renders the prompt + both thumbs for a done turn', async () => {
    renderFeedback()
    expect(screen.getByText(/Was this helpful/i)).toBeInTheDocument()
    expect(screen.getByTestId('thumb-up')).toBeInTheDocument()
    expect(screen.getByTestId('thumb-down')).toBeInTheDocument()
    // Category chips hidden until thumb-down.
    expect(screen.queryByTestId('category-chips')).toBeNull()
  })
})

describe('HelpFeedback — prior state load', () => {
  it('reflects an existing HELPFUL row on mount', async () => {
    const loadFeedback = vi.fn(async () => ({
      signal: 'HELPFUL', category: null, comment: null, implicit: {},
    }))
    renderFeedback({}, { loadFeedback })
    await waitFor(() => expect(loadFeedback).toHaveBeenCalled())
    expect(screen.getByTestId('thumb-up').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('thumb-down').getAttribute('aria-pressed')).toBe('false')
  })

  it('reflects an existing NOT_HELPFUL row + category + comment', async () => {
    const loadFeedback = vi.fn(async () => ({
      signal: 'NOT_HELPFUL', category: 'WRONG', comment: 'was off',
      implicit: {},
    }))
    renderFeedback({}, { loadFeedback })
    await waitFor(() => expect(loadFeedback).toHaveBeenCalled())
    await waitFor(() => {
      expect(screen.getByTestId('thumb-down').getAttribute('aria-pressed')).toBe('true')
    })
    expect(screen.getByTestId('category-chips')).toBeInTheDocument()
    expect(screen.getByTestId('chip-WRONG').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('comment-input')).toHaveValue('was off')
  })

  it('survives a loadFeedback failure (silent — user can still submit fresh)', async () => {
    const loadFeedback = vi.fn(async () => { throw new Error('endpoint not built') })
    renderFeedback({}, { loadFeedback })
    await waitFor(() => expect(loadFeedback).toHaveBeenCalled())
    // Component still renders its thumbs.
    expect(screen.getByTestId('thumb-up')).toBeInTheDocument()
  })
})

describe('HelpFeedback — thumb interactions', () => {
  it('clicking thumb-up POSTs signal=HELPFUL and shows thanks', async () => {
    const submitFeedback = vi.fn(async () => ({}))
    renderFeedback({}, { submitFeedback })
    await act(async () => {
      fireEvent.click(screen.getByTestId('thumb-up'))
    })
    expect(submitFeedback).toHaveBeenCalledOnce()
    expect(submitFeedback.mock.calls[0][0]).toMatchObject({
      queryId: 'q-1', answerId: 'a-1', signal: 'HELPFUL', token: 'TEST_TOKEN',
    })
    await waitFor(() => {
      expect(screen.getByTestId('thanks-flash')).toBeInTheDocument()
    })
  })

  it('clicking the same thumb again is a no-op', async () => {
    const submitFeedback = vi.fn(async () => ({}))
    renderFeedback({}, { submitFeedback })
    await act(async () => {
      fireEvent.click(screen.getByTestId('thumb-up'))
    })
    await waitFor(() => expect(submitFeedback).toHaveBeenCalledOnce())
    // Second click on the same thumb.
    await act(async () => {
      fireEvent.click(screen.getByTestId('thumb-up'))
    })
    expect(submitFeedback).toHaveBeenCalledOnce()  // still 1
  })

  it('clicking thumb-down reveals category chips', async () => {
    renderFeedback()
    await act(async () => {
      fireEvent.click(screen.getByTestId('thumb-down'))
    })
    await waitFor(() => {
      expect(screen.getByTestId('category-chips')).toBeInTheDocument()
    })
    expect(screen.getByTestId('chip-OFF_TOPIC')).toBeInTheDocument()
    expect(screen.getByTestId('chip-OUTDATED')).toBeInTheDocument()
    expect(screen.getByTestId('chip-WRONG')).toBeInTheDocument()
    expect(screen.getByTestId('chip-INCOMPLETE')).toBeInTheDocument()
  })

  it('clicking a category chip POSTs category + reflects active state', async () => {
    const submitFeedback = vi.fn(async () => ({}))
    renderFeedback({}, { submitFeedback })
    await act(async () => { fireEvent.click(screen.getByTestId('thumb-down')) })
    await waitFor(() => screen.getByTestId('category-chips'))
    submitFeedback.mockClear()  // ignore the thumb-down POST

    await act(async () => { fireEvent.click(screen.getByTestId('chip-WRONG')) })
    expect(submitFeedback).toHaveBeenCalledOnce()
    expect(submitFeedback.mock.calls[0][0]).toMatchObject({
      queryId: 'q-1', answerId: 'a-1', category: 'WRONG',
    })
    expect(screen.getByTestId('chip-WRONG').getAttribute('aria-pressed')).toBe('true')
  })

  it('flipping NOT_HELPFUL → HELPFUL clears category + comment in the UI', async () => {
    const submitFeedback = vi.fn(async () => ({}))
    const loadFeedback = vi.fn(async () => ({
      signal: 'NOT_HELPFUL', category: 'WRONG', comment: 'was off', implicit: {},
    }))
    renderFeedback({}, { submitFeedback, loadFeedback })
    await waitFor(() => {
      expect(screen.getByTestId('chip-WRONG').getAttribute('aria-pressed')).toBe('true')
    })

    // Click thumb-up — mirror the §3.3 server flip rule client-side.
    await act(async () => { fireEvent.click(screen.getByTestId('thumb-up')) })

    expect(screen.getByTestId('thumb-up').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('thumb-down').getAttribute('aria-pressed')).toBe('false')
    // Category chips are hidden (thumb is HELPFUL now, no chips shown).
    expect(screen.queryByTestId('category-chips')).toBeNull()
  })
})

describe('HelpFeedback — comment input', () => {
  it('shows "Add a comment" toggle after a signal is set', async () => {
    renderFeedback()
    await act(async () => { fireEvent.click(screen.getByTestId('thumb-up')) })
    expect(screen.getByText(/Add a comment/i)).toBeInTheDocument()
  })

  it('clicking the toggle opens the textarea', async () => {
    renderFeedback()
    await act(async () => { fireEvent.click(screen.getByTestId('thumb-up')) })
    await act(async () => { fireEvent.click(screen.getByText(/Add a comment/i)) })
    expect(screen.getByTestId('comment-input')).toBeInTheDocument()
  })

  it('blur on the textarea POSTs comment', async () => {
    const submitFeedback = vi.fn(async () => ({}))
    renderFeedback({}, { submitFeedback })
    await act(async () => { fireEvent.click(screen.getByTestId('thumb-up')) })
    await act(async () => { fireEvent.click(screen.getByText(/Add a comment/i)) })
    submitFeedback.mockClear()

    const ta = screen.getByTestId('comment-input')
    fireEvent.change(ta, { target: { value: 'great answer' } })
    await act(async () => { fireEvent.blur(ta) })

    expect(submitFeedback).toHaveBeenCalledOnce()
    expect(submitFeedback.mock.calls[0][0]).toMatchObject({ comment: 'great answer' })
  })
})
