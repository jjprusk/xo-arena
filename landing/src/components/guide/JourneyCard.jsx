// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useGuideStore } from '../../store/guideStore.js'
import { POST_JOURNEY_SLOTS } from './slotActions.js'
import {
  JOURNEY_STEPS as STEPS,
  TOTAL_STEPS as TOTAL,
  deriveCurrentPhase,
} from './journeySteps.js'

/**
 * JourneyCard — phase-aware rendering of the 7-step Hook + Curriculum journey.
 *
 * Phase derivation (mirrors `deriveCurrentPhase` in backend journeyService.js):
 *   hook        — step 2 not yet done
 *   curriculum  — step 2 done, step 7 not yet done
 *   specialize  — step 7 done (renders the post-graduation "Onboarding
 *                 complete" celebration; full Specialize card stack ships in v1.1)
 *
 * Per §9.1:
 *   Hook phase     — single hero card with the next CTA, no checklist preview
 *   Curriculum     — hero card + 5-row checklist with current highlighted,
 *                    completed ✓, future dimmed
 *   Specialize     — placeholder for now; v1.1 wires the recommendation stack
 *
 * All journey-step triggers are server-detected (POST /journey/step was
 * removed in Sprint 1). The card is read-only; it observes journeyProgress
 * coming from socket `guide:journeyStep` events relayed into the guide store.
 *
 * Step metadata (titles, CTAs, hrefs) lives in journeySteps.js — shared with
 * SlotGrid so the two journey surfaces can't drift.
 */

// Re-export so existing test imports (`import { deriveCurrentPhase } from
// '../JourneyCard.jsx'`) keep working without touching test files.
export { deriveCurrentPhase }

const RING_R    = 13
const RING_C    = 18
const RING_CIRC = 2 * Math.PI * RING_R

function ProgressRing({ completed, complete }) {
  const dashOffset = RING_CIRC * (1 - completed / TOTAL)
  const strokeColor = complete ? 'var(--color-teal-500)' : 'var(--color-amber-500)'
  return (
    <svg
      width={RING_C * 2} height={RING_C * 2}
      viewBox={`0 0 ${RING_C * 2} ${RING_C * 2}`}
      style={{ transform: 'rotate(-90deg)', position: 'absolute', inset: 0 }}
      aria-hidden="true"
    >
      <circle cx={RING_C} cy={RING_C} r={RING_R} fill="none"
        stroke={complete ? 'rgba(36,181,135,0.2)' : 'rgba(212,137,30,0.2)'} strokeWidth={3} />
      {completed > 0 && (
        <circle cx={RING_C} cy={RING_C} r={RING_R} fill="none"
          stroke={strokeColor} strokeWidth={3}
          strokeDasharray={RING_CIRC} strokeDashoffset={dashOffset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.4,0,0.2,1)' }} />
      )}
    </svg>
  )
}

function DismissConfirm({ onCancel, onConfirm }) {
  return (
    <div
      role="dialog" aria-modal="true" aria-label="Dismiss journey confirmation"
      style={{
        position: 'absolute', inset: 0,
        background: 'rgba(30,37,55,0.92)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1.5rem', zIndex: 20, borderRadius: '0.75rem',
      }}
    >
      <div style={{
        background: 'var(--guide-surface, #242D42)',
        border: '1.5px solid rgba(255,255,255,0.1)',
        borderRadius: '0.75rem', padding: '1.25rem', textAlign: 'center',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)', maxWidth: 240,
      }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 700, color: 'var(--guide-text, #E8EDF6)', marginBottom: '0.5rem' }}>
          Dismiss your journey?
        </h3>
        <p style={{ fontSize: '0.8125rem', color: 'var(--guide-text-2, #9AA3BA)', lineHeight: 1.5, marginBottom: '1rem' }}>
          Your progress is saved. You can restart anytime from Settings.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={onCancel} style={{ flex: 1, padding: '0.5rem', borderRadius: '0.4375rem', fontSize: '0.8125rem', fontWeight: 700, cursor: 'pointer', background: 'rgba(255,255,255,0.08)', color: 'var(--guide-text, #E8EDF6)', border: '1.5px solid rgba(255,255,255,0.1)' }}>
            Keep going
          </button>
          <button onClick={onConfirm} style={{ flex: 1, padding: '0.5rem', borderRadius: '0.4375rem', fontSize: '0.8125rem', fontWeight: 700, cursor: 'pointer', background: 'var(--color-red-500)', color: 'white', border: 'none' }}>
            Yes, dismiss
          </button>
        </div>
      </div>
    </div>
  )
}

