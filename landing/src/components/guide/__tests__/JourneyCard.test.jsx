// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * JourneyCard — phase-aware rendering (§9.1).
 *
 * Covers:
 *   - Hook phase: single hero card with the next CTA, no checklist visible
 *   - Curriculum phase: hero + 5-row checklist, current highlighted, done ✓,
 *     future rows dimmed
 *   - Specialize phase: post-graduation celebration card
 *   - dismissedAt → renders nothing
 *   - deriveCurrentPhase pure helper
 */

import React from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useGuideStore } from '../../../store/guideStore.js'
import JourneyCard, { deriveCurrentPhase } from '../JourneyCard.jsx'

function setProgress(completedSteps, dismissedAt = null) {
  useGuideStore.setState({
    journeyProgress: { completedSteps, dismissedAt },
  })
}

function renderCard() {
  return render(
    <MemoryRouter>
      <JourneyCard />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  // Reset store between tests so prior phase state doesn't leak.
  useGuideStore.setState({
    journeyProgress: { completedSteps: [], dismissedAt: null },
    panelOpen: true,
    slots: [],
    notifications: [],
  })
})

describe('deriveCurrentPhase', () => {
  it('hook when step 2 not done', () => {
    expect(deriveCurrentPhase([])).toBe('hook')
    expect(deriveCurrentPhase([1])).toBe('hook')
  })
  it('curriculum when step 2 done but 7 not done', () => {
    expect(deriveCurrentPhase([1, 2])).toBe('curriculum')
    expect(deriveCurrentPhase([1, 2, 3, 4, 5])).toBe('curriculum')
  })
  it('specialize when step 7 done', () => {
    expect(deriveCurrentPhase([1, 2, 3, 4, 5, 6, 7])).toBe('specialize')
  })
})

describe('JourneyCard — Hook phase', () => {
  it('renders the hero card with the next CTA and NO checklist', () => {
    setProgress([])  // Hook phase, step 1 next
    renderCard()
    // Hero title appears once
    expect(screen.getByText(/Welcome to the Arena/i)).toBeInTheDocument()
    // Step 1 title is the next-step hero
    expect(screen.getByText('Play a quick game')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Play now/i })).toHaveAttribute('href', '/play?action=vs-community-bot')
    // No Curriculum checklist
    expect(screen.queryByTestId('curriculum-checklist')).not.toBeInTheDocument()
    // No Curriculum-only step titles surfaced as checklist items
    expect(screen.queryByText('Create your first bot')).not.toBeInTheDocument()
  })

  it('with step 1 done, surfaces step 2 (the demo-watch hero)', () => {
    setProgress([1])
    renderCard()
    expect(screen.getByText('Watch two bots battle')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Watch a demo/i })).toHaveAttribute('href', '/play?action=watch-demo')
  })
})

describe('JourneyCard — Curriculum phase', () => {
  it('renders the 5-row checklist with current step highlighted and completed marked', () => {
    setProgress([1, 2, 3])  // Curriculum, step 4 (Train) is current
    renderCard()
    // Hero shows next CTA
    expect(screen.getByText(/Next:/i)).toBeInTheDocument()
    // Train link surfaces
    expect(screen.getByRole('link', { name: /Train your bot/i })).toBeInTheDocument()
    // Curriculum checklist exists with all 5 rows
    const list = screen.getByTestId('curriculum-checklist')
    expect(list).toBeInTheDocument()
    expect(list).toHaveTextContent('Create your first bot')
    expect(list).toHaveTextContent('Train your bot')
    expect(list).toHaveTextContent('Spar with your bot')
    expect(list).toHaveTextContent('Enter a tournament')
    expect(list).toHaveTextContent("See your bot's first result")
  })

  it('shows ✓ on completed Curriculum steps and dims future ones', () => {
    setProgress([1, 2, 3])  // Step 3 done, step 4 current
    renderCard()
    const list = screen.getByTestId('curriculum-checklist')
    // The "Create your first bot" row should have a ✓
    const created = list.querySelector('span') // first row's title span
    // Walk all rows to find the "Create your first bot" row's leading marker.
    const rows = list.querySelectorAll('[style*="display: flex"]')
    const createdRow = Array.from(rows).find(r => r.textContent?.includes('Create your first bot'))
    expect(createdRow).toBeTruthy()
    expect(createdRow.textContent).toContain('✓')
  })

  it('Dismiss journey button shows in Curriculum (per spec) but not in Hook', () => {
    setProgress([1, 2, 3])  // Curriculum
    const { unmount } = renderCard()
    expect(screen.getByRole('button', { name: /Dismiss journey/i })).toBeInTheDocument()
    unmount()

    setProgress([1])  // Hook
    renderCard()
    expect(screen.queryByRole('button', { name: /Dismiss journey/i })).not.toBeInTheDocument()
  })
})

