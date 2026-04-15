// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useGuideStore } from '../../store/guideStore.js'
import { POST_JOURNEY_SLOTS } from './slotActions.js'
import { api } from '../../lib/api.js'
import { getToken } from '../../lib/getToken.js'

const STEPS = [
  { index: 1, title: 'Welcome to the Arena',  cta: null,                  href: null,                            site: 'platform' },
  { index: 2, title: 'Read the FAQ',           cta: 'Read the FAQ',       href: '/faq',                          site: 'platform' },
  { index: 3, title: 'Play your first game',   cta: 'Play now',           href: '/play?action=vs-community-bot', site: 'platform' },
  { index: 4, title: 'Explore AI Training',    cta: 'Open Gym Guide',     href: '/gym/guide',                    site: 'platform' },
  { index: 5, title: 'Create your first bot',  cta: 'Create a bot',       href: '/profile?action=create-bot',    site: 'platform' },
  { index: 6, title: 'Train your bot',         cta: 'Start training',     href: '/gym?action=start-training',    site: 'platform' },
  { index: 7, title: 'Enter a tournament',     cta: 'Browse tournaments', href: '/tournaments',                  site: 'platform' },
]

const SITE_BADGE = {
  platform: { label: 'AI Arena', color: 'var(--color-slate-400)' },
}

const TOTAL = 7

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