export default function JourneyCard({ phase: phaseProp } = {}) {
  const { journeyProgress, dismissJourney, close } = useGuideStore()
  const { completedSteps = [], dismissedAt } = journeyProgress ?? {}
  const [confirming, setConfirming] = useState(false)

  if (dismissedAt) return null

  const completed  = completedSteps.length
  const isComplete = completed >= TOTAL
  const nextStep   = STEPS.find(s => !completedSteps.includes(s.index)) ?? null
  const phase      = phaseProp ?? deriveCurrentPhase(completedSteps)

  function handleDismissConfirm() {
    setConfirming(false)
    dismissJourney(POST_JOURNEY_SLOTS)
  }

  // ── Specialize / complete state ────────────────────────────────────────
  // Step 7 done → Curriculum graduated. Show the celebration card. Full
  // Specialize recommendation stack ships in v1.1.
  if (phase === 'specialize' || isComplete) {
    return (
      <div style={{ background: 'rgba(36,181,135,0.07)', border: '1.5px solid rgba(36,181,135,0.4)', borderRadius: '0.75rem', padding: '1rem', textAlign: 'center', position: 'relative' }}>
        <div className="journey-complete-orb" style={{ width: 48, height: 48, borderRadius: '50%', background: 'radial-gradient(circle at 35% 35%, #6EE7B7, var(--color-teal-600))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', margin: '0 auto 0.75rem', boxShadow: '0 0 16px rgba(36,181,135,0.4)' }}>🏆</div>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '0.9375rem', fontWeight: 700, color: 'var(--guide-text, #E8EDF6)', marginBottom: '0.25rem' }}>Curriculum complete!</h3>
        <p style={{ fontSize: '0.75rem', color: 'var(--guide-text-2, #9AA3BA)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
          You earned <strong style={{ color: 'var(--color-amber-400)' }}>+50 TC</strong>. Personalized recommendations land here in a future release.
        </p>
        <button onClick={() => dismissJourney(POST_JOURNEY_SLOTS)} style={{ width: '100%', padding: '0.4375rem', borderRadius: '0.4375rem', background: 'var(--color-teal-500)', color: 'white', fontSize: '0.75rem', fontWeight: 700, border: 'none', cursor: 'pointer' }}>
          Continue
        </button>
      </div>
    )
  }

  // ── Shared header (Hook + Curriculum) ──────────────────────────────────
  const Header = (
    <div style={{ padding: '0.75rem', display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
      <div style={{ position: 'relative', width: 36, height: 36, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <ProgressRing completed={completed} complete={isComplete} />
        <div style={{ position: 'relative', zIndex: 1, width: 26, height: 26, borderRadius: '50%', background: 'radial-gradient(circle at 35% 35%, #F0C56A, var(--color-amber-600))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8125rem' }}>🤖</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>
          {phase === 'hook' ? 'Welcome to the Arena' : 'Your Journey'}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--color-amber-700)', marginTop: '0.125rem' }}>
          {phase === 'hook'
            ? `Hook · ${Math.min(completed, 2)}/2`
            : `Curriculum · ${Math.max(completed - 2, 0)}/5`}
        </div>
      </div>
    </div>
  )

  const ProgressBar = (
    <div style={{ background: 'rgba(212,137,30,0.15)', borderRadius: 999, height: 3, overflow: 'hidden', margin: '0 0.75rem' }}>
      <div style={{ height: '100%', background: 'var(--color-amber-500)', borderRadius: 999, width: `${(completed / TOTAL) * 100}%`, transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1)' }} />
    </div>
  )

  // ── Hook phase: hero only, no preview ──────────────────────────────────
  if (phase === 'hook') {
    return (
      <div data-phase="hook" style={{ background: 'rgba(212,137,30,0.07)', border: '1.5px solid rgba(212,137,30,0.28)', borderRadius: '0.75rem', overflow: 'hidden', position: 'relative' }}>
        {confirming && <DismissConfirm onCancel={() => setConfirming(false)} onConfirm={handleDismissConfirm} />}
        {Header}
        {ProgressBar}

        {nextStep && (
          <div style={{ padding: '0.5rem 0.75rem 0.75rem' }}>
            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem', lineHeight: 1.35 }}>
              {nextStep.title}
            </div>
            {nextStep.href && nextStep.index !== 7 && (
              <Link to={nextStep.href} onClick={close}
                style={{ display: 'block', width: '100%', textAlign: 'center', padding: '0.4375rem', borderRadius: '0.4375rem', background: 'var(--color-amber-500)', color: 'white', fontSize: '0.75rem', fontWeight: 700, textDecoration: 'none' }}>
                {nextStep.cta}
              </Link>
            )}
          </div>
        )}

        {/* Dismiss is hidden in Hook phase by design — the rewards lever
            requires users to at least see the demo. They can still dismiss
            from Settings. */}
      </div>
    )
  }

  // ── Curriculum phase: hero + 5-row checklist ───────────────────────────
  const curriculumSteps = STEPS.filter(s => s.index >= 3)  // steps 3-7

  return (
    <div data-phase="curriculum" style={{ background: 'rgba(212,137,30,0.07)', border: '1.5px solid rgba(212,137,30,0.28)', borderRadius: '0.75rem', overflow: 'hidden', position: 'relative' }}>
      {confirming && <DismissConfirm onCancel={() => setConfirming(false)} onConfirm={handleDismissConfirm} />}

      {Header}
      {ProgressBar}

      {nextStep && (
        <div style={{ padding: '0.375rem 0.75rem', fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0.375rem 0.75rem 0', borderRadius: 'var(--radius-sm, 6px)', background: 'rgba(212,137,30,0.1)', border: '1px solid rgba(212,137,30,0.3)', boxShadow: '0 0 8px 1px rgba(212,137,30,0.25)' }}>
          Next: <strong style={{ color: 'var(--color-amber-700)' }}>{nextStep.title}</strong>
        </div>
      )}

      {/* Step 7 (See your bot's first result) intentionally has NO clickable
          CTA: the step fires server-side only after the cup completes, so
          while it's the "next step" the cup is still in flight and there
          is literally nothing to view yet. The CoachingCard auto-appears
          on completion (§5.5), so a manual entry point is also redundant.
          Pre-fix, clicking "View result" while the cup ran sent the user
          to /profile?action=cup-result with no result to render — a flat
          dead end. We render an explanatory note instead so the panel
          isn't bare. */}
      {nextStep?.href && nextStep?.index !== 7 && (
        <div style={{ margin: '0.5rem 0.75rem 0.75rem' }}>
          <Link to={nextStep.href} onClick={close}
            style={{ display: 'block', width: '100%', textAlign: 'center', padding: '0.4375rem', borderRadius: '0.4375rem', background: 'var(--color-amber-500)', color: 'white', fontSize: '0.75rem', fontWeight: 700, textDecoration: 'none' }}>
            {nextStep.cta}
          </Link>
        </div>
      )}
      {nextStep?.index === 7 && (
        <div style={{ margin: '0.5rem 0.75rem 0.75rem', padding: '0.5rem 0.625rem', borderRadius: '0.4375rem', background: 'var(--bg-surface-hover)', fontSize: '0.7rem', color: 'var(--text-secondary)', lineHeight: 1.4, textAlign: 'center' }}>
          🏅 Watching your cup play out — your result lands here automatically when it wraps.
        </div>
      )}

      {/* 5-row Curriculum checklist — current highlighted, done ✓, future dimmed */}
      <div data-testid="curriculum-checklist" style={{ borderTop: '1px solid rgba(212,137,30,0.12)', padding: '0.5rem 0.75rem 0.75rem' }}>
        {curriculumSteps.map((step, i) => {
          const done    = completedSteps.includes(step.index)
          const current = !done && step.index === nextStep?.index
          return (
            <div key={step.index} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.375rem 0', borderBottom: i < curriculumSteps.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none', opacity: !done && !current ? 0.5 : 1 }}>
              <div style={{ width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.625rem', fontWeight: 800, flexShrink: 0, background: done ? 'var(--color-teal-500)' : current ? 'var(--color-amber-500)' : 'rgba(255,255,255,0.05)', color: done || current ? 'white' : 'var(--guide-text-muted, #5A6478)' }}>
                {done ? '✓' : step.index - 2}
              </div>
              <span style={{ fontSize: '0.75rem', fontWeight: current ? 700 : 600, lineHeight: 1.3, color: current ? 'var(--text-primary)' : 'var(--text-secondary)', textDecoration: done ? 'line-through' : 'none' }}>
                {step.title}
              </span>
            </div>
          )
        })}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
          <button onClick={() => setConfirming(true)} style={{ fontSize: '0.6875rem', color: 'var(--guide-text-muted, #5A6478)', padding: '0.2rem 0.375rem', borderRadius: '0.25rem', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', background: 'none', fontFamily: 'inherit' }}>
            Dismiss journey
          </button>
        </div>
      </div>
    </div>
  )
}
