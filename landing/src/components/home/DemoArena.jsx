// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useEffect, useState, useRef } from 'react'
import { recordGuestHookStep2 } from '../../lib/guestMode.js'

/**
 * DemoArena — Phase 0 hero embed (Intelligent Guide v1, §3.5.1).
 *
 * Renders a live bot-vs-bot tic-tac-toe match in the homepage hero. Two
 * bots play continuously; new game starts a few seconds after the previous
 * one ends. Visitor watches → "oh, the platform is bots playing each other,
 * cool" — the unique value prop in 5 seconds.
 *
 * Bot logic is INLINE here (lightweight minimax) rather than going through
 * the @xo-arena/ai package — keeps the demo self-contained, no extra
 * imports, no network calls.
 *
 * After ~120 seconds of cumulative watch time, records guest Hook step 2
 * (`recordGuestHookStep2`) so a guest who lingers gets credited on signup.
 *
 * In Sprint 3 we'll consider replacing this with a server-driven Demo Table
 * (§5.1) that uses the real bot infrastructure. Until then, this is plenty
 * for hero-arena purposes.
 */

const HOOK_STEP_2_WATCH_THRESHOLD_MS = 120_000   // 2 min — matches §5.1 spec
const MOVE_DELAY_MS                  = 1100      // pause between bot moves
const BETWEEN_GAMES_MS               = 2200      // pause before starting next match

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],   // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8],   // cols
  [0, 4, 8], [2, 4, 6],              // diagonals
]

function getEmptyCells(board) {
  const out = []
  for (let i = 0; i < 9; i++) if (!board[i]) out.push(i)
  return out
}

function getWinner(board) {
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line: [a, b, c] }
    }
  }
  return null
}

function isFull(board) { return board.every(c => c) }

// Full minimax (XO is small enough — 9! = 362880 max states, but symmetry
// + alpha-beta keeps it under 5000 evaluations per call). Always wins or
// draws against suboptimal play.
function minimax(board, mark, isMax, alpha = -Infinity, beta = Infinity) {
  const w = getWinner(board)
  if (w) return w.winner === mark ? 10 : -10
  if (isFull(board)) return 0

  const opponent = mark === 'X' ? 'O' : 'X'
  const empty    = getEmptyCells(board)

  if (isMax) {
    let best = -Infinity
    for (const i of empty) {
      board[i] = mark
      const score = minimax(board, mark, false, alpha, beta) - 1   // prefer faster wins
      board[i] = ''
      best = Math.max(best, score)
      alpha = Math.max(alpha, best)
      if (beta <= alpha) break
    }
    return best
  } else {
    let best = Infinity
    for (const i of empty) {
      board[i] = opponent
      const score = minimax(board, mark, true, alpha, beta) + 1
      board[i] = ''
      best = Math.min(best, score)
      beta  = Math.min(beta, best)
      if (beta <= alpha) break
    }
    return best
  }
}

// Pick a move for `mark` based on tier:
//   novice       — random valid (matches Rusty)
//   intermediate — block immediate threats + take wins, else random (matches Copper)
//   advanced     — 60% optimal minimax, else intermediate (matches Sterling)
function pickMove(board, mark, tier) {
  const empty   = getEmptyCells(board)
  const opponent = mark === 'X' ? 'O' : 'X'

  if (tier === 'novice') {
    return empty[Math.floor(Math.random() * empty.length)]
  }

  // Intermediate: take immediate win → block immediate loss → random
  for (const i of empty) {
    const trial = [...board]; trial[i] = mark
    if (getWinner(trial)?.winner === mark) return i
  }
  for (const i of empty) {
    const trial = [...board]; trial[i] = opponent
    if (getWinner(trial)?.winner === opponent) return i
  }

  if (tier === 'advanced' && Math.random() < 0.6) {
    // 60% chance to play full minimax
    let bestScore = -Infinity, bestMoves = []
    for (const i of empty) {
      const trial = [...board]; trial[i] = mark
      const score = minimax(trial, mark, false)
      if (score > bestScore) { bestScore = score; bestMoves = [i] }
      else if (score === bestScore) { bestMoves.push(i) }
    }
    return bestMoves[Math.floor(Math.random() * bestMoves.length)]
  }

  return empty[Math.floor(Math.random() * empty.length)]
}

// Curated allowlist of demo pairings — same spirit as §5.1's curated list,
// but client-side. Each pairing produces watchable matches.
const PAIRINGS = [
  { x: { name: 'Copper Coil',    tier: 'intermediate' }, o: { name: 'Sterling Knight',  tier: 'advanced'     } },
  { x: { name: 'Rusty Hinge',    tier: 'novice'       }, o: { name: 'Copper Coil',      tier: 'intermediate' } },
  { x: { name: 'Patina',         tier: 'intermediate' }, o: { name: 'Verdigris',        tier: 'intermediate' } },
  { x: { name: 'Polished Argent',tier: 'advanced'     }, o: { name: 'Moonlit Blade',    tier: 'advanced'     } },
]

