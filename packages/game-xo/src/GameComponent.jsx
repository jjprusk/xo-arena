// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * GameComponent — XO (Tic-Tac-Toe)
 *
 * This is the game's only React component. It receives two props from the platform:
 *   • session  — read-only context: players, currentUserId, isSpectator, settings
 *   • sdk      — platform interface: submitMove, onMove, spectate, signalEnd, …
 *
 * All platform communication goes through sdk. There are no direct socket calls,
 * no auth imports, and no router imports in this file.
 *
 * Rendering modes (derived from session.isSpectator):
 *   Active player  — input enabled, forfeit / rematch / leave actions shown
 *   Spectator      — all input disabled, spectating badge shown
 */

import React, { useState, useEffect, useRef } from 'react'
import { initialGameState } from './logic.js'
import { playSound } from './soundUtils.js'

// ── Theme tokens ───────────────────────────────────────────────────────────────
// These reference CSS custom properties injected by the platform from meta.theme.
// A custom game can change the colors entirely by overriding these tokens in meta.js.

const MARK_COLOR = {
  X: 'var(--game-mark-x)',
  O: 'var(--game-mark-o)',
}

// ── Constants ──────────────────────────────────────────────────────────────────

const REACTIONS = ['👍', '😂', '😮', '🔥', '😭', '🤔', '👏', '💀']

// ── Component ──────────────────────────────────────────────────────────────────

