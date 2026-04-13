// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * PongPage — spike viewer for the Pong real-time architecture test.
 *
 * Routes:
 *   /pong          → create a room (P1), show invite link
 *   /pong/:slug    → join room as P2 (or spectate if full)
 *
 * Spike component — removable with the rest of the Pong package.
 */

import React, { lazy, Suspense } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useOptimisticSession } from '../lib/useOptimisticSession.js'
import { usePongSDK } from '../lib/usePongSDK.js'

const PongGame = lazy(() => import('@callidity/game-pong'))

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div
        className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
        style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }}
      />
    </div>
  )
}

export default function PongPage() {
  const { slug: joinSlug } = useParams()
  const navigate = useNavigate()
  const { data: authSession } = useOptimisticSession()
  const currentUser = authSession?.user ?? null

  const { session, sdk, phase, abandoned, roomSlug } = usePongSDK({
    slug: joinSlug ?? null,
    currentUser,
  })

  const inviteUrl = roomSlug
    ? `${window.location.origin}/pong/${roomSlug}`
    : null

  // ── Abandoned ────────────────────────────────────────────────────────────
  if (abandoned) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 max-w-sm mx-auto text-center">
        <div className="text-4xl">🏓</div>
        <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
          Game ended — opponent disconnected.
        </p>
        <button
          onClick={() => navigate('/pong')}
          className="btn btn-primary text-sm"
        >
          New Game
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Pong <span className="text-xs font-normal ml-1 px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-surface-hover)', color: 'var(--text-muted)' }}>spike</span>
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Real-time architecture test · first to 7 wins
          </p>
        </div>
        <Link to="/" className="text-xs" style={{ color: 'var(--text-muted)' }}>← Back</Link>
      </div>

      {/* Invite strip — shown while waiting for P2 */}
      {phase === 'waiting' && inviteUrl && !joinSlug && (
        <div
          className="rounded-lg border p-3 flex items-center gap-3"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}
        >
          <span className="text-sm shrink-0" style={{ color: 'var(--text-secondary)' }}>
            Invite link:
          </span>
          <input
            readOnly
            value={inviteUrl}
            onClick={e => e.target.select()}
            className="flex-1 text-xs font-mono rounded px-2 py-1 min-w-0"
            style={{
              background: 'var(--bg-input)',
              border:     '1px solid var(--border-default)',
              color:      'var(--text-primary)',
            }}
          />
          <button
            onClick={() => navigator.clipboard?.writeText(inviteUrl)}
            className="shrink-0 text-xs px-2 py-1 rounded"
            style={{ background: 'var(--bg-surface-hover)', color: 'var(--text-secondary)' }}
          >
            Copy
          </button>
        </div>
      )}

      {/* Status bar */}
      <div
        className="rounded-lg px-3 py-2 text-xs font-mono flex items-center gap-2"
        style={{ background: 'var(--bg-surface)', color: 'var(--text-muted)', borderColor: 'var(--border-default)', border: '1px solid' }}
      >
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{
            background: phase === 'playing' ? '#22c55e'
              : phase === 'waiting' ? '#f59e0b'
              : '#64748b',
          }}
        />
        {phase === 'connecting' && 'Connecting…'}
        {phase === 'waiting'    && (joinSlug ? 'Waiting for host…' : 'Waiting for opponent — share the link above')}
        {phase === 'playing'    && `Playing · P${(session?.playerIndex ?? 0) + 1}`}
        {phase === 'finished'   && 'Game over'}
        <span className="ml-auto" style={{ color: 'var(--text-muted)' }}>
          {roomSlug}
        </span>
      </div>

      {/* Controls hint */}
      {phase === 'playing' && session?.playerIndex !== null && (
        <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
          ↑ / W — up &nbsp;·&nbsp; ↓ / S — down
        </p>
      )}

      {/* Game canvas */}
      <Suspense fallback={<Spinner />}>
        {session && (
          <PongGame session={session} sdk={sdk} />
        )}
        {!session && phase === 'connecting' && <Spinner />}
      </Suspense>

      {/* Play again button */}
      {phase === 'finished' && (
        <div className="flex justify-center mt-2">
          <button
            onClick={() => navigate('/pong')}
            className="btn btn-primary text-sm px-6"
          >
            Play Again
          </button>
        </div>
      )}
    </div>
  )
}
