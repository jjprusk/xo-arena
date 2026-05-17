// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useHelpStore } from '../../../store/helpStore.js'
import HelpAnswer, { ERROR_COPY, errorMessage } from '../HelpAnswer.jsx'

function makeTurn(overrides = {}) {
  return {
    id:                     't-1',
    question:               'how do I train a bot',
    status:                 'pending',
    partial:                '',
    rendered:               null,
    queryId:                null,
    answerId:               null,
    contentFilterTriggered: false,
    degraded:               false,
    latencyMs:              null,
    error:                  null,
    retryAfter:             null,
    startedAt:              0,
    finishedAt:             null,
    ...overrides,
  }
}

function renderAnswer(turn) {
  return render(
    <MemoryRouter>
      <HelpAnswer turn={turn} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  useHelpStore.setState({ thread: [], inFlightTurnId: null, submitFeedback: vi.fn(async () => ({})) })
})

describe('HelpAnswer — status rendering', () => {
  it('pending → renders Thinking…', () => {
    renderAnswer(makeTurn({ status: 'pending' }))
    expect(screen.getByText(/Thinking…/i)).toBeInTheDocument()
    expect(screen.getByText('how do I train a bot')).toBeInTheDocument()
  })

  it('streaming → renders the partial text with a blinking caret', () => {
    renderAnswer(makeTurn({ status: 'streaming', partial: 'Head to the **Gym**' }))
    const body = screen.getByTestId('help-answer-body')
    // Markdown bolds the **Gym** — assert the inner <strong> shows.
    expect(body.querySelector('strong')?.textContent).toBe('Gym')
    // Caret indicator is present (aria-hidden, character ▍).
    expect(body.textContent).toMatch(/▍/)
  })

  it('done → renders the final rendered Markdown without the caret', () => {
    renderAnswer(makeTurn({
      status:   'done',
      partial:  'irrelevant',
      rendered: 'Visit **[Gym](/gym)** to train your bot.',
      queryId:  'q-1',
      answerId: 'a-1',
    }))
    const body = screen.getByTestId('help-answer-body')
    // The link must render as an SPA Link (href to /gym).
    const link = body.querySelector('a')
    expect(link).toBeTruthy()
    expect(link?.getAttribute('href')).toBe('/gym')
    // No streaming caret in done state.
    expect(body.textContent).not.toMatch(/▍/)
  })

  it('done + degraded → shows the degraded footnote', () => {
    renderAnswer(makeTurn({ status: 'done', rendered: 'ok.', degraded: true }))
    expect(screen.getByText(/embedding service was briefly unavailable/i)).toBeInTheDocument()
  })

  it('done + no degraded → does NOT show the footnote', () => {
    renderAnswer(makeTurn({ status: 'done', rendered: 'ok.' }))
    expect(screen.queryByText(/embedding service/i)).toBeNull()
  })
})

describe('HelpAnswer — error states', () => {
  it.each([
    ['auth_required',     /Sign in/i],
    ['llm_unavailable',   /reaching the AI service/i],
    ['aborted',           /Stopped/i],
    ['interrupted',       /interrupted/i],
    ['invalid_request',   /could not process/i],
    ['incomplete_stream', /Connection lost/i],
    ['network',           /Network error/i],
    ['internal',          /Something went wrong/i],
  ])('renders friendly copy for error=%s', (errorCode, expectedCopy) => {
    renderAnswer(makeTurn({ status: 'error', error: errorCode }))
    expect(screen.getByTestId('help-answer-error').textContent).toMatch(expectedCopy)
  })

  it('rate_limited with small retryAfter → app-level wording with countdown', () => {
    renderAnswer(makeTurn({ status: 'error', error: 'rate_limited', retryAfter: 12 }))
    expect(screen.getByTestId('help-answer-error').textContent).toMatch(/wait a bit/i)
    expect(screen.getByTestId('help-answer-error').textContent).toMatch(/retry in 12s/)
  })

  it('rate_limited with large retryAfter → provider-level wording', () => {
    renderAnswer(makeTurn({ status: 'error', error: 'rate_limited', retryAfter: 3600 }))
    expect(screen.getByTestId('help-answer-error').textContent).toMatch(/rate-limited by the AI service/i)
  })

  it('errorMessage pure helper returns the mapped copy', () => {
    expect(errorMessage(makeTurn({ error: 'auth_required' }))).toBe(ERROR_COPY.auth_required)
    expect(errorMessage(makeTurn({ error: 'unknown_code' }))).toBe(ERROR_COPY.internal)
  })
})

