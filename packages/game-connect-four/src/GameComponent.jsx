// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * GameComponent — Connect Four
 *
 * The game's only React component. Mirrors `@callidity/game-xo`'s shape so
 * the platform shell can swap games via `React.lazy(import('@callidity/game-...'))`
 * without any game-specific platform code.
 *
 * Props (per SDK GameContract):
 *   • session — read-only context: players, currentUserId, isSpectator, settings
 *   • sdk     — platform interface: submitMove, onMove, spectate, signalEnd,
 *               playSound, leaveTable, rematch
 *
 * Strict SDK conformance: no socket calls, no router imports, no auth here.
 * All communication goes through `sdk`.
 *
 * Move shape: a Connect Four move is a COLUMN INDEX 0..6. The server is
 * responsible for applying gravity (i.e. dropping the piece into the
 * lowest empty row of the chosen column). Until the backend dispatch is
 * generalized for `inputMode: 'column'` games, this component computes
 * its own optimistic drop locally so the UI feels responsive — the
 * server-echoed `onMove` event reconciles back to canonical state.
 *
 * Rendering modes (per session.isSpectator):
 *   Active player — column hover preview, click-to-drop, leave/rematch
 *   Spectator     — input disabled, no preview, "Spectating" pill shown
 */

import React, { useState, useEffect, useRef } from 'react'
import {
  ROWS, COLS, CELLS, MARKS,
  emptyBoard, drop as dropPiece, getWinner, isBoardFull, indexOf,
} from './logic.js'

// ── Theme tokens ──────────────────────────────────────────────────────────────
// Yellow + Red are the canonical C4 colors. We reference the platform's
// game-mark CSS variables and provide sensible default tones inline so
// the board still renders with colors even when the platform host hasn't
// injected meta.theme (e.g. in tests).

const MARK_COLOR = {
  [MARKS.FIRST]:  'var(--game-mark-1, #facc15)', // yellow-400
  [MARKS.SECOND]: 'var(--game-mark-2, #dc2626)', // red-600
}
const MARK_LABEL = {
  [MARKS.FIRST]:  'Yellow',
  [MARKS.SECOND]: 'Red',
}