export default function GameComponent({ session, sdk }) {

  // ── State ──────────────────────────────────────────────────────────────────

  const [gameState, setGameState]         = useState(initialGameState())
  const [incomingReaction, setReaction]   = useState(null)
  const [showReactions, setShowReactions] = useState(false)
  const [showForfeit, setShowForfeit]     = useState(false)
  const [idleWarning, setIdleWarning]     = useState(null)
  const [lastCell, setLastCell]           = useState(null)
  const [error, setError]                 = useState(null)

  // Prevent signalEnd from firing more than once per game
  const signalledRef  = useRef(false)
  const reactionTimer = useRef(null)

  const { board, currentTurn, status, winner, winLine, scores, round } = gameState

  // ── Derived values ─────────────────────────────────────────────────────────

  // The current user's mark ('X' or 'O').
  // Prefer the server-assigned marks map; fall back to session.settings.myMark
  // for guest sessions where currentUserId is null.
  const myMark   = session?.settings?.marks?.[session?.currentUserId]
                ?? session?.settings?.myMark
                ?? null
  const isPlayer = !session?.isSpectator && myMark !== null
  const isMyTurn = isPlayer && status === 'playing' && currentTurn === myMark

  // ── Move subscription ──────────────────────────────────────────────────────

  useEffect(() => {
    // Spectators use sdk.spectate; active players use sdk.onMove.
    // Both return an unsubscribe function used for cleanup.
    const unsub = session?.isSpectator
      ? sdk.spectate(handleMoveEvent)
      : sdk.onMove(handleMoveEvent)
    return unsub
  }, [sdk, session?.isSpectator])

  // ── XO-specific SDK extensions ─────────────────────────────────────────────
  // These are optional — sdk.onReaction and sdk.onIdleWarning are XO-specific
  // extensions provided by the platform socket handler. Check for existence
  // before subscribing to stay compatible with replay and test SDKs.

  useEffect(() => {
    if (!sdk.onReaction) return
    const unsub = sdk.onReaction(({ emoji }) => {
      clearTimeout(reactionTimer.current)
      setReaction({ emoji, id: Date.now() })
      reactionTimer.current = setTimeout(() => setReaction(null), 2500)
    })
    return () => { unsub?.(); clearTimeout(reactionTimer.current) }
  }, [sdk])

  useEffect(() => {
    if (!sdk.onIdleWarning) return
    return sdk.onIdleWarning(({ secondsRemaining }) => setIdleWarning({ secondsRemaining }))
  }, [sdk])

  // ── Move event handler ─────────────────────────────────────────────────────

  function handleMoveEvent(event) {
    // A null move signals a new round starting (game:start from the server).
    // Reset local state and clear the signalled guard so signalEnd fires again.
    if (event.move === null) {
      setGameState(event.state)
      setLastCell(null)
      setError(null)
      signalledRef.current = false
      return
    }

    setGameState(event.state)
    setLastCell(event.move)
    setTimeout(() => setLastCell(null), 350)

    // Play sounds
    if (event.state.status === 'finished') {
      playSound(event.state.winner ? 'win' : 'draw')
    } else {
      playSound('move')
    }

    // Notify the platform once when the game concludes.
    // The platform uses this to record the result and update ELO.
    if (event.state.status === 'finished' && !signalledRef.current) {
      signalledRef.current = true
      sdk.signalEnd({
        rankings: event.state.winner
          ? sortByWinner(session?.players ?? [], event.state.winner, session?.settings?.marks)
          : [],
        isDraw: !event.state.winner,
      })
    }
  }

  // Return player IDs in finishing order: winner first, loser second.
  function sortByWinner(players, winnerMark, marks) {
    return [...players]
      .sort((a, b) => (marks?.[a.id] === winnerMark ? -1 : 1))
      .map(p => p.id)
  }

  // ── Player actions ─────────────────────────────────────────────────────────

  function handleCellClick(index) {
    if (!isMyTurn || board[index] !== null) return
    sdk.submitMove(index)
  }

  function handleForfeit() {
    playSound('forfeit')
    sdk.forfeit?.()
    setShowForfeit(false)
  }

  function handleRematch() {
    playSound('move')
    sdk.rematch?.()
  }

  function handleReaction(emoji) {
    sdk.sendReaction?.(emoji)
    setShowReactions(false)
  }

  function handleIdlePong() {
    sdk.idlePong?.()
    setIdleWarning(null)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col items-center gap-6 w-full">

      {/* Players strip */}
      <PlayerStrip session={session} myMark={myMark} />

      {/* Score strip */}
      <div className="w-full flex items-center justify-between px-2">
        <ScorePill mark="X" score={scores.X} highlight={myMark === 'X'} />
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Round {round}
        </span>
        <ScorePill mark="O" score={scores.O} highlight={myMark === 'O'} />
      </div>

      {/* Turn / result indicator */}
      <div className="flex items-center gap-2 h-8">
        {status === 'playing' && (
          <>
            <span className="font-bold" style={{ color: MARK_COLOR[currentTurn] }}>
              {currentTurn}
            </span>
            <span style={{ color: 'var(--text-secondary)' }}>
              {session?.isSpectator
                ? `${currentTurn}'s turn`
                : isMyTurn ? 'Your turn' : "Opponent's turn"}
            </span>
          </>
        )}
        {status === 'finished' && winner && (
          <span className="font-bold" style={{
            color: session?.isSpectator
              ? MARK_COLOR[winner]
              : winner === myMark ? 'var(--color-teal-600)' : 'var(--color-red-600)',
          }}>
            {session?.isSpectator
              ? `${winner} wins!`
              : winner === myMark ? 'You win! 🎉' : 'Opponent wins!'}
          </span>
        )}
        {status === 'finished' && !winner && (
          <span className="font-bold" style={{ color: 'var(--color-amber-600)' }}>
            Draw!
          </span>
        )}
      </div>

      {/* Error banner — shown when the server rejects a move */}
      {error && (
        <p className="text-sm px-3 py-2 rounded-lg w-full text-center"
           style={{ backgroundColor: 'var(--color-red-50)', color: 'var(--color-red-600)' }}>
          {error}
        </p>
      )}

      {/* Board */}
      <div className="grid grid-cols-3 gap-2 w-full" aria-label="Tic-tac-toe board">
        {board.map((cell, i) => {
          const isWin      = winLine?.includes(i)
          const isPlayable = isMyTurn && cell === null && status === 'playing'
          const isNew      = lastCell === i

          return (
            <button
              key={i}
              onClick={() => handleCellClick(i)}
              aria-label={`Cell ${i + 1}${cell ? `, ${cell}` : ''}`}
              disabled={!isPlayable}
              className={[
                'aspect-square flex items-center justify-center rounded-xl text-4xl font-bold',
                'border-2 transition-all select-none',
                isWin
                  ? 'bg-[var(--game-cell-win-bg)] border-[var(--game-cell-win-border)]'
                  : 'bg-[var(--bg-surface)] border-[var(--border-default)]',
                isNew      ? 'scale-[1.08]' : '',
                isPlayable
                  ? 'hover:bg-[var(--bg-surface-hover)] hover:scale-[1.04] active:scale-[0.97] cursor-pointer'
                  : 'cursor-default',
              ].join(' ')}
              style={{
                minHeight:  'clamp(72px, 24vw, 88px)',
                fontFamily: 'var(--font-display)',
                color:      cell ? MARK_COLOR[cell] : 'transparent',
                boxShadow:  isWin ? 'var(--shadow-cell-win)' : 'var(--shadow-cell)',
              }}
            >
              {cell || '·'}
            </button>
          )
        })}
      </div>

      {/* Incoming reaction — displays briefly above the board */}
      {incomingReaction && (
        <div
          key={incomingReaction.id}
          className="text-5xl animate-bounce pointer-events-none select-none"
          style={{ lineHeight: 1 }}
        >
          {incomingReaction.emoji}
        </div>
      )}

      {/* Reaction bar — players only */}
      {isPlayer && (status === 'playing' || status === 'finished') && sdk.sendReaction && (
        <div className="w-full">
          <button
            onClick={() => setShowReactions(v => !v)}
            className="text-xl p-1.5 rounded-lg border transition-colors hover:bg-[var(--bg-surface-hover)] hover:scale-110 active:scale-95"
            style={{ borderColor: 'var(--border-default)' }}
          >
            😊
          </button>
          {showReactions && (
            <div className="flex gap-2 mt-2 flex-wrap">
              {REACTIONS.map(emoji => (
                <button
                  key={emoji}
                  onClick={() => handleReaction(emoji)}
                  className="text-xl p-1.5 rounded-lg border transition-colors hover:bg-[var(--bg-surface-hover)] hover:scale-110 active:scale-95"
                  style={{ borderColor: 'var(--border-default)' }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Spectator badge */}
      {session?.isSpectator && (
        <span
          className="text-xs px-3 py-1 rounded-full"
          style={{ backgroundColor: 'var(--color-teal-50)', color: 'var(--color-teal-600)' }}
        >
          Spectating
        </span>
      )}

      {/* Game-end actions — players only */}
      {status === 'finished' && isPlayer && (
        <div className="flex gap-3 w-full">
          {sdk.rematch && (
            <button
              onClick={handleRematch}
              className="flex-1 py-3 rounded-xl font-semibold border-2 transition-colors"
              style={{ borderColor: 'var(--color-blue-600)', color: 'var(--color-blue-600)' }}
            >
              Rematch
            </button>
          )}
          <button
            onClick={() => sdk.leaveTable?.()}
            className="btn btn-primary flex-1 py-3 rounded-xl active:scale-[0.98]"
          >
            Leave Table
          </button>
        </div>
      )}

      {/* Forfeit button — shown during play */}
      {status === 'playing' && isPlayer && sdk.forfeit && (
        <button
          onClick={() => setShowForfeit(true)}
          className="text-sm transition-colors hover:text-[var(--color-red-600)]"
          style={{ color: 'var(--text-muted)' }}
        >
          Forfeit
        </button>
      )}

      {/* Forfeit confirmation dialog */}
      {showForfeit && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div
            className="rounded-2xl p-6 w-full max-w-xs space-y-4"
            style={{ backgroundColor: 'var(--bg-surface)' }}
          >
            <h2 className="font-bold text-lg" style={{ fontFamily: 'var(--font-display)' }}>
              Forfeit game?
            </h2>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Your opponent will be declared the winner.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowForfeit(false)}
                className="flex-1 py-2 rounded-xl border font-medium hover:bg-[var(--bg-surface-hover)] transition-colors"
                style={{ borderColor: 'var(--border-default)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleForfeit}
                className="flex-1 py-2 rounded-xl font-medium text-white transition-colors"
                style={{ background: 'var(--color-red-600)' }}
              >
                Forfeit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Idle warning popup — platform prompts the player before closing the room */}
      {idleWarning && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div
            className="rounded-2xl p-6 w-full max-w-xs space-y-4 text-center"
            style={{ backgroundColor: 'var(--bg-surface)' }}
          >
            <div className="text-4xl">💤</div>
            <h2 className="font-bold text-lg" style={{ fontFamily: 'var(--font-display)' }}>
              Still there?
            </h2>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {idleWarning.secondsRemaining}s before the room closes.
            </p>
            <button onClick={handleIdlePong} className="btn btn-primary w-full py-3 rounded-xl">
              I'm here
            </button>
          </div>
        </div>
      )}

    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

/**
 * Shows the opponent's display name above the board.
 * Hidden when the session has no players (e.g. replay with missing data).
 */
function PlayerStrip({ session, myMark }) {
  if (!session) return null
  const opponent = session.players?.find(p => p.id !== session.currentUserId)
  if (!opponent) return null

  return (
    <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
      <span style={{ color: 'var(--text-muted)' }}>vs</span>
      <span className="font-medium">{opponent.displayName}</span>
      {opponent.isBot && (
        <span className="badge badge-bot text-xs">BOT</span>
      )}
    </div>
  )
}

/**
 * Displays a player's mark and current score.
 * The active player's pill is rendered at a larger size.
 */
function ScorePill({ mark, score, highlight }) {
  return (
    <div className={`flex items-center gap-2 ${highlight ? 'font-bold' : ''}`}>
      <span style={{
        fontFamily: 'var(--font-display)',
        color:      MARK_COLOR[mark],
        fontSize:   highlight ? '1.25rem' : '1rem',
      }}>
        {mark}
      </span>
      <span className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
        {score}
      </span>
    </div>
  )
}
