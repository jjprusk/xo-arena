// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * QuickMatchButton — one-click "find me an opponent" CTA.
 *
 * Two-step flow under one click:
 *   1. GET /api/v1/bots/quick-match?eloWindow=100 → { botUserId }
 *   2. POST /rt/tables { kind: 'hvb', botUserId } → navigate /play?join=<slug>
 *
 * Step 2 piggybacks on the same primitive (`<ChallengeButton>` internals
 * via direct rtFetch) so the Quick Match path is instrumented and
 * behaves identically to "Challenge this bot" buttons elsewhere — same
 * source semantics, same disabled / error / navigate handling.
 *
 * Auth-agnostic: guest path is supported end-to-end per the
 * Bot_Challenge_Plan "guest-friendly by default" decision.
 */
import React, { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../../lib/api.js'
import { rtFetch } from '../../lib/rtSession.js'
import { getToken } from '../../lib/getToken.js'

export default function QuickMatchButton({
  gameId    = 'xo',
  eloWindow = 100,
  label     = 'Quick Match',
  source    = 'quick-match',
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState(null)

  async function handleClick() {
    if (busy) return
    setBusy(true)
    setErr(null)
    try {
      // Token is optional — quick-match accepts guests. getToken returns
      // null for unauthenticated callers; api.bots.quickMatch is fine
      // either way.
      const token = await getToken().catch(() => null)
      const pick  = await api.bots.quickMatch({ gameId, eloWindow, token })
      if (!pick?.botUserId) throw new Error('No opponent found')

      const res = await rtFetch('/rt/tables', {
        body: { kind: 'hvb', botUserId: pick.botUserId, gameId, spectatorAllowed: true },
      })
      if (!res?.slug) throw new Error('Table create returned no slug')
      const origin = location?.pathname?.startsWith('/bots/')
        ? '/bots'
        : `${location.pathname}${location.search ?? ''}`
      navigate(`/play?join=${encodeURIComponent(res.slug)}`, { state: { from: origin } })
    } catch (e2) {
      setBusy(false)
      const status = e2?.status
      if (status === 404 || e2?.code === 'NO_CANDIDATES') {
        setErr('No bots available right now. Try again in a moment.')
      } else {
        setErr(e2?.message ?? 'Could not start a match')
      }
    }
  }

  return (
    <div className="flex flex-col items-stretch gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        data-testid="quick-match-button"
        data-source={source}
        className="px-5 py-2.5 rounded-lg font-semibold text-sm text-white transition-all hover:brightness-110 disabled:opacity-50"
        style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
      >
        {busy ? 'Finding an opponent…' : label}
      </button>
      {err && (
        <p
          data-testid="quick-match-error"
          className="text-[11px] text-center"
          style={{ color: 'var(--color-red-600)' }}
        >
          {err}
        </p>
      )}
    </div>
  )
}