describe('HelpAnswer — link tracking', () => {
  it('clicking an internal link fires submitFeedback with implicit.docLinkClicked', () => {
    const submitFeedback = vi.fn(async () => ({}))
    useHelpStore.setState({ submitFeedback })

    renderAnswer(makeTurn({
      status:   'done',
      rendered: 'See **[Gym](/gym)** for details.',
      queryId:  'q-1',
      answerId: 'a-1',
    }))
    const link = screen.getByRole('link', { name: 'Gym' })
    expect(link).toHaveAttribute('href', '/gym')
    fireEvent.click(link)
    expect(submitFeedback).toHaveBeenCalledOnce()
    expect(submitFeedback.mock.calls[0][0]).toEqual({
      queryId:  'q-1',
      answerId: 'a-1',
      implicit: { docLinkClicked: true, href: '/gym' },
    })
  })

  it('does NOT call submitFeedback when the turn has no queryId/answerId yet', () => {
    const submitFeedback = vi.fn(async () => ({}))
    useHelpStore.setState({ submitFeedback })

    // Streaming-stage Markdown: link present but turn is mid-flight.
    renderAnswer(makeTurn({
      status:   'streaming',
      partial:  '[Gym](/gym)',
      queryId:  null,
      answerId: null,
    }))
    const link = screen.getByRole('link', { name: 'Gym' })
    fireEvent.click(link)
    expect(submitFeedback).not.toHaveBeenCalled()
  })

  it('external links open in a new tab and still fire the feedback POST', () => {
    const submitFeedback = vi.fn(async () => ({}))
    useHelpStore.setState({ submitFeedback })

    renderAnswer(makeTurn({
      status:   'done',
      rendered: 'See [the spec](https://example.com/spec) for more.',
      queryId:  'q-1',
      answerId: 'a-1',
    }))
    const link = screen.getByRole('link', { name: 'the spec' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    fireEvent.click(link)
    expect(submitFeedback).toHaveBeenCalledOnce()
    expect(submitFeedback.mock.calls[0][0].implicit.href).toBe('https://example.com/spec')
  })

  it('swallows submitFeedback errors so the click-through still navigates', () => {
    const submitFeedback = vi.fn(async () => { throw new Error('endpoint not built yet') })
    useHelpStore.setState({ submitFeedback })

    renderAnswer(makeTurn({
      status:   'done',
      rendered: 'See **[Gym](/gym)**.',
      queryId:  'q-1',
      answerId: 'a-1',
    }))
    const link = screen.getByRole('link', { name: 'Gym' })
    // Must not throw despite the rejection.
    expect(() => fireEvent.click(link)).not.toThrow()
    expect(submitFeedback).toHaveBeenCalledOnce()
  })
})

// ── Citations (Research_Log_Plan Sprint 3 §3 step 6) ─────────────────────

describe('HelpAnswer — citations', () => {
  it('renders one chip per citation with its lane icon and title', () => {
    renderAnswer(makeTurn({
      status:   'done',
      rendered: 'Use the Gym tab.',
      queryId:  'q-1',
      answerId: 'a-1',
      citations: [
        { docId: 'd1', lane: 'corpus',         slug: 'gym-sessions-tab', title: 'Gym sessions tab' },
        { docId: 'd2', lane: 'communityNotes', slug: 'research-note-n9', title: 'Plateau retrospective', author: { id: 'u2', displayName: 'Bob' } },
      ],
    }))
    expect(screen.getByText('Sources')).toBeInTheDocument()
    expect(screen.getByText('Gym sessions tab')).toBeInTheDocument()
    expect(screen.getByText('Plateau retrospective')).toBeInTheDocument()
    expect(screen.getByText(/Bob/)).toBeInTheDocument()
    // Corpus citation deep-links to /help/<slug>; community link points at journal.
    const corpus = screen.getByText('Gym sessions tab').closest('a')
    expect(corpus.getAttribute('href')).toBe('/help/gym-sessions-tab')
    const community = screen.getByText('Plateau retrospective').closest('a')
    expect(community.getAttribute('href')).toBe('/profile?section=journal')
  })

  it('does not render the Sources block when citations is empty', () => {
    renderAnswer(makeTurn({
      status: 'done', rendered: 'no sources',
      queryId: 'q', answerId: 'a',
      citations: [],
    }))
    expect(screen.queryByText('Sources')).not.toBeInTheDocument()
  })

  it('tags each link with data-lane so styling + analytics can key on it', () => {
    renderAnswer(makeTurn({
      status: 'done', rendered: 'x', queryId: 'q', answerId: 'a',
      citations: [
        { docId: 'd1', lane: 'corpus',         slug: 's', title: 't1' },
        { docId: 'd2', lane: 'privateNotes',   slug: 's', title: 't2' },
        { docId: 'd3', lane: 'communityNotes', slug: 's', title: 't3' },
      ],
    }))
    const lanes = ['corpus', 'privateNotes', 'communityNotes']
    for (const lane of lanes) {
      expect(document.querySelector(`a[data-lane="${lane}"]`)).not.toBeNull()
    }
  })
})
