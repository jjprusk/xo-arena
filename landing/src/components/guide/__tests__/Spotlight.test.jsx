// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Spotlight — reusable journey-CTA spotlight overlay.
 *
 * Replaces the per-page ad-hoc `xo-spotlight-pulse` wiring (BotProfilePage
 * step 4) with a single component so adding spotlights to new CTAs (step 5
 * Spar, future step 6 Cup card, etc.) is one render line, not 20.
 *
 * Locked-in behaviour:
 *   - Adds the pulse class to a target ref while active; removes on dismiss.
 *   - Renders a fixed-position scrim (via portal — proves the parent's CSS
 *     containment doesn't trap it).
 *   - Auto-dismisses after `duration` (default 6 s).
 *   - Scrim click fires `onDismiss` so the parent can flip `active=false`.
 *   - Flipping `active=false` from the parent removes the class + scrim.
 */
import React, { useRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import Spotlight from '../Spotlight.jsx'

function Harness({ active, duration, onDismiss }) {
  const ref = useRef(null)
  return (
    <div>
      <button ref={ref} data-testid="cta">Click me</button>
      <Spotlight active={active} target={ref} duration={duration} onDismiss={onDismiss} />
    </div>
  )
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(()  => { vi.useRealTimers() })

describe('Spotlight', () => {
  it('does nothing when active=false: no pulse class', () => {
    render(<Harness active={false} />)
    expect(screen.getByTestId('cta').classList.contains('xo-spotlight-pulse')).toBe(false)
  })

  it('adds pulse class to target when active=true', () => {
    render(<Harness active={true} />)
    expect(screen.getByTestId('cta').classList.contains('xo-spotlight-pulse')).toBe(true)
  })

  // The early dimming-scrim revision was rejected — too heavy for the
  // bot-detail page where users need to read context alongside the CTA.
  // This guard locks in "no fixed-position page-dimming overlay ever
  // mounts from this component" so a later refactor can't silently
  // reintroduce it.
  it('never mounts a page-dimming scrim, regardless of active state', () => {
    const { rerender } = render(<Harness active={true} />)
    expect(document.querySelector('.xo-spotlight-scrim')).toBeNull()
    rerender(<Harness active={false} />)
    expect(document.querySelector('.xo-spotlight-scrim')).toBeNull()
  })

  it('auto-dismisses after duration via onDismiss', async () => {
    const onDismiss = vi.fn()
    render(<Harness active={true} duration={3000} onDismiss={onDismiss} />)
    expect(onDismiss).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(3000) })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('removes pulse class when parent flips active back to false', () => {
    const { rerender } = render(<Harness active={true} />)
    expect(screen.getByTestId('cta').classList.contains('xo-spotlight-pulse')).toBe(true)

    rerender(<Harness active={false} />)
    expect(screen.getByTestId('cta').classList.contains('xo-spotlight-pulse')).toBe(false)
  })

  it('cleanup on unmount: pulse class removed, no leaked timer firing', async () => {
    const onDismiss = vi.fn()
    const { unmount, container } = render(<Harness active={true} duration={3000} onDismiss={onDismiss} />)
    const cta = container.querySelector('[data-testid="cta"]')
    unmount()
    expect(cta.classList.contains('xo-spotlight-pulse')).toBe(false)
    // Timer was registered before unmount; advancing past duration must not
    // fire onDismiss (cleanup cleared it).
    await act(async () => { vi.advanceTimersByTime(5000) })
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
