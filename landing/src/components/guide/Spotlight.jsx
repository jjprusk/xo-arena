// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { useEffect } from 'react'

/**
 * Reusable spotlight overlay for journey CTAs.
 *
 * The journey lands users on `/foo?action=bar` for each curriculum step.
 * The destination CTA (Train button, Spar block, …) is often buried below
 * the fold and visually identical to surrounding controls; users miss it.
 * This component:
 *
 *   - Applies `xo-spotlight-pulse` to a caller-provided ref so the target
 *     element gets an amber pulsing halo and reads as "the next thing to
 *     do here" without competing with surrounding chrome.
 *   - Scrolls the target into view (`block: 'center'`, smooth) once.
 *   - Auto-dismisses after `duration` (default 6 s), or when the parent
 *     flips `active` to false.
 *
 * Earlier revisions also rendered a fixed-position dimming scrim over the
 * whole page so the spotlit CTA jumped out. In practice that scrim was
 * heavier than the situation warranted (the bot-detail page in particular
 * has lots of context the user wants to read alongside the CTA), so the
 * scrim was removed in favour of the pulse-only treatment. The
 * `xo-spotlight-scrim` CSS class still exists in `index.css` for any
 * future caller that explicitly opts in.
 *
 * Parent owns `active` state and the dismiss reaction so there's exactly
 * one source of truth — set `active = false` and the component tears down
 * the class on the next effect tick. `onDismiss` is invoked on timer
 * expiry so the parent can mirror that into its own state without polling.
 *
 * Notes:
 *   - The pulse class is mutated *imperatively* on the target element
 *     (rather than passed back via render-prop) so callers don't have to
 *     conditionally template the className on every CTA target. The class
 *     is removed in the effect cleanup, so an unmount or `active=false`
 *     leaves the element exactly as it was.
 *   - Target may not be in the DOM yet when this component first mounts
 *     (conditional render gated on data load). Parents should gate
 *     `active` on `!loading` — same pattern the BotProfilePage step-4
 *     stop-gap used.
 */
export default function Spotlight({ active, target, duration = 6000, onDismiss }) {
  useEffect(() => {
    if (!active) return undefined
    const el = target?.current
    if (!el) return undefined

    el.classList.add('xo-spotlight-pulse')
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch { /* jsdom etc. */ }

    const t = setTimeout(() => { onDismiss?.() }, duration)
    return () => {
      clearTimeout(t)
      // Defensive — the ref's element may have been replaced or unmounted
      // between mount and cleanup; guard against null.
      el.classList?.remove?.('xo-spotlight-pulse')
    }
  }, [active, target, duration, onDismiss])

  return null
}
