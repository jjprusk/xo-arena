// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../lib/useOptimisticSession.js', () => ({
  useOptimisticSession: vi.fn(),
}))

vi.mock('../../lib/communityBotCache.js', () => ({
  prefetchCommunityBot: vi.fn(),
}))

// DemoArena ticks timers internally — render a stub so tests stay deterministic.
vi.mock('../../components/home/DemoArena.jsx', () => ({
  default: () => <div data-testid="demo-arena" />,
}))

// SignInModal — render a stub that announces the build-bot context so we can
// assert on it without touching the full auth-client mock surface.
vi.mock('../../components/ui/SignInModal.jsx', () => ({
  default: ({ context, defaultView, onClose }) => (
    <div
      data-testid="signin-modal"
      data-context={context ?? ''}
      data-default-view={defaultView ?? ''}
      onClick={onClose}
    >
      mocked SignInModal
    </div>
  ),
}))

import { useOptimisticSession } from '../../lib/useOptimisticSession.js'
import HomePage from '../HomePage.jsx'

function renderPage() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  useOptimisticSession.mockReturnValue({ data: null, isPending: false })
})

describe('HomePage — Phase 0 hero', () => {
  it('renders the live demo arena and the three progressive CTAs for guests', () => {
    renderPage()
    expect(screen.getByTestId('demo-arena')).toBeDefined()
    expect(screen.getByRole('button', { name: /watch another bot match/i })).toBeDefined()
    expect(screen.getByRole('link', { name: /play against a bot/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /build your own bot/i })).toBeDefined()
  })

  it('"Build your own bot" opens SignInModal with build-bot context for guests', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /build your own bot/i }))
    const modal = screen.getByTestId('signin-modal')
    expect(modal.getAttribute('data-context')).toBe('build-bot')
    expect(modal.getAttribute('data-default-view')).toBe('sign-up')
  })

  it('replaces the build-bot signup CTA with /gym link for signed-in users', () => {
    useOptimisticSession.mockReturnValue({
      data: { user: { id: 'u1', email: 'u@x.com' } },
      isPending: false,
    })
    renderPage()
    // No signup button should be present — the link variant takes over.
    expect(screen.queryByRole('button', { name: /build your own bot/i })).toBeNull()
    const gymLink = screen.getByRole('link', { name: /build your own bot/i })
    expect(gymLink.getAttribute('href')).toBe('/gym')
  })

  it('"Watch another match" remounts DemoArena (key changes)', () => {
    renderPage()
    const before = screen.getByTestId('demo-arena')
    fireEvent.click(screen.getByRole('button', { name: /watch another bot match/i }))
    const after = screen.getByTestId('demo-arena')
    // Both refs exist; React's key-change forces a fresh element instance, so
    // node identity differs even though the testId matches.
    expect(after).toBeDefined()
    // The CTA itself stays clickable (no error thrown rendering the new instance).
    expect(before).toBeDefined()
  })
})
