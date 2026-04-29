// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * IdleWarnOverlay — "Still there?" modal that surfaces when the server
 * fires an idle warning on `user:<id>:idle`.
 *
 * Server emits the warn at `game.idleWarnSeconds` of inactivity (default
 * 120s) and follows up with an automatic forfeit at +`game.idleGraceSeconds`
 * (default +60s). This overlay gives the user a way to NOT be auto-forfeited:
 * any click / key / touch fires `sdk.idlePong()`, which resets the chain
 * server-side. Without the overlay the warn arrives silently and the user
 * just sees "you forfeited" once they tab back.
 *
 * The overlay closes automatically when the countdown reaches 0 (the forfeit
 * will land via the normal table:state event flow), or immediately on any
 * interaction.
 */
import { useEffect, useRef, useState } from 'react'

export default function IdleWarnOverlay({ sdk }) {
  const [open, setOpen]               = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const tickRef = useRef(null)

  function dismiss(pong = false) {
    if (pong) {
      try { sdk?.idlePong?.() } catch {}
    }
    setOpen(false)
    setSecondsLeft(0)
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
  }

  useEffect(() => {
    if (!sdk?.onIdleWarning) return
    return sdk.onIdleWarning(({ secondsRemaining }) => {
      const s = Math.max(1, Number(secondsRemaining) || 60)
      setSecondsLeft(s)
      setOpen(true)
      if (tickRef.current) clearInterval(tickRef.current)
      tickRef.current = setInterval(() => {
        setSecondsLeft(prev => {
          if (prev <= 1) {
            clearInterval(tickRef.current)
            tickRef.current = null
            // Don't pong on auto-close — the forfeit is on its way.
            setOpen(false)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    })
  }, [sdk])

  useEffect(() => () => { if (tickRef.current) clearInterval(tickRef.current) }, [])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-live="assertive"
      aria-label="Are you still there?"
      onClick={() => dismiss(true)}
      onKeyDown={() => dismiss(true)}
      onTouchStart={() => dismiss(true)}
      tabIndex={0}
      style={{
        position: 'fixed', inset: 0, zIndex: 1400,
        background: 'rgba(8,12,22,0.78)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem', cursor: 'pointer',
      }}
    >
      <div
        className="rounded-2xl border p-6 text-center max-w-sm"
        style={{
          backgroundColor: '#0f1626',
          borderColor:     'rgba(245,158,11,0.55)',
          boxShadow:       '0 24px 80px rgba(0,0,0,0.55), 0 0 0 4px rgba(245,158,11,0.15)',
          color:           'white',
        }}
      >
        <div style={{ fontSize: '2.5rem', lineHeight: 1, marginBottom: '0.5rem' }}>⏱️</div>
        <h3 className="text-lg font-bold" style={{ color: '#f59e0b' }}>Still there?</h3>
        <p className="text-sm mt-2" style={{ color: 'rgba(255,255,255,0.75)' }}>
          You'll forfeit in{' '}
          <span className="tabular-nums font-bold" style={{ color: 'white' }}>{secondsLeft}s</span>{' '}
          if you don't respond.
        </p>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); dismiss(true) }}
          className="mt-5 px-5 py-2 rounded-lg text-sm font-semibold"
          style={{ backgroundImage: 'linear-gradient(135deg,#f59e0b,#ea580c)', color: 'white' }}
        >
          I'm still here
        </button>
      </div>
    </div>
  )
}