/** Fresh per-round state. Round count + score persist across rematches. */
export function initialGameState() {
  return {
    board:        emptyBoard(),
    currentTurn:  MARKS.FIRST,
    status:       'playing',
    winner:       null,
    winLine:      null,
    scores:       { [MARKS.FIRST]: 0, [MARKS.SECOND]: 0 },
    round:        1,
    lastMove:     null, // { row, col, index } of most recent drop, for animation
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function GameComponent({ session, sdk }) {
  const [gameState, setGameState] = useState(initialGameState())
  const [hoverCol, setHoverCol]   = useState(null) // desktop hover preview
  const [showForfeit, setShowForfeit] = useState(false)
  const [error, setError]         = useState(null)

  const signalledRef    = useRef(false)
  const pendingMoveRef  = useRef(null) // column we just submitted (for echo detection)

  const {
    board, currentTurn, status, winner, winLine, scores, round, lastMove,
  } = gameState
  const endReason     = gameState.endReason     ?? null
  const forfeiterMark = gameState.forfeiterMark ?? null

  // ── Derived ─────────────────────────────────────────────────────────────────

  const myMark   = session?.settings?.marks?.[session?.currentUserId]
                ?? session?.settings?.myMark
                ?? null
  const isPlayer = !session?.isSpectator && myMark != null
  const isMyTurn = isPlayer && status === 'playing' && currentTurn === myMark

  // ── Move subscription ───────────────────────────────────────────────────────

  useEffect(() => {
    const unsub = session?.isSpectator
      ? sdk.spectate(handleMoveEvent)
      : sdk.onMove(handleMoveEvent)
    return unsub
  }, [sdk, session?.isSpectator]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Move event handler ──────────────────────────────────────────────────────

  function handleMoveEvent(event) {
    // New round / replay rehydration: full state replacement.
    if (event.move === null || event.move === undefined) {
      setGameState({ ...initialGameState(), ...(event.state ?? {}) })
      setError(null)
      if (!event.replay) signalledRef.current = false
      return
    }

    setGameState(event.state)

    if (!event.replay) {
      // Detect own-move echo: if this column matches what we just submitted,
      // the click-time visual was the player's confirmation — skip the move
      // sound to avoid a double beep.
      const isOwnEcho = event.move === pendingMoveRef.current
      if (isOwnEcho) pendingMoveRef.current = null

      if (event.state?.status === 'finished') {
        sdk.playSound?.(event.state.winner ? 'win' : 'draw')
      } else if (!isOwnEcho) {
        sdk.playSound?.('drop')
      }

      if (event.state?.status === 'finished' && !signalledRef.current) {
        signalledRef.current = true
        sdk.signalEnd?.({
          rankings: event.state.winner
            ? sortByWinner(session?.players ?? [], event.state.winner, session?.settings?.marks)
            : [],
          isDraw: !event.state.winner,
        })
      }
    }
  }

  function sortByWinner(players, winnerMark, marks) {
    return [...players]
      .sort((a, b) => (marks?.[a.id] === winnerMark ? -1 : 1))
      .map(p => p.id)
  }

  // ── Player actions ──────────────────────────────────────────────────────────

  /**
   * Submit a move into the given column. Defensive: only acts if it's the
   * player's turn AND the column has at least one empty cell.
   *
   * The platform handles validation server-side and echoes the canonical
   * state through `onMove`. We record `pendingMoveRef` so the echo path
   * can detect its own move and skip the duplicate sound.
   */
  function handleColumnClick(col) {
    if (!isMyTurn) return
    // Top row of column must be empty (else the column is full).
    if (board[indexOf(0, col)] != null) return
    pendingMoveRef.current = col
    sdk.submitMove(col)
  }

  function handleConfirmLeaveMidGame() {
    sdk.playSound?.('forfeit')
    sdk.leaveTable?.()
    setShowForfeit(false)
  }

  function handleRematch() {
    sdk.rematch?.()
  }

  // ── Hover preview (desktop) ─────────────────────────────────────────────────

  // The piece will land at the lowest empty row in the hovered column.
  function previewRow(col) {
    if (col == null) return -1
    for (let r = ROWS - 1; r >= 0; r--) {
      if (board[indexOf(r, col)] == null) return r
    }
    return -1
  }
  const previewLandingRow = previewRow(hoverCol)
  const previewLandingIdx = (hoverCol != null && previewLandingRow >= 0)
    ? indexOf(previewLandingRow, hoverCol) : -1

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      data-testid="c4-game"
      data-status={status}
      className="flex flex-col items-center gap-3 w-full"
    >
      {/* Status line — turn / round / score / outcome */}
      <StatusLine
        status={status}
        winner={winner}
        myMark={myMark}
        currentTurn={currentTurn}
        round={round}
        scores={scores}
        isSpectator={!!session?.isSpectator}
        endReason={endReason}
        forfeiterMark={forfeiterMark}
        players={session?.players ?? []}
        marks={session?.settings?.marks ?? {}}
      />

      {error && (
        <p
          className="text-sm px-3 py-2 rounded-lg w-full text-center"
          style={{ backgroundColor: 'var(--color-red-50, #fef2f2)', color: 'var(--color-red-600, #dc2626)' }}
        >
          {error}
        </p>
      )}

      {/* Board: 7 column wrappers laid out side-by-side. Each column contains
          6 cells from top (row 0) to bottom (row 5). Clicking ANYWHERE in the
          column drops a piece — Connect Four players think in columns, so
          column-as-button matches the mental model better than cell-as-button. */}
      <div
        className="grid w-full"
        style={{
          gridTemplateColumns: `repeat(${COLS}, 1fr)`,
          gap: 4,
          padding: 6,
          borderRadius: 12,
          background: 'var(--game-board-bg, #1e3a8a)', // blue-900 — classic plastic-frame look
          aspectRatio: `${COLS} / ${ROWS}`,
          maxWidth: 560,
        }}
        aria-label="Connect Four board"
        role="grid"
      >
        {Array.from({ length: COLS }, (_, col) => {
          const colFull = board[indexOf(0, col)] != null
          const colDisabled = !isMyTurn || colFull
          return (
            <button
              key={col}
              type="button"
              data-testid={`c4-col-${col}`}
              data-col={col}
              data-col-full={colFull ? '1' : '0'}
              aria-label={`Column ${col + 1}${colFull ? ', full' : ''}`}
              disabled={colDisabled}
              onMouseEnter={() => !colDisabled && setHoverCol(col)}
              onMouseLeave={() => setHoverCol(null)}
              onFocus={() => !colDisabled && setHoverCol(col)}
              onBlur={() => setHoverCol(null)}
              onClick={() => handleColumnClick(col)}
              className={[
                'relative flex flex-col gap-1 p-1 rounded-md transition-colors',
                colDisabled ? 'cursor-default' : 'cursor-pointer hover:bg-white/5 focus:bg-white/10',
              ].join(' ')}
              style={{
                appearance: 'none',
                background: 'transparent',
                border: 'none',
              }}
            >
              {Array.from({ length: ROWS }, (_, row) => {
                const idx     = indexOf(row, col)
                const cell    = board[idx]
                const isWin   = winLine?.includes(idx)
                const isFresh = lastMove?.index === idx
                const isPreview =
                  isMyTurn && status === 'playing' && previewLandingIdx === idx && cell == null

                return (
                  <span
                    key={row}
                    data-testid={`c4-cell-${idx}`}
                    data-row={row}
                    data-col={col}
                    data-mark={cell ?? ''}
                    data-win={isWin ? '1' : '0'}
                    aria-label={`Row ${row + 1}, column ${col + 1}${cell ? `, ${MARK_LABEL[cell]}` : ''}${isWin ? ', winning' : ''}`}
                    className={[
                      'block w-full rounded-full',
                      isFresh ? 'animate-[c4-drop_300ms_ease-out]' : '',
                      isWin   ? 'ring-2 ring-amber-300 ring-offset-2 ring-offset-blue-900' : '',
                    ].join(' ')}
                    style={{
                      aspectRatio: '1 / 1',
                      background: cell
                        ? MARK_COLOR[cell]
                        : isPreview
                          ? `color-mix(in srgb, ${MARK_COLOR[currentTurn]} 35%, transparent)`
                          : 'var(--game-cell-empty, #0f172a)', // slate-900
                      boxShadow: cell ? 'inset 0 -3px 0 rgba(0,0,0,0.25)' : 'inset 0 1px 2px rgba(0,0,0,0.5)',
                    }}
                  />
                )
              })}
            </button>
          )
        })}
      </div>

      {/* Spectator badge */}
      {session?.isSpectator && (
        <span
          className="text-xs px-3 py-1 rounded-full"
          style={{ backgroundColor: 'var(--color-teal-50, #f0fdfa)', color: 'var(--color-teal-600, #0d9488)' }}
        >
          Spectating
        </span>
      )}

      {/* Active-player action row: rematch (when finished), forfeit/leave (always) */}
      {isPlayer && (status === 'playing' || status === 'finished') && (
        <div className="flex items-center gap-3 w-full mb-6">
          {status === 'finished' && sdk.rematch && (
            <button
              type="button"
              data-testid="c4-rematch"
              onClick={handleRematch}
              className="flex-1 py-3 rounded-xl font-semibold border-2 transition-colors active:scale-[0.98]"
              style={{
                borderColor: 'var(--color-blue-600, #2563eb)',
                color:       'var(--color-blue-600, #2563eb)',
                background:  'var(--bg-surface, white)',
              }}
            >
              {session?.settings?.isTournament ? 'Continue' : 'Rematch'}
            </button>
          )}
          <button
            type="button"
            data-testid="c4-leave"
            onClick={() => status === 'finished' ? sdk.leaveTable?.() : setShowForfeit(true)}
            className="flex-1 py-3 rounded-xl font-semibold border-2 transition-colors active:scale-[0.98]"
            style={{
              borderColor: 'var(--border-default, #d1d5db)',
              color:       'var(--text-secondary, #4b5563)',
              background:  'var(--bg-surface, white)',
            }}
          >
            {status === 'finished' ? 'Leave' : 'Forfeit'}
          </button>
        </div>
      )}

      {/* Mid-game forfeit confirmation. Plain div + role=dialog — keeping
          dependencies minimal so the package doesn't pull in a modal lib. */}
      {showForfeit && (
        <div
          role="dialog"
          aria-modal="true"
          data-testid="c4-forfeit-dialog"
          className="fixed inset-0 flex items-center justify-center bg-black/50 z-50"
        >
          <div
            className="rounded-xl p-6 max-w-sm w-full mx-4 space-y-4"
            style={{ background: 'var(--bg-surface, white)' }}
          >
            <p className="text-base font-medium">
              Leave the table? This counts as a forfeit.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleConfirmLeaveMidGame}
                className="flex-1 py-2 rounded-lg font-semibold text-white"
                style={{ background: 'var(--color-red-600, #dc2626)' }}
              >
                Forfeit and leave
              </button>
              <button
                type="button"
                onClick={() => setShowForfeit(false)}
                className="flex-1 py-2 rounded-lg font-semibold border-2"
                style={{ borderColor: 'var(--border-default, #d1d5db)' }}
              >
                Stay
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drop animation keyframes. Scoped via a unique animation name so it
          doesn't collide with global CSS. */}
      <style>{`
        @keyframes c4-drop {
          0%   { transform: translateY(-100%); opacity: 0.4; }
          70%  { transform: translateY(0); }
          85%  { transform: translateY(-8%); }
          100% { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

// ── Status line ───────────────────────────────────────────────────────────────

function StatusLine({
  status, winner, myMark, currentTurn, round, scores,
  isSpectator, endReason, forfeiterMark, players, marks,
}) {
  let message
  if (status === 'finished') {
    if (winner) {
      const winnerName =
        players.find(p => marks?.[p.id] === winner)?.displayName
        ?? MARK_LABEL[winner] + ' wins'
      const youWon = !isSpectator && myMark === winner
      message = endReason === 'forfeit' && forfeiterMark
        ? `${MARK_LABEL[winner]} wins by forfeit`
        : (youWon ? 'You win!' : `${winnerName}`)
    } else {
      message = 'Draw'
    }
  } else {
    if (isSpectator) {
      message = `${MARK_LABEL[currentTurn]} to move`
    } else if (currentTurn === myMark) {
      message = 'Your turn'
    } else {
      message = `Waiting for ${MARK_LABEL[currentTurn]}`
    }
  }

  return (
    <div
      data-testid="c4-status"
      className="flex items-center justify-between w-full px-2"
      style={{ fontFamily: 'var(--font-display, inherit)' }}
    >
      <span className="text-sm" style={{ color: 'var(--text-secondary, #4b5563)' }}>
        Round {round}
      </span>
      <span className="text-base font-semibold">
        {message}
      </span>
      <span
        className="text-sm tabular-nums"
        style={{ color: 'var(--text-secondary, #4b5563)' }}
        aria-label={`Score: Yellow ${scores[MARKS.FIRST]}, Red ${scores[MARKS.SECOND]}`}
      >
        <span style={{ color: MARK_COLOR[MARKS.FIRST] }}>{scores[MARKS.FIRST]}</span>
        {' – '}
        <span style={{ color: MARK_COLOR[MARKS.SECOND] }}>{scores[MARKS.SECOND]}</span>
      </span>
    </div>
  )
}
