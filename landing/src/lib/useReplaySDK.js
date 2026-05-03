// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * useReplaySDK — drives GameComponent from a stored moveStream.
 *
 * Returns { session, sdk, controls } shaped identically to useGameSDK,
 * so GameComponent receives the same props contract in both live and replay modes.
 *
 * moveStream format: [{ n: moveNumber, m: 'X'|'O', c: cellIndex }, ...]
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { getWinner, isBoardFull, WIN_LINES } from '@xo-arena/ai'

// ── State reconstructor ────────────────────────────────────────────────────────

/**
 * Build the full sequence of game states from a compact moveStream.
 * Returns an array of sdk.onMove-compatible events: { move, state }.
 * Index 0 = initial (pre-first-move) state; index N = state after move N.
 */
function reconstructStates(moveStream) {
  const states = []
  let board = Array(9).fill(null)

  // Step 0: initial state (used to reset GameComponent on play-from-start)
  states.push({
    move: null,
    state: {
      board: [...board],
      currentTurn: 'X',
      status: 'playing',
      winner: null,
      winLine: null,
      scores: { X: 0, O: 0 },
      round: 1,
    },
  })

  for (const { c: cellIndex, m: mark } of moveStream) {
    board = [...board]
    board[cellIndex] = mark

    const winner = getWinner(board)
    const draw = !winner && isBoardFull(board)
    const status = winner || draw ? 'finished' : 'playing'
    const winLine = winner
      ? (WIN_LINES.find(([a, b, c]) => board[a] === winner && board[b] === winner && board[c] === winner) || null)
      : null

    states.push({
      move: cellIndex,
      state: {
        board: [...board],
        currentTurn: mark === 'X' ? 'O' : 'X',
        status,
        winner: winner || null,
        winLine,
        scores: { X: 0, O: 0 },
        round: 1,
      },
    })
  }

  return states
}

// ── Hook ───────────────────────────────────────────────────────────────────────

const STEP_INTERVAL_MS = { 0.5: 1600, 1: 800, 2: 400 }

export function useReplaySDK({ gameData }) {
  const [step, setStep]       = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed]     = useState(1)

  // Build state sequence once from gameData.moveStream
  const states = useMemo(
    () => gameData?.moveStream ? reconstructStates(gameData.moveStream) : [],
    [gameData]
  )
  const totalSteps = states.length

  // stepRef lets sdk.spectate deliver the current state on handler registration
  const stepRef    = useRef(step)
  stepRef.current  = step
  const handlerRef = useRef(null)

  // Auto-play: advance step on an interval
  useEffect(() => {
    if (!playing) return
    if (step >= totalSteps - 1) { setPlaying(false); return }
    const delay = STEP_INTERVAL_MS[speed] ?? 800
    const id = setTimeout(() => setStep(s => s + 1), delay)
    return () => clearTimeout(id)
  }, [playing, step, speed, totalSteps])

  // Deliver state to GameComponent whenever step changes
  useEffect(() => {
    if (handlerRef.current && states[step]) {
      handlerRef.current(states[step])
    }
  }, [step, states])

  // ── Fake session ─────────────────────────────────────────────────────────────

  const session = useMemo(() => ({
    currentUserId: null,
    isSpectator: true,
    tableId: gameData?.id ?? null,
    players: [
      gameData?.player1 ? { id: gameData.player1.id, displayName: gameData.player1.displayName, isBot: gameData.player1.isBot ?? false } : null,
      gameData?.player2 ? { id: gameData.player2.id, displayName: gameData.player2.displayName, isBot: gameData.player2.isBot ?? false } : null,
    ].filter(Boolean),
    settings: {
      marks: {},
      player1: gameData?.player1 ?? null,
      player2: gameData?.player2 ?? null,
    },
  }), [gameData])

  // ── Fake SDK ──────────────────────────────────────────────────────────────────

  const sdk = useMemo(() => ({
    // GameComponent calls spectate (because isSpectator: true)
    spectate: (fn) => {
      handlerRef.current = fn
      // Deliver current state immediately so GameComponent initialises correctly
      if (states[stepRef.current]) fn(states[stepRef.current])
      return () => { handlerRef.current = null }
    },
    onMove: (fn) => {
      handlerRef.current = fn
      if (states[stepRef.current]) fn(states[stepRef.current])
      return () => { handlerRef.current = null }
    },
    submitMove:   () => {},
    signalEnd:    () => {},
    getPlayers:   () => [],
    getSettings:  () => session.settings,
  }), [states, session.settings])

  // ── Controls ──────────────────────────────────────────────────────────────────

  const controls = {
    step,
    totalSteps,
    playing,
    speed,
    play:        () => setPlaying(true),
    pause:       () => setPlaying(false),
    stepForward: () => { setPlaying(false); setStep(s => Math.min(s + 1, totalSteps - 1)) },
    stepBack:    () => { setPlaying(false); setStep(s => Math.max(s - 1, 0)) },
    scrub:       (n) => { setPlaying(false); setStep(Math.max(0, Math.min(n, totalSteps - 1))) },
    setSpeed,
    reset:       () => { setPlaying(false); setStep(0) },
  }

  return { session, sdk, controls }
}