function freshGame() {
  const pair = PAIRINGS[Math.floor(Math.random() * PAIRINGS.length)]
  return {
    board:  Array(9).fill(''),
    turn:   'X',
    pair,
    winner: null,
    line:   null,
  }
}

export default function DemoArena() {
  const [game, setGame]       = useState(freshGame)
  const watchStartRef         = useRef(Date.now())
  const recordedRef           = useRef(false)
  const timerRef              = useRef(null)

  // Step 2 watch-time tracker
  useEffect(() => {
    function tick() {
      if (recordedRef.current) return
      const elapsed = Date.now() - watchStartRef.current
      if (elapsed >= HOOK_STEP_2_WATCH_THRESHOLD_MS) {
        recordGuestHookStep2()
        recordedRef.current = true
      }
    }
    const id = setInterval(tick, 5_000)
    return () => clearInterval(id)
  }, [])

  // Game progression
  useEffect(() => {
    if (game.winner || isFull(game.board)) {
      // Schedule a fresh game
      timerRef.current = setTimeout(() => setGame(freshGame()), BETWEEN_GAMES_MS)
      return () => clearTimeout(timerRef.current)
    }

    const tier      = game.turn === 'X' ? game.pair.x.tier : game.pair.o.tier
    timerRef.current = setTimeout(() => {
      setGame(g => {
        if (g.winner || isFull(g.board)) return g
        const next = [...g.board]
        const move = pickMove(next, g.turn, tier)
        next[move] = g.turn
        const w    = getWinner(next)
        return {
          ...g,
          board: next,
          turn:  g.turn === 'X' ? 'O' : 'X',
          winner: w?.winner ?? (isFull(next) ? 'draw' : null),
          line:  w?.line ?? null,
        }
      })
    }, MOVE_DELAY_MS)

    return () => clearTimeout(timerRef.current)
  }, [game])

  const xName = game.pair.x.name
  const oName = game.pair.o.name
  const status =
    game.winner === 'draw'  ? 'Draw — perfect play.' :
    game.winner === 'X'     ? `${xName} wins` :
    game.winner === 'O'     ? `${oName} wins` :
    `${game.turn === 'X' ? xName : oName} thinking…`

  return (
    <div
      className="rounded-2xl p-4 sm:p-6 flex flex-col gap-4 mx-auto max-w-md"
      style={{
        backgroundColor: 'var(--bg-surface)',
        border:          '1px solid var(--border-default)',
        boxShadow:       '0 4px 24px rgba(0,0,0,0.15)',
      }}
      aria-label="Live demo: two bots playing tic-tac-toe"
    >
      {/* Player names */}
      <div className="flex items-center justify-between text-sm">
        <PlayerLabel name={xName} mark="X" active={!game.winner && game.turn === 'X'} color="var(--color-blue-600)" />
        <span className="text-xs uppercase tracking-wider opacity-60">vs</span>
        <PlayerLabel name={oName} mark="O" active={!game.winner && game.turn === 'O'} color="var(--color-teal-600)" />
      </div>

      {/* Board */}
      <div className="grid grid-cols-3 gap-1.5 aspect-square w-full">
        {game.board.map((cell, i) => {
          const onWinLine = game.line?.includes(i)
          return (
            <div
              key={i}
              className="flex items-center justify-center rounded-md text-3xl sm:text-4xl font-bold transition-all"
              style={{
                backgroundColor: onWinLine ? 'var(--color-amber-100, #fef3c7)' : 'var(--bg-base)',
                color: cell === 'X' ? 'var(--color-blue-600)' : 'var(--color-teal-600)',
                border: '1px solid var(--border-default)',
              }}
              aria-label={cell ? `Cell ${i + 1}: ${cell}` : `Cell ${i + 1}: empty`}
            >
              {cell}
            </div>
          )
        })}
      </div>

      {/* Status line */}
      <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }} aria-live="polite">
        {status}
      </p>
    </div>
  )
}

function PlayerLabel({ name, mark, active, color }) {
  return (
    <span
      className="flex items-center gap-1.5 transition-opacity"
      style={{ opacity: active ? 1 : 0.55 }}
    >
      <span
        className="w-5 h-5 rounded-md flex items-center justify-center text-xs font-bold"
        style={{ backgroundColor: 'var(--bg-base)', color, border: `1.5px solid ${color}` }}
      >
        {mark}
      </span>
      <span className="font-semibold text-xs sm:text-sm truncate max-w-[120px]">{name}</span>
    </span>
  )
}
