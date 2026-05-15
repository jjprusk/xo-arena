// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useHelpStore } from '../../../store/helpStore.js'
import HelpThread from '../HelpThread.jsx'

function renderThread() {
  return render(
    <MemoryRouter>
      <HelpThread />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  useHelpStore.setState({ thread: [], inFlightTurnId: null })
})

describe('HelpThread', () => {
  it('renders nothing when the thread is empty', () => {
    const { container } = renderThread()
    expect(container.firstChild).toBeNull()
  })

  it('renders one HelpAnswer per turn in store order', () => {
    useHelpStore.setState({
      thread: [
        { id: 't-1', question: 'first question',  status: 'done', rendered: 'first answer' },
        { id: 't-2', question: 'second question', status: 'done', rendered: 'second answer' },
        { id: 't-3', question: 'pending one',     status: 'pending' },
      ],
    })
    renderThread()
    expect(screen.getByText('first question')).toBeInTheDocument()
    expect(screen.getByText('second question')).toBeInTheDocument()
    expect(screen.getByText('pending one')).toBeInTheDocument()
    expect(screen.getByText(/Thinking…/i)).toBeInTheDocument()
    // Most-recent turn is rendered last (DOM order).
    const turns = screen.getAllByText(/question|pending one/)
    expect(turns[0].textContent).toBe('first question')
    expect(turns.at(-1).textContent).toBe('pending one')
  })
})