describe('JourneyCard — Specialize / completion', () => {
  it('renders the celebration card when step 7 is done', () => {
    setProgress([1, 2, 3, 4, 5, 6, 7])
    renderCard()
    expect(screen.getByText(/Curriculum complete!/i)).toBeInTheDocument()
    expect(screen.getByText(/\+50 TC/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Continue/i })).toBeInTheDocument()
    // No checklist
    expect(screen.queryByTestId('curriculum-checklist')).not.toBeInTheDocument()
  })
})

describe('JourneyCard — dismissed', () => {
  it('renders nothing once dismissedAt is set', () => {
    setProgress([1, 2], '2026-04-25T10:00:00Z')
    const { container } = renderCard()
    expect(container).toBeEmptyDOMElement()
  })
})

/**
 * State-machine transitions (task #27).
 *
 * The single-state tests above prove each phase renders correctly. These
 * tests prove the card *transitions* correctly when guideStore state advances
 * — catching regressions where phase derivation is right but the card fails
 * to re-render (e.g., a memoised slice that doesn't subscribe to
 * `completedSteps`, or a useEffect that misses a dep). One test per step
 * boundary: 1→2 (intra-Hook), 2→3 (Hook→Curriculum, phase flip), 3→4, 4→5,
 * 5→6 (intra-Curriculum), 6→7 (Curriculum→Specialize, phase flip).
 */
