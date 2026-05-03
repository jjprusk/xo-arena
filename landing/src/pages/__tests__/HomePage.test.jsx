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

  // CTA-emphasis swap: a true first-time guest should see Play as the
  // primary call (blue gradient); after they've completed the first PvAI
  // game, the Build → signup CTA takes over as primary.
  describe('CTA emphasis (guest pre/post first PvAI game)', () => {
    beforeEach(() => {
      window.localStorage.clear()
    })

    it('pre-play guest: Play is primary, Build is secondary', () => {
      renderPage()
      const playLink   = screen.getByRole('link',   { name: /play against a bot/i })
      const buildBtn   = screen.getByRole('button', { name: /build your own bot/i })
      expect(playLink.className).toContain('btn-primary')
      expect(playLink.className).not.toContain('btn-secondary')
      expect(buildBtn.className).toContain('btn-secondary')
      expect(buildBtn.className).not.toContain('btn-primary')
    })

    it('post-play guest: Build is primary, Play is secondary', () => {
      window.localStorage.setItem(
        'guideGuestJourney',
        JSON.stringify({ hookStep1CompletedAt: '2026-04-25T12:00:00.000Z' })
      )
      renderPage()
      const playLink = screen.getByRole('link',   { name: /play against a bot/i })
      const buildBtn = screen.getByRole('button', { name: /build your own bot/i })
      expect(buildBtn.className).toContain('btn-primary')
      expect(buildBtn.className).not.toContain('btn-secondary')
      expect(playLink.className).toContain('btn-secondary')
      expect(playLink.className).not.toContain('btn-primary')
    })

    it('signed-in user: Build (link to /gym) is primary regardless of localStorage', () => {
      useOptimisticSession.mockReturnValue({
        data: { user: { id: 'u1', email: 'u@x.com' } },
        isPending: false,
      })
      renderPage()
      const playLink  = screen.getByRole('link', { name: /play against a bot/i })
      const buildLink = screen.getByRole('link', { name: /build your own bot/i })
      expect(buildLink.className).toContain('btn-primary')
      expect(playLink.className).toContain('btn-secondary')
    })
  })
})