export default function JourneyCard() {
  const { journeyProgress, dismissJourney, close, applyJourneyStep } = useGuideStore()
  const { completedSteps = [], dismissedAt } = journeyProgress ?? {}
  const [expanded, setExpanded]     = useState(true)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (dismissedAt || completedSteps.includes(1)) return
    const next = [...completedSteps, 1]
    applyJourneyStep({ completedSteps: next })
    getToken().then(token => {
      if (token) api.guide.patchPreferences({ journeyProgress: { completedSteps: next, dismissedAt: null } }, token).catch(() => {})
    }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (dismissedAt) return null

  const completed  = completedSteps.length
  const isComplete = completed >= TOTAL
  const nextStep   = STEPS.find(s => !completedSteps.includes(s.index) && s.href) ?? null

  function handleDismissConfirm() {
    setConfirming(false)
    dismissJourney(POST_JOURNEY_SLOTS)
  }

  function StepCta({ step }) {
    if (!step.href) return null
    return (
      <Link to={step.href} onClick={close}
        style={{ display: 'inline-block', marginTop: '0.25rem', padding: '0.25rem 0.5rem', background: 'var(--color-amber-500)', color: 'white', fontSize: '0.6875rem', fontWeight: 700, borderRadius: '0.3rem', textDecoration: 'none' }}>
        {step.cta}
      </Link>
    )
  }

  if (isComplete) {
    return (
      <div style={{ background: 'rgba(36,181,135,0.07)', border: '1.5px solid rgba(36,181,135,0.4)', borderRadius: '0.75rem', padding: '1rem', textAlign: 'center', position: 'relative' }}>
        <div className="journey-complete-orb" style={{ width: 48, height: 48, borderRadius: '50%', background: 'radial-gradient(circle at 35% 35%, #6EE7B7, var(--color-teal-600))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', margin: '0 auto 0.75rem', boxShadow: '0 0 16px rgba(36,181,135,0.4)' }}>🏆</div>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '0.9375rem', fontWeight: 700, color: 'var(--guide-text, #E8EDF6)', marginBottom: '0.25rem' }}>Onboarding Complete!</h3>
        <p style={{ fontSize: '0.75rem', color: 'var(--guide-text-2, #9AA3BA)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
          You've earned the <strong style={{ color: 'var(--color-amber-400)' }}>Arena Graduate</strong> badge and +50 TC.
        </p>
        <button onClick={() => dismissJourney(POST_JOURNEY_SLOTS)} style={{ width: '100%', padding: '0.4375rem', borderRadius: '0.4375rem', background: 'var(--color-teal-500)', color: 'white', fontSize: '0.75rem', fontWeight: 700, border: 'none', cursor: 'pointer' }}>
          Continue
        </button>
      </div>
    )
  }

  return (
    <div style={{ background: 'rgba(212,137,30,0.07)', border: '1.5px solid rgba(212,137,30,0.28)', borderRadius: '0.75rem', overflow: 'hidden', position: 'relative' }}>
      {confirming && <DismissConfirm onCancel={() => setConfirming(false)} onConfirm={handleDismissConfirm} />}

      {/* Header */}
      <div style={{ padding: '0.75rem', display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
        <div style={{ position: 'relative', width: 36, height: 36, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <ProgressRing completed={completed} complete={isComplete} />
          <div style={{ position: 'relative', zIndex: 1, width: 26, height: 26, borderRadius: '50%', background: 'radial-gradient(circle at 35% 35%, #F0C56A, var(--color-amber-600))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8125rem' }}>🤖</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>Your Journey</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-amber-700)', marginTop: '0.125rem' }}>{completed}/{TOTAL} steps completed</div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ background: 'rgba(212,137,30,0.15)', borderRadius: 999, height: 3, overflow: 'hidden', margin: '0 0.75rem' }}>
        <div style={{ height: '100%', background: 'var(--color-amber-500)', borderRadius: 999, width: `${(completed / TOTAL) * 100}%`, transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1)' }} />
      </div>

      {/* Next step */}
      {nextStep && (
        <div style={{ padding: '0.375rem 0.75rem', fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0.375rem 0.75rem 0', borderRadius: 'var(--radius-sm, 6px)', background: 'rgba(212,137,30,0.1)', border: '1px solid rgba(212,137,30,0.3)', boxShadow: '0 0 8px 1px rgba(212,137,30,0.25)' }}>
          Next: <strong style={{ color: 'var(--color-amber-700)' }}>{nextStep.title}</strong>
        </div>
      )}

      {/* CTA */}
      {nextStep?.href && (
        <div style={{ margin: '0.5rem 0.75rem 0.75rem' }}>
          <Link to={nextStep.href} onClick={close}
            style={{ display: 'block', width: '100%', textAlign: 'center', padding: '0.4375rem', borderRadius: '0.4375rem', background: 'var(--color-amber-500)', color: 'white', fontSize: '0.75rem', fontWeight: 700, textDecoration: 'none' }}>
            {nextStep.cta}
          </Link>
        </div>
      )}

      {/* Expand/collapse */}
      <button
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0.75rem', borderTop: '1px solid rgba(212,137,30,0.15)', fontSize: '0.8125rem', color: 'var(--guide-text-muted, #5A6478)', cursor: 'pointer', background: 'none', border: 'none', width: '100%', fontFamily: 'inherit' }}
      >
        <span>{expanded ? 'Hide steps' : 'Show all steps'}</span>
        <span style={{ fontSize: '1.75rem', transform: expanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>▾</span>
      </button>

      {expanded && (
        <div style={{ borderTop: '1px solid rgba(212,137,30,0.12)', padding: '0.5rem 0.75rem 0.75rem' }}>
          {STEPS.map(step => {
            const done    = completedSteps.includes(step.index)
            const current = !done && step.index === nextStep?.index
            return (
              <div key={step.index} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', padding: '0.375rem 0', borderBottom: step.index < TOTAL ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                <div style={{ width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.625rem', fontWeight: 800, flexShrink: 0, background: done ? 'var(--color-teal-500)' : current ? 'var(--color-amber-500)' : 'rgba(255,255,255,0.05)', color: done || current ? 'white' : 'var(--guide-text-muted, #5A6478)' }}>
                  {done ? '✓' : step.index}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, lineHeight: 1.3, color: current ? 'var(--text-primary)' : 'var(--text-secondary)', textDecoration: done ? 'line-through' : 'none' }}>
                      {step.title}
                    </span>
                    {step.site && (
                      <span style={{ fontSize: '0.5625rem', fontWeight: 700, lineHeight: 1, padding: '0.1rem 0.3rem', borderRadius: '0.25rem', background: `${SITE_BADGE[step.site].color}22`, color: SITE_BADGE[step.site].color, border: `1px solid ${SITE_BADGE[step.site].color}44`, whiteSpace: 'nowrap' }}>
                        {SITE_BADGE[step.site].label}
                      </span>
                    )}
                  </div>
                  {current && <StepCta step={step} />}
                </div>
              </div>
            )
          })}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
            <button onClick={() => setConfirming(true)} style={{ fontSize: '0.6875rem', color: 'var(--guide-text-muted, #5A6478)', padding: '0.2rem 0.375rem', borderRadius: '0.25rem', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', background: 'none', fontFamily: 'inherit' }}>
              Dismiss journey
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
