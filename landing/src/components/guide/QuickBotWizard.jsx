// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Quick Bot wizard (Curriculum step 3 — §5.3).
 *
 * Friction-reduced 3-step flow for the user's first bot. Full bot creation
 * has many decisions (algorithm, hyperparameters, persona, etc.); for users
 * still in Curriculum, those choices are noise. Quick Bot picks sane defaults
 * (`minimax`, `novice` tier per `guide.quickBot.defaultTier`) and only asks
 * for what the user genuinely cares about — a name and a vibe.
 *
 * Steps: 1 Name → 2 Persona → 3 Confirm. Persona is currently display-only —
 * the bot row has no persona column today; the field is reserved for a
 * future surface that styles the bot's chip/avatar around the chosen vibe.
 *
 * On confirm, POSTs to `/api/v1/bots/quick`. On success, calls
 * `onCreated(bot)` so the host page can route to the bot detail / show a
 * success toast / fire the journey-step 3 reward UI.
 */

import React, { useState, useRef, useEffect } from 'react'
import { api } from '../../lib/api.js'

export const QUICK_BOT_PERSONAS = [
  { id: 'aggressive',   label: 'Aggressive',   blurb: 'Pushes for the win, even at the cost of safety.' },
  { id: 'cautious',     label: 'Cautious',     blurb: 'Defends every threat before reaching for victory.' },
  { id: 'opportunist',  label: 'Opportunist',  blurb: 'Waits for openings; pounces on mistakes.' },
  { id: 'tactician',    label: 'Tactician',    blurb: 'Plans two moves ahead; rarely wastes a turn.' },
  { id: 'gambler',      label: 'Gambler',      blurb: 'Loves a flashy fork even when the percentages are thin.' },
]

const STEP_NAME    = 1
const STEP_PERSONA = 2
const STEP_CONFIRM = 3

function StepDot({ active, done }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width:  done ? 14 : 10,
        height: done ? 14 : 10,
        borderRadius: '50%',
        background: done ? 'var(--color-teal-500)' : active ? 'var(--color-amber-500)' : 'rgba(255,255,255,0.18)',
        transition: 'all 0.2s ease',
      }}
    />
  )
}

