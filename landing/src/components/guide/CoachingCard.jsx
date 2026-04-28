// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * CoachingCard — post-Curriculum-Cup advice card (Intelligent Guide §5.5).
 *
 * Listens for `guide:coaching_card`, emitted by the backend tournamentBridge
 * when an isCup tournament completes for a real user. Renders the matching
 * card from `coachingCardRules.js` (server-picked, just rendered here).
 *
 * Sits alongside RewardPopup — both mount in AppLayout. The reward popup
 * fires on `guide:curriculum_complete`; this card on `guide:coaching_card`.
 * They can appear at the same time on the screen — the card is below the
 * popup (different vertical anchor) so they don't overlap.
 *
 * Persistent until the user clicks the CTA or dismisses (no auto-dismiss):
 * the CTA is the actual goal of the post-cup flow, so we don't yank the
 * card out from under them.
 */

import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useEventStream } from '../../lib/useEventStream.js'

export default function CoachingCard() {
  const [active, setActive] = useState(null)
  const navigate = useNavigate()

  useEventStream({
    channels: ['guide:'],
    onEvent: (channel, payload) => {
      if (channel !== 'guide:coaching_card') return
      if (!payload?.card) return
      setActive(payload)
    },
  })

  if (!active) return null
  const { card, tournamentName, finalPosition } = active

  function handleCta() {
    setActive(null)
    if (card.ctaHref) navigate(card.ctaHref)
  }

  return (
    <div
      role="dialog"
      aria-label="Cup coaching card"
      data-testid="coaching-card"
      style={{
        position: 'fixed', top: '13rem', left: '50%', transform: 'translateX(-50%)',
        zIndex: 999, maxWidth: 380, width: 'calc(100% - 2rem)',
        background: 'var(--bg-surface, #1a2030)',
        border: '1.5px solid var(--color-blue-500, #3b82f6)',
        borderRadius: '0.75rem', boxShadow: '0 16px 42px rgba(0,0,0,0.45)',
        padding: '1rem 1.25rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.25rem' }}>
        <span style={{ fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          {tournamentName ?? 'Curriculum Cup'} · finished #{finalPosition}
        </span>
        <button
          type="button"
          onClick={() => setActive(null)}
          aria-label="Dismiss coaching card"
          style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '0.875rem', cursor: 'pointer', padding: 2, lineHeight: 1 }}
        >
          ✕
        </button>
      </div>
      <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '0.375rem' }}>
        {card.title}
      </div>
      <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 0.875rem' }}>
        {card.body}
      </p>
      <button
        type="button"
        onClick={handleCta}
        style={{
          width: '100%', padding: '0.5rem 0.875rem',
          background: 'var(--color-blue-600, #2563eb)', color: 'white',
          border: 'none', borderRadius: '0.5rem',
          fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer',
        }}
      >
        {card.ctaLabel}
      </button>
    </div>
  )
}
