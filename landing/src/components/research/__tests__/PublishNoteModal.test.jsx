// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Tests for the publish confirmation modal — Sprint 2 of
 * doc/Research_Log_Plan.md §3 step 10.
 */
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import PublishNoteModal from '../PublishNoteModal.jsx'

function noteWithEmail() {
  return { id: 'n1', body: 'reach me at joe@example.com', tags: [] }
}

describe('PublishNoteModal', () => {
  it('renders side-by-side preview with the scrubbed body', () => {
    render(<PublishNoteModal kind="note" item={noteWithEmail()} onCancel={() => {}} onConfirm={() => {}} />)
    // Original visible
    expect(screen.getByText(/reach me at joe@example\.com/)).toBeInTheDocument()
    // Scrubbed version
    expect(screen.getByText(/\[email redacted\]/)).toBeInTheDocument()
  })

  it('shows a redaction chip for the email kind', () => {
    render(<PublishNoteModal kind="note" item={noteWithEmail()} onCancel={() => {}} onConfirm={() => {}} />)
    expect(screen.getByText(/Email × 1/)).toBeInTheDocument()
  })

  it('disables the publish button until the confirm checkbox is ticked', () => {
    const onConfirm = vi.fn()
    render(<PublishNoteModal kind="note" item={noteWithEmail()} onCancel={() => {}} onConfirm={onConfirm} />)
    const publish = screen.getByRole('button', { name: 'Publish' })
    expect(publish).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(publish).not.toBeDisabled()
    fireEvent.click(publish)
    expect(onConfirm).toHaveBeenCalled()
  })

  it('shows "Publishing…" and disables Publish when busy', () => {
    render(<PublishNoteModal kind="note" item={noteWithEmail()} busy onCancel={() => {}} onConfirm={() => {}} />)
    expect(screen.getByRole('button', { name: /Publishing/ })).toBeDisabled()
  })

  it('surfaces an error message when provided', () => {
    render(<PublishNoteModal kind="note" item={noteWithEmail()} error="Weekly publish limit reached." onCancel={() => {}} onConfirm={() => {}} />)
    expect(screen.getByText('Weekly publish limit reached.')).toBeInTheDocument()
  })

  it('renders the entry title in the modal when kind=entry', () => {
    render(
      <PublishNoteModal
        kind="entry"
        item={{ id: 'e1', title: 'Q-learning plateau', body: 'b', tags: [] }}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    )
    expect(screen.getByText('Q-learning plateau')).toBeInTheDocument()
  })

  it('says "No automatic redactions detected" when input is clean', () => {
    render(
      <PublishNoteModal
        kind="note"
        item={{ id: 'n2', body: 'plateau after 20k episodes', tags: [] }}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    )
    expect(screen.getByText(/No automatic redactions detected/)).toBeInTheDocument()
  })
})
