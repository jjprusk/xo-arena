// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * RewardPopup — phase-boundary reward celebration (Sprint 3 §9.1).
 *
 * Listens for `guide:hook_complete` and `guide:curriculum_complete` socket
 * events, both emitted by backend `journeyService` after the corresponding
 * step trigger fires. Renders a dismissible overlay with the reward amount
 * and a "next phase" hint.
 *
 * Why a popup, not just the in-stack notification: the existing
 * `guide:notification` event already lands a toast in the GuidePanel — but
 * those are easy to miss. Hitting the end of Hook is a deliberate,
 * celebratory moment; the popup makes it impossible to miss without being
 * intrusive (auto-dismisses after 8s, click-to-close, no input blocking).
 *
 * Idempotent at the backend level (journeyService.completeStep dedupes step
 * completions), but if the socket re-fires we still suppress duplicates by
 * id.
 */

import React, { useEffect, useRef, useState } from 'react'
import { useEventStream } from '../../lib/useEventStream.js'

const AUTO_DISMISS_MS = 8_000

export default function RewardPopup() {
  const [active, setActive] = useState(null)
  const dismissTimerRef = useRef(null)

  // Stable show() across both transports — sub-effects below call into it.
  const showRef = useRef(null)
  showRef.current = (reward) => {
    setActive(reward)
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
    dismissTimerRef.current = setTimeout(() => setActive(null), AUTO_DISMISS_MS)
  }

  function buildHookReward({ reward, message } = {}) {
    return {
      kind:     'hook',
      title:    'Off to a great start!',
      amount:   reward ?? 20,
      body:     message ?? 'Welcome to the Arena.',
      nextHint: 'Up next: build your first bot.',
    }
  }
  function buildCurriculumReward({ reward, message } = {}) {
    return {
      kind:     'curriculum',
      title:    'Journey complete!',
      amount:   reward ?? 50,
      body:     message ?? 'You earned the graduation reward.',
      nextHint: "You're now in Specialize — personalized recommendations unlock here.",
    }
  }

  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
    }
  }, [])

  useEventStream({
    channels: ['guide:'],
    onEvent: (channel, payload) => {
      if (channel === 'guide:hook_complete')       showRef.current(buildHookReward(payload))
      if (channel === 'guide:curriculum_complete') showRef.current(buildCurriculumReward(payload))
    },
  })

  if (!active) return null

  const accent = active.kind === 'hook' ? 'var(--color-amber-500)' : 'var(--color-teal-500)'
  const accentSoft = active.kind === 'hook' ? 'rgba(212,137,30,0.12)' : 'rgba(36,181,135,0.12)'

  return (
    <div
      role="alert" aria-live="polite"
      data-testid="reward-popup"
      style={{
        position: 'fixed', top: '5rem', left: '50%', transform: 'translateX(-50%)',
        zIndex: 1000, maxWidth: 380, width: 'calc(100% - 2rem)',
        background: 'var(--bg-surface, #1a2030)',
        border: `1.5px solid ${accent}`,
        borderRadius: '0.75rem', boxShadow: '0 16px 42px rgba(0,0,0,0.45)',
        padding: '1rem 1.25rem',
        animation: 'reward-pop-in 0.32s cubic-bezier(0.34,1.56,0.64,1)',
      }}
    >
      <style>{`
        @keyframes reward-pop-in {
          from { opacity: 0; transform: translate(-50%, -8px) scale(0.95); }
          to   { opacity: 1; transform: translate(-50%, 0) scale(1); }
        }
      `}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
        <div
          aria-hidden="true"
          style={{
            width: 36, height: 36, borderRadius: '50%',
            background: accentSoft, color: accent,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.25rem', fontWeight: 700,
          }}
        >
          🎉
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--text-primary)' }}>
            {active.title}
          </div>
          <div style={{ fontWeight: 700, fontSize: '0.875rem', color: accent, marginTop: 1 }}>
            +{active.amount} Tournament Credits
          </div>
        </div>
        <button
          type="button"
          onClick={() => setActive(null)}
          aria-label="Dismiss reward popup"
          style={{
            background: 'transparent', border: 'none', color: 'var(--text-muted)',
            fontSize: '1rem', padding: 4, cursor: 'pointer', lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>
      <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
        {active.body}
      </p>
      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5, margin: '0.5rem 0 0' }}>
        {active.nextHint}
      </p>
    </div>
  )
}
