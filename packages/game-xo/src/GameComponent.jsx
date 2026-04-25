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
  // Track the last cell we submitted so handleMoveEvent can detect its own
  // echo and skip the duplicate sound. Needed for guests where currentUserId
  // is null and the `playerId !== currentUserId` check always passes.
  const pendingMoveRef = useRef(null)

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
    // On a replay (state rehydration for a newly-mounted handler — e.g.,
    // after PlatformShell mode switch unmounts/remounts this component),
    // update state but DON'T reset the signalled guard: the game hasn't
    // actually restarted, we're just catching up.
    if (event.move === null) {
      setGameState(event.state)
      setLastCell(null)
      setError(null)
      if (!event.replay) signalledRef.current = false
      return
    }

    setGameState(event.state)

    // Side effects (cell highlight flash, sounds, signalEnd) are suppressed
    // on replay. They only belong to the live event — replaying them on a
    // remount would double-sound moves and re-trigger signalEnd on finished
    // games, corrupting ELO.
    if (!event.replay) {
      setLastCell(event.move)
      setTimeout(() => setLastCell(null), 350)

      // Detect own-move echo: if this cellIndex matches what we just submitted
      // in handleCellClick, this is our own move bouncing back from the server.
      // The sound already played on click — skip it here to avoid doubling.
      // This covers both signed-in users (where playerId === currentUserId
      // also works) AND guests (where currentUserId is null so the old
      // playerId check always passed, causing a double beep).
      const isOwnEcho = event.move === pendingMoveRef.current
      if (isOwnEcho) pendingMoveRef.current = null

      if (event.state.status === 'finished') {
        // Win/draw sound always plays regardless of who made the finishing move
        sdk.playSound?.(event.state.winner ? 'win' : 'draw')
      } else if (!isOwnEcho) {
        // Only play the move sound for the opponent's moves. Own-move is
        // silent: the visual feedback from the X/O appearing in the cell is
        // the player's confirmation. Any click-time sound is a double-beep.
        sdk.playSound?.('move')
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
    // No click-time sound — own moves are silent. The X/O appearing in the
    // cell is visual confirmation; adding a beep on top of the opponent's
    // reply sound would double-beep every round. pendingMoveRef still
    // records the pending index so handleMoveEvent's isOwnEcho check can
    // distinguish the server echo from a genuine opponent move.
    pendingMoveRef.current = index
    sdk.submitMove(index)
  }

  function handleForfeit() {
    sdk.playSound?.('forfeit')
    sdk.forfeit?.()
    setShowForfeit(false)
  }

  function handleRematch() {
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
    <div className="flex flex-col items-center gap-3 w-full">

      {/* Compact status line: replaces the old three-row (PlayerStrip / score /
          turn) stack. Each row ate ~30-40px vertically; on iPhone this pushed
          the Rematch/Leave/Forfeit controls below the fold. The seat pods
          already surface opponent identity, so the only info owed here is
          turn/result + round + score. */}
      <StatusLine
        status={status}
        winner={winner}
        isSpectator={session?.isSpectator}
        isMyTurn={isMyTurn}
        myMark={myMark}
        currentTurn={currentTurn}
        round={round}
        scoreX={scores.X}
        scoreO={scores.O}
      />

      {/* Error banner — shown when the server rejects a move */}
      {error && (
        <p className="text-sm px-3 py-2 rounded-lg w-full text-center"
           style={{ backgroundColor: 'var(--color-red-50)', color: 'var(--color-red-600)' }}>
          {error}
        </p>
      )}

      {/* Board, with a floating emoji-reaction button overlaid in the top-right
          corner. Previously the reaction button anchored a full row below the
          board, pushing controls further down. Floating keeps it accessible
          without stealing vertical space. */}
      <div className="relative w-full">
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

        {/* Incoming reaction — brief bounce over the board */}
        {incomingReaction && (
          <div
            key={incomingReaction.id}
            className="absolute inset-0 flex items-center justify-center pointer-events-none select-none text-5xl animate-bounce"
            style={{ lineHeight: 1 }}
          >
            {incomingReaction.emoji}
          </div>
        )}
      </div>

      {/* Spectator badge */}
      {session?.isSpectator && (
        <span
          className="text-xs px-3 py-1 rounded-full"
          style={{ backgroundColor: 'var(--color-teal-50)', color: 'var(--color-teal-600)' }}
        >
          Spectating
        </span>
      )}

      {/* Bottom action row — always visible to active players so the user
          can leave at any time. mb-6 reserves space below the row so the
          bottom seat avatar (which straddles the table's bottom rim) and the
          absolute-positioned outcome banner have room without overlapping
          the buttons. */}
      {isPlayer && (status === 'playing' || status === 'finished') && (
        <div className="flex items-center gap-3 w-full mb-6">
          {sdk.sendReaction && (
            <ReactionPill
              showReactions={showReactions}
              setShowReactions={setShowReactions}
              handleReaction={handleReaction}
            />
          )}
          {status === 'finished' && sdk.rematch && (
            <button
              onClick={handleRematch}
              className="flex-1 min-w-0 py-3 rounded-xl font-semibold border-2 border-blue-600 text-blue-600 bg-white transition-colors hover:bg-blue-50 active:scale-[0.98]"
            >
              {session?.settings?.isTournament ? 'Continue' : 'Rematch'}
            </button>
          )}
          <button
            onClick={() => {
              if (status === 'playing') setShowForfeit(true)
              else sdk.leaveTable?.()
            }}
            className="flex-1 min-w-0 py-3 rounded-xl font-semibold border-2 border-transparent text-white bg-slate-600 transition-colors hover:bg-slate-700 active:scale-[0.98]"
          >
            Leave Table
          </button>
        </div>
      )}

      {/* Leave-mid-game confirmation — opens when the player clicks Leave
          Table while a game is in progress. Functionally still a forfeit
          (handleForfeit) but worded for the Leave Table verb. */}
      {showForfeit && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div
            className="rounded-2xl p-6 w-full max-w-xs space-y-4"
            style={{ backgroundColor: 'var(--bg-surface)' }}
          >
            <h2 className="font-bold text-lg" style={{ fontFamily: 'var(--font-display)' }}>
              Leave the table?
            </h2>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              The game is still in progress — leaving will forfeit and your opponent will be declared the winner.
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
                Leave
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
              {idleWarning.secondsRemaining}s before the table closes.
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
 * Compact one-line status bar.
 * Renders: "[currentTurn mark] [turn/result label] · Round N · X-O"
 * Replaces the former three-stack of PlayerStrip / ScorePill-row / turn label
 * that ate ~100px of vertical space on mobile.
 */
function StatusLine({ status, winner, isSpectator, isMyTurn, myMark, currentTurn, round, scoreX, scoreO }) {
  // Left segment: turn indicator OR result label.
  let turnNode
  if (status === 'playing') {
    turnNode = (
      <span className="flex items-center gap-1.5">
        <span className="font-bold" style={{ color: MARK_COLOR[currentTurn] }}>
          {currentTurn}
        </span>
        <span style={{ color: 'var(--text-secondary)' }}>
          {isSpectator
            ? `${currentTurn}'s turn`
            : isMyTurn ? 'Your turn' : "Opponent's turn"}
        </span>
      </span>
    )
  } else if (status === 'finished' && winner) {
    turnNode = (
      <span className="font-bold" style={{
        color: isSpectator
          ? MARK_COLOR[winner]
          : winner === myMark ? 'var(--color-teal-600)' : 'var(--color-red-600)',
      }}>
        {isSpectator
          ? `${winner} wins!`
          : winner === myMark ? 'You win! 🎉' : 'Opponent wins!'}
      </span>
    )
  } else if (status === 'finished') {
    turnNode = <span className="font-bold" style={{ color: 'var(--color-amber-600)' }}>Draw!</span>
  } else {
    turnNode = null
  }

  return (
    <div className="w-full flex items-center justify-between gap-2 px-1 text-sm">
      <div className="flex-1 min-w-0 truncate">{turnNode}</div>
      <div className="flex items-center gap-3 shrink-0" style={{ color: 'var(--text-muted)' }}>
        <span>Round {round}</span>
        <span className="flex items-center gap-2 font-semibold" style={{ color: 'var(--text-primary)' }}>
          <span style={{ color: MARK_COLOR.X, fontFamily: 'var(--font-display)' }}>{scoreX}</span>
          <span style={{ color: 'var(--text-muted)' }}>–</span>
          <span style={{ color: MARK_COLOR.O, fontFamily: 'var(--font-display)' }}>{scoreO}</span>
        </span>
      </div>
    </div>
  )
}

function ReactionPill({ showReactions, setShowReactions, handleReaction }) {
  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setShowReactions(v => !v)}
        aria-label="Reactions"
        className="text-lg w-9 h-9 rounded-full border transition-colors hover:bg-[var(--bg-surface-hover)] active:scale-95 flex items-center justify-center"
        style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
      >
        😊
      </button>
      {showReactions && (
        <div
          className="absolute left-0 bottom-full mb-1 flex gap-1 flex-wrap max-w-[12rem] p-1 rounded-lg border z-10"
          style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
        >
          {REACTIONS.map(emoji => (
            <button
              key={emoji}
              onClick={() => handleReaction(emoji)}
              className="text-lg w-8 h-8 rounded-md transition-colors hover:bg-[var(--bg-surface-hover)] active:scale-95 flex items-center justify-center"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
