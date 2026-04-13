// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { lazy, Suspense, useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../lib/api.js'
import { getToken } from '../lib/getToken.js'
import { useReplaySDK } from '../lib/useReplaySDK.js'

const XOGame = lazy(() => import('@callidity/game-xo'))

const SPEEDS = [0.5, 1, 2]

function Spinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div
        className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
        style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }}
      />
    </div>
  )
}

function ReplayControls({ controls, gameData }) {
  const { step, totalSteps, playing, speed, play, pause, stepForward, stepBack, scrub, setSpeed, reset } = controls

  const pct = totalSteps > 1 ? (step / (totalSteps - 1)) * 100 : 0

  return (
    <div
      className="w-full max-w-md mx-auto rounded-xl border p-3 space-y-3"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
    >
      {/* Player names */}
      {gameData && (
        <div className="flex justify-between text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
          <span>
            <span className="font-bold" style={{ color: 'var(--color-blue-600)' }}>X</span>
            {' '}{gameData.player1?.displayName ?? 'Player 1'}
          </span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Move {step} / {totalSteps - 1}
          </span>
          <span>
            {gameData.player2?.displayName ?? 'Player 2'}{' '}
            <span className="font-bold" style={{ color: 'var(--color-teal-600)' }}>O</span>
          </span>
        </div>
      )}

      {/* Scrubber */}
      <input
        type="range"
        min={0}
        max={totalSteps - 1}
        value={step}
        onChange={e => scrub(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, var(--color-primary) ${pct}%, var(--border-default) ${pct}%)`,
          accentColor: 'var(--color-primary)',
        }}
      />

      {/* Buttons */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            onClick={reset}
            className="px-2 py-1 rounded text-xs"
            style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-surface-hover)' }}
            title="Reset to start"
          >
            ⏮
          </button>
          <button
            onClick={stepBack}
            className="px-2 py-1 rounded text-xs"
            style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-surface-hover)' }}
            title="Step back"
          >
            ◀
          </button>
          <button
            onClick={playing ? pause : play}
            className="px-3 py-1 rounded text-sm font-medium text-white"
            style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
          >
            {playing ? '⏸' : '▶'}
          </button>
          <button
            onClick={stepForward}
            className="px-2 py-1 rounded text-xs"
            style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-surface-hover)' }}
            title="Step forward"
          >
            ▶
          </button>
        </div>

        {/* Speed selector */}
        <div className="flex items-center gap-1">
          {SPEEDS.map(s => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className="px-2 py-0.5 rounded text-xs font-medium"
              style={{
                backgroundColor: speed === s ? 'var(--color-primary)' : 'var(--bg-surface-hover)',
                color: speed === s ? 'white' : 'var(--text-secondary)',
              }}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function ReplayPage() {
  const { id }    = useParams()

  const [gameData, setGameData] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  useEffect(() => {
    async function load() {
      try {
        const token = await getToken()
        const data  = await api.games.getReplay(id, token)
        setGameData(data)
      } catch (err) {
        if (err?.status === 410) {
          setError('This replay has been purged.')
        } else if (err?.status === 404) {
          setError('Game not found.')
        } else {
          setError('Failed to load replay.')
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  const { session, sdk, controls } = useReplaySDK({ gameData })

  if (loading) return <Spinner />

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 max-w-sm mx-auto text-center">
        <div className="text-4xl">📭</div>
        <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{error}</p>
        <Link to="/" className="btn btn-primary text-sm">Back to Arena</Link>
      </div>
    )
  }

  if (!gameData?.moveStream) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 max-w-sm mx-auto text-center">
        <div className="text-4xl">📭</div>
        <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Replay not available</p>
        <Link to="/" className="btn btn-primary text-sm">Back to Arena</Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-md mx-auto py-6 px-4">
      <div className="w-full flex items-center justify-between">
        <Link
          to="/"
          className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg"
          style={{ color: 'var(--text-muted)' }}
        >
          ← Arena
        </Link>
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
          Replay
        </span>
        <div style={{ width: 60 }} />
      </div>

      <Suspense fallback={<Spinner />}>
        <XOGame session={session} sdk={sdk} />
      </Suspense>

      <ReplayControls controls={controls} gameData={gameData} />
    </div>
  )
}
