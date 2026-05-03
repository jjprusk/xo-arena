/**
 * PongGame — canvas-based Pong renderer.
 *
 * Receives { session, sdk } from the platform SDK provider.
 * Never touches sockets directly.
 *
 * session.playerIndex — 0 (left/P1), 1 (right/P2), null (spectator)
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import {
  BOARD_W, BOARD_H,
  PADDLE_W, PADDLE_H,
  BALL_R,
  P1_X, P2_X,
  SCORE_LIMIT,
  interpolate,
} from './pongPhysics.js'

const COLORS = {
  bg:          '#0f172a',
  midline:     '#334155',
  ball:        '#f8fafc',
  paddle1:     '#38bdf8',   // sky-400
  paddle2:     '#f472b6',   // pink-400
  score:       '#94a3b8',
  scoreActive: '#f8fafc',
  label:       '#64748b',
}

export default function PongGame({ session, sdk }) {
  const canvasRef   = useRef(null)
  const stateRef    = useRef(null)   // latest server state
  const prevRef     = useRef(null)   // previous server state (for interpolation)
  const lastTickRef = useRef(null)   // timestamp of last pong:state arrival
  const rafRef      = useRef(null)
  const keysRef     = useRef({ up: false, down: false })

  const [phase, setPhase] = useState('waiting')   // waiting | playing | finished
  const [winner, setWinner] = useState(null)
  const [score, setScore]   = useState({ p1: 0, p2: 0 })
  const [latency, setLatency] = useState(null)     // measured round-trip ms

  const playerIndex = session?.playerIndex ?? null
  const isSpectator = playerIndex === null

  // ── Subscribe to server state ticks ────────────────────────────────────────
  useEffect(() => {
    if (!sdk) return
    const unsub = sdk.onMove((event) => {
      const s = event.state
      if (!s) return

      prevRef.current  = stateRef.current
      stateRef.current = s
      lastTickRef.current = performance.now()

      if (s.status === 'finished') {
        setPhase('finished')
        setWinner(s.winner)
        setScore(s.score)
        sdk.signalEnd({ winner: s.winner, score: s.score })
      } else if (s.status === 'playing') {
        setPhase('playing')
        setScore(s.score)
      }

      // Latency probe: server embeds sentAt in state
      if (event.sentAt) {
        setLatency(Math.round(performance.now() - event.sentAt))
      }
    })
    return unsub
  }, [sdk])

  // ── Canvas render loop (rAF) ────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    function draw() {
      rafRef.current = requestAnimationFrame(draw)

      // Interpolate between prev and current server state
      const now    = performance.now()
      const last   = lastTickRef.current ?? now
      const t      = Math.min(1, (now - last) / 33)   // 33ms = one server tick
      const state  = interpolate(prevRef.current, stateRef.current, t) ?? stateRef.current

      const cw = canvas.width
      const ch = canvas.height
      const sx = cw / BOARD_W
      const sy = ch / BOARD_H

      // Background
      ctx.fillStyle = COLORS.bg
      ctx.fillRect(0, 0, cw, ch)

      if (!state) {
        // Waiting — show placeholder
        ctx.fillStyle = COLORS.label
        ctx.font = `${Math.round(14 * sx)}px monospace`
        ctx.textAlign = 'center'
        ctx.fillText('Waiting for opponent…', cw / 2, ch / 2)
        return
      }

      // Centre dashed line
      ctx.setLineDash([8 * sy, 8 * sy])
      ctx.strokeStyle = COLORS.midline
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(cw / 2, 0)
      ctx.lineTo(cw / 2, ch)
      ctx.stroke()
      ctx.setLineDash([])

      // Scores
      const scoreFont = `bold ${Math.round(32 * sx)}px monospace`
      ctx.font = scoreFont
      ctx.textAlign = 'center'
      ctx.fillStyle = COLORS.score
      ctx.fillText(state.score.p1, cw * 0.25, ch * 0.12)
      ctx.fillText(state.score.p2, cw * 0.75, ch * 0.12)

      // Player labels
      if (!isSpectator) {
        ctx.font = `${Math.round(10 * sx)}px monospace`
        ctx.fillStyle = COLORS.label
        if (playerIndex === 0) {
          ctx.fillText('YOU', cw * 0.25, ch * 0.18)
          ctx.fillText('OPP', cw * 0.75, ch * 0.18)
        } else {
          ctx.fillText('OPP', cw * 0.25, ch * 0.18)
          ctx.fillText('YOU', cw * 0.75, ch * 0.18)
        }
      }

      // Ball
      const ball = state.ball
      ctx.beginPath()
      ctx.arc(ball.x * sx, ball.y * sy, BALL_R * Math.min(sx, sy), 0, Math.PI * 2)
      ctx.fillStyle = COLORS.ball
      ctx.fill()

      // Paddles
      drawPaddle(ctx, P1_X * sx, state.paddles[0].y * sy, PADDLE_W * sx, PADDLE_H * sy, COLORS.paddle1)
      drawPaddle(ctx, P2_X * sx, state.paddles[1].y * sy, PADDLE_W * sx, PADDLE_H * sy, COLORS.paddle2)

      // Finished overlay
      if (state.status === 'finished') {
        ctx.fillStyle = 'rgba(15,23,42,0.75)'
        ctx.fillRect(0, 0, cw, ch)
        ctx.fillStyle = COLORS.scoreActive
        ctx.font = `bold ${Math.round(28 * sx)}px monospace`
        ctx.textAlign = 'center'
        const winMsg = isSpectator
          ? `P${(state.winner ?? 0) + 1} wins!`
          : state.winner === playerIndex ? 'You win! 🎉' : 'You lose'
        ctx.fillText(winMsg, cw / 2, ch / 2)
      }
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playerIndex, isSpectator])

  // ── Keyboard input ─────────────────────────────────────────────────────────
  const sendDir = useCallback((dir) => {
    if (isSpectator || phase !== 'playing') return
    sdk?.submitMove({ direction: dir })
  }, [sdk, isSpectator, phase])

  useEffect(() => {
    if (isSpectator || !sdk) return

    function onKeyDown(e) {
      if (e.repeat) return
      if (e.key === 'ArrowUp'   || e.key === 'w' || e.key === 'W') {
        if (keysRef.current.up) return
        keysRef.current.up = true
        sendDir('up')
      }
      if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        if (keysRef.current.down) return
        keysRef.current.down = true
        sendDir('down')
      }
    }

    function onKeyUp(e) {
      if (e.key === 'ArrowUp'   || e.key === 'w' || e.key === 'W') {
        keysRef.current.up = false
        if (!keysRef.current.down) sendDir('stop')
      }
      if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        keysRef.current.down = false
        if (!keysRef.current.up) sendDir('stop')
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup',   onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup',   onKeyUp)
    }
  }, [sendDir, isSpectator, sdk])

  // ── Mobile touch controls ─────────────────────────────────────────────────
  function onTouchStart(dir) {
    if (phase === 'playing') sendDir(dir)
  }
  function onTouchEnd() {
    sendDir('stop')
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', userSelect: 'none' }}>
      <canvas
        ref={canvasRef}
        width={800}
        height={600}
        style={{
          width:        '100%',
          maxWidth:     '800px',
          aspectRatio:  '4/3',
          borderRadius: '8px',
          border:       '1px solid #1e293b',
          display:      'block',
        }}
      />

      {/* Mobile paddle controls */}
      {!isSpectator && (
        <div style={{ display: 'flex', gap: '16px', marginTop: '4px' }}>
          {[
            { label: '▲', dir: 'up'   },
            { label: '▼', dir: 'down' },
          ].map(({ label, dir }) => (
            <button
              key={dir}
              onPointerDown={() => onTouchStart(dir)}
              onPointerUp={onTouchEnd}
              onPointerLeave={onTouchEnd}
              style={{
                width: '60px', height: '60px',
                borderRadius: '50%',
                border: '2px solid #334155',
                background: '#1e293b',
                color: '#94a3b8',
                fontSize: '20px',
                cursor: 'pointer',
                touchAction: 'none',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Debug info — useful during the spike */}
      <div style={{ fontSize: '11px', color: '#475569', fontFamily: 'monospace' }}>
        {latency !== null && `RTT: ${latency}ms`}
        {latency !== null && ' · '}
        {isSpectator ? 'spectating' : `P${playerIndex + 1}`}
        {' · '}
        {phase}
        {' · '}
        {score.p1} – {score.p2}
      </div>
    </div>
  )
}

function drawPaddle(ctx, cx, cy, w, h, color) {
  const x = cx - w / 2
  const y = cy - h / 2
  const r = w / 2
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.fillStyle = color
  ctx.fill()
}