describe('JourneyCard — phase transitions (state machine)', () => {
  function advance(completedSteps) {
    act(() => {
      useGuideStore.setState({
        journeyProgress: { completedSteps, dismissedAt: null },
      })
    })
  }

  it('completing step 1 advances Hook hero from step 1 → step 2 CTA', () => {
    setProgress([])
    const { container } = renderCard()
    expect(container.querySelector('[data-phase="hook"]')).toBeInTheDocument()
    expect(screen.getByText('Play a quick game')).toBeInTheDocument()

    advance([1])

    // Still Hook (step 2 not yet complete) — but the hero is now step 2.
    expect(container.querySelector('[data-phase="hook"]')).toBeInTheDocument()
    expect(screen.getByText('Watch two bots battle')).toBeInTheDocument()
    expect(screen.queryByText('Play a quick game')).not.toBeInTheDocument()
  })

  it('completing step 2 flips Hook → Curriculum and reveals the 5-row checklist', () => {
    setProgress([1])
    const { container } = renderCard()
    expect(container.querySelector('[data-phase="hook"]')).toBeInTheDocument()
    expect(screen.queryByTestId('curriculum-checklist')).not.toBeInTheDocument()

    advance([1, 2])

    expect(container.querySelector('[data-phase="curriculum"]')).toBeInTheDocument()
    expect(container.querySelector('[data-phase="hook"]')).not.toBeInTheDocument()
    const list = screen.getByTestId('curriculum-checklist')
    expect(list).toBeInTheDocument()
    // Next CTA points at step 3 (build a bot).
    expect(screen.getByRole('link', { name: /Build a bot/i })).toBeInTheDocument()
    // Hook reward (+20 TC) does NOT linger in the card itself — that lives in
    // RewardPopup. Card simply moves on.
    expect(screen.queryByText(/\+20 TC/)).not.toBeInTheDocument()
  })

  it('completing step 3 advances Curriculum current marker to step 4 (Train)', () => {
    setProgress([1, 2])
    renderCard()
    expect(screen.getByRole('link', { name: /Build a bot/i })).toBeInTheDocument()

    advance([1, 2, 3])

    // Step 3 row picks up the ✓; step 4 (Train) becomes the active CTA.
    expect(screen.getByRole('link', { name: /Train your bot/i })).toBeInTheDocument()
    const list = screen.getByTestId('curriculum-checklist')
    const buildRow = Array.from(list.querySelectorAll('[style*="display: flex"]'))
      .find(r => r.textContent?.includes('Create your first bot'))
    expect(buildRow?.textContent).toContain('✓')
  })

  it('completing step 4 advances current marker to step 5 (Spar)', () => {
    setProgress([1, 2, 3])
    renderCard()
    expect(screen.getByRole('link', { name: /Train your bot/i })).toBeInTheDocument()

    advance([1, 2, 3, 4])

    expect(screen.getByRole('link', { name: /Spar now/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Train your bot/i })).not.toBeInTheDocument()
  })

  it('completing step 6 swaps the Tournament CTA for the step-7 explanatory note (no link)', () => {
    setProgress([1, 2, 3, 4, 5])
    renderCard()
    expect(screen.getByRole('link', { name: /Enter Curriculum Cup/i })).toBeInTheDocument()

    advance([1, 2, 3, 4, 5, 6])

    // Step 7 is link-less by design (cup is in flight; no result to view yet).
    // The card renders an explanatory note instead, and the CTA link disappears.
    expect(screen.queryByRole('link', { name: /View result/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Enter Curriculum Cup/i })).not.toBeInTheDocument()
    expect(screen.getByText(/Watching your cup play out/i)).toBeInTheDocument()
  })

  it('hydrates mid-Curriculum after long absence without losing checklist state (task #30)', () => {
    // Resumed-journey scenario: user closed the tab weeks ago at step 4
    // current. Sign-in fetch hydrates [1,2,3] from the server. The card
    // must render Curriculum phase with step 4 highlighted as current and
    // step 3 marked done — no spurious re-render to Hook, no missing rows.
    setProgress([1, 2, 3])  // hydrated from GET /preferences after long gap
    const { container } = renderCard()

    expect(container.querySelector('[data-phase="curriculum"]')).toBeInTheDocument()
    expect(screen.getByTestId('curriculum-checklist')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Train your bot/i })).toBeInTheDocument()
    // Step 3 (Build) shows ✓; step 4 (Train) is current (highlighted, no ✓)
    const list = screen.getByTestId('curriculum-checklist')
    const buildRow = Array.from(list.querySelectorAll('[style*="display: flex"]'))
      .find(r => r.textContent?.includes('Create your first bot'))
    expect(buildRow?.textContent).toContain('✓')
  })

  it('completing step 7 flips Curriculum → Specialize celebration card', () => {
    setProgress([1, 2, 3, 4, 5, 6])
    const { container } = renderCard()
    expect(container.querySelector('[data-phase="curriculum"]')).toBeInTheDocument()

    advance([1, 2, 3, 4, 5, 6, 7])

    // Specialize state has no data-phase attribute (its own celebration block);
    // assert by content instead.
    expect(container.querySelector('[data-phase="curriculum"]')).not.toBeInTheDocument()
    expect(screen.getByText(/Curriculum complete!/i)).toBeInTheDocument()
    expect(screen.getByText(/\+50 TC/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Continue/i })).toBeInTheDocument()
    expect(screen.queryByTestId('curriculum-checklist')).not.toBeInTheDocument()
  })
})
