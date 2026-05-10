// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * ChallengeButton — one-click "play this bot" action.
 *
 *   POST /api/v1/rt/tables { kind: 'hvb', botUserId, gameId? }
 *   → on 2xx, navigate to /play?join=<slug>
 *
 * Stateless (no internal modal, no confirm). Disables itself while
 * in-flight, surfaces errors via an inline message slot beneath the
 * button. Auth-agnostic — guests work because anonymous SSE sessions
 * already exist and `createHvbTable` accepts that path. Per the
 * Bot_Challenge_Plan "guest-friendly by default" decision.
 *
 * Variants:
 *   'default' — full-width primary button with label "Challenge"
 *   'icon'    — compact icon-only button (1.4rem+) for dense rows
 */
import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { rtFetch } from '../../lib/rtSession.js'

export default function ChallengeButton({
  botUserId,
  gameId         = 'xo',
  variant        = 'default',
  label          = 'Challenge',
  source         = 'unknown',  // analytics tag — passed through to track()
  disabled: extDisabled = false,
  onChallengeStart = null,
  onChallengeError = null,
}) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState(null)

  async function handleClick(e) {
    // Stop propagation so a button nested inside a clickable card
    // doesn't trigger the card's onClick as well.
    e?.stopPropagation?.()
    if (busy || extDisabled || !botUserId) return
    setBusy(true)
    setErr(null)
    onChallengeStart?.({ botUserId, source })
    try {
      const res = await rtFetch('/rt/tables', {
        body: { kind: 'hvb', botUserId, gameId, spectatorAllowed: true },
      })
      if (!res?.slug) throw new Error('Server returned no slug')
      navigate(`/play?join=${encodeURIComponent(res.slug)}`)
    } catch (e2) {
      setBusy(false)
      const msg = e2?.message ?? 'Failed to start match'
      setErr(msg)
      onChallengeError?.({ botUserId, source, error: e2 })
    }
  }

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={busy || extDisabled || !botUserId}
        aria-label={`Challenge ${botUserId}`}
        title={err ?? 'Play this bot'}
        data-testid="challenge-button"
        data-source={source}
        className="inline-flex items-center justify-center rounded-md border transition-all hover:brightness-110 disabled:opacity-40"
        style={{
          width:           '1.75rem',
          height:          '1.75rem',
          fontSize:        '1rem',
          color:           'white',
          background:      'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))',
          borderColor:     'var(--color-blue-700)',
        }}
      >
        {busy ? '…' : '⚔'}
      </button>
    )
  }

  return (
    <div className="flex flex-col items-stretch gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy || extDisabled || !botUserId}
        data-testid="challenge-button"
        data-source={source}
        className="px-4 py-2 rounded-lg font-semibold text-sm text-white transition-all hover:brightness-110 disabled:opacity-50"
        style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
      >
        {busy ? 'Joining…' : label}
      </button>
      {err && (
        <p className="text-[11px]" data-testid="challenge-error" style={{ color: 'var(--color-red-600)' }}>
          {err}
        </p>
      )}
    </div>
  )
}