function StepHeader({ step }) {
  const labels = ['Name', 'Persona', 'Confirm']
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem', marginBottom: '1.25rem', alignItems: 'center' }}>
      {labels.map((label, i) => {
        const idx = i + 1
        return (
          <React.Fragment key={label}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
              <StepDot active={step === idx} done={step > idx} />
              <span style={{ fontSize: '0.6875rem', color: step === idx ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: step === idx ? 700 : 400 }}>
                {label}
              </span>
            </div>
            {idx < labels.length && (
              <span aria-hidden="true" style={{ width: 24, height: 1, background: 'rgba(255,255,255,0.12)', marginBottom: 16 }} />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

export default function QuickBotWizard({ onCreated, onCancel, getToken }) {
  const [step,    setStep]    = useState(STEP_NAME)
  const [name,    setName]    = useState('')
  const [persona, setPersona] = useState(QUICK_BOT_PERSONAS[0].id)
  const [error,   setError]   = useState(null)
  const [busy,    setBusy]    = useState(false)
  const nameRef = useRef(null)

  useEffect(() => { if (step === STEP_NAME) nameRef.current?.focus() }, [step])

  function next() {
    setError(null)
    if (step === STEP_NAME) {
      const trimmed = name.trim()
      if (!trimmed) { setError('Please give your bot a name.'); return }
      if (trimmed.length > 30) { setError('Names must be 30 characters or fewer.'); return }
    }
    setStep(s => Math.min(s + 1, STEP_CONFIRM))
  }

  function back() {
    setError(null)
    setStep(s => Math.max(s - 1, STEP_NAME))
  }

  async function confirm() {
    setBusy(true); setError(null)
    try {
      const token = await getToken()
      if (!token) throw new Error('Sign in to create a bot.')
      const { bot } = await api.bots.quickCreate({ name: name.trim(), persona }, token)
      onCreated?.(bot, { persona })
    } catch (err) {
      // Translate the most-common server codes into friendly copy.
      if (err.code === 'NAME_TAKEN')    setError('That name is already in use — try a different one.')
      else if (err.code === 'RESERVED_NAME') setError(`"${name.trim()}" is reserved for a built-in bot — try another.`)
      else if (err.code === 'PROFANITY') setError('That name was flagged. Try another.')
      else if (err.code === 'BOT_LIMIT_REACHED') setError('You\'ve reached your bot limit — delete one to make room.')
      else setError(err.message || 'Could not create your bot. Try again in a moment.')
      // Step back to the relevant page on collision so the user can edit.
      if (err.code === 'NAME_TAKEN' || err.code === 'RESERVED_NAME' || err.code === 'PROFANITY') {
        setStep(STEP_NAME)
      }
    } finally {
      setBusy(false)
    }
  }

  const selected = QUICK_BOT_PERSONAS.find(p => p.id === persona)

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Quick Bot wizard"
      style={{
        background: 'var(--bg-surface, #1a2030)',
        border: '1.5px solid rgba(212,137,30,0.28)',
        borderRadius: '0.875rem', padding: '1.25rem', maxWidth: 420, width: '100%',
        boxShadow: '0 12px 36px rgba(0,0,0,0.4)',
      }}
    >
      <StepHeader step={step} />

      {step === STEP_NAME && (
        <>
          <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.125rem', marginBottom: '0.25rem' }}>Name your bot</h3>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
            Pick anything memorable. You can rename later from the bot's profile.
          </p>
          <input
            ref={nameRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && next()}
            placeholder="Spark, Whiplash, Slow Pony…"
            maxLength={30}
            aria-label="Bot name"
            style={{
              width: '100%', padding: '0.5rem 0.75rem', fontSize: '0.9375rem',
              background: 'var(--bg-base)', color: 'var(--text-primary)',
              border: '1.5px solid rgba(255,255,255,0.12)', borderRadius: '0.5rem',
            }}
          />
        </>
      )}

      {step === STEP_PERSONA && (
        <>
          <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.125rem', marginBottom: '0.25rem' }}>Pick a persona</h3>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
            Sets the vibe of your bot's profile. You can change this later.
          </p>
          <div role="radiogroup" aria-label="Bot persona" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {QUICK_BOT_PERSONAS.map(p => (
              <label
                key={p.id}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: '0.625rem',
                  padding: '0.5rem 0.75rem',
                  background: persona === p.id ? 'rgba(212,137,30,0.12)' : 'rgba(255,255,255,0.04)',
                  border: persona === p.id ? '1.5px solid rgba(212,137,30,0.5)' : '1.5px solid rgba(255,255,255,0.08)',
                  borderRadius: '0.5rem', cursor: 'pointer',
                }}
              >
                <input
                  type="radio" name="persona" value={p.id}
                  checked={persona === p.id}
                  onChange={() => setPersona(p.id)}
                  style={{ marginTop: 4 }}
                />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--text-primary)' }}>{p.label}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>{p.blurb}</div>
                </div>
              </label>
            ))}
          </div>
        </>
      )}

      {step === STEP_CONFIRM && (
        <>
          <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.125rem', marginBottom: '0.5rem' }}>Confirm</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
            <div><span style={{ color: 'var(--text-muted)' }}>Name:</span> <strong>{name.trim()}</strong></div>
            <div><span style={{ color: 'var(--text-muted)' }}>Persona:</span> <strong>{selected?.label}</strong></div>
            <div><span style={{ color: 'var(--text-muted)' }}>Algorithm:</span> Random play to start — flips to Q-Learning on first training</div>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Your bot starts at the same skill as Rusty — random valid moves. The first training run swaps it to a real Q-Learning model trained from self-play; you'll watch the win-rate climb live.
          </p>
        </>
      )}

      {error && (
        <p role="alert" style={{
          marginTop: '0.75rem', padding: '0.5rem 0.75rem', borderRadius: '0.4rem',
          background: 'rgba(220,38,38,0.12)', border: '1px solid rgba(220,38,38,0.3)',
          color: '#fca5a5', fontSize: '0.8125rem', lineHeight: 1.5,
        }}>{error}</p>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem' }}>
        {step === STEP_NAME ? (
          <button
            type="button" onClick={onCancel}
            style={{ flex: 1, padding: '0.5rem', borderRadius: '0.4375rem', fontSize: '0.875rem', fontWeight: 700,
              cursor: 'pointer', background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)',
              border: '1.5px solid rgba(255,255,255,0.1)' }}
          >
            Cancel
          </button>
        ) : (
          <button
            type="button" onClick={back} disabled={busy}
            style={{ flex: 1, padding: '0.5rem', borderRadius: '0.4375rem', fontSize: '0.875rem', fontWeight: 700,
              cursor: busy ? 'not-allowed' : 'pointer', background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)',
              border: '1.5px solid rgba(255,255,255,0.1)' }}
          >
            Back
          </button>
        )}

        {step === STEP_CONFIRM ? (
          <button
            type="button" onClick={confirm} disabled={busy}
            style={{ flex: 2, padding: '0.5rem', borderRadius: '0.4375rem', fontSize: '0.875rem', fontWeight: 700,
              cursor: busy ? 'not-allowed' : 'pointer', background: 'var(--color-amber-500)', color: 'white',
              border: 'none', opacity: busy ? 0.6 : 1 }}
          >
            {busy ? 'Creating…' : 'Create my bot'}
          </button>
        ) : (
          <button
            type="button" onClick={next}
            style={{ flex: 2, padding: '0.5rem', borderRadius: '0.4375rem', fontSize: '0.875rem', fontWeight: 700,
              cursor: 'pointer', background: 'var(--color-amber-500)', color: 'white', border: 'none' }}
          >
            Next
          </button>
        )}
      </div>
    </div>
  )
}
