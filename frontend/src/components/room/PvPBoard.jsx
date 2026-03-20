import React, { useState } from 'react'
import { usePvpStore } from '../../store/pvpStore.js'

const MARK_COLOR = {
  X: 'var(--color-blue-600)',
  O: 'var(--color-teal-600)',
}

const REACTIONS = ['👍', '😂', '😮', '🔥', '😭', '🤔', '👏', '💀']

export default function PvPBoard() {
  const {
    board, currentTurn, status, winner, winLine, scores, round,
    myMark, role, displayName, spectatorCount, error, incomingReaction,
    move, rematch, forfeit, reset, sendReaction,
  } = usePvpStore()

  const [showForfeitDialog, setShowForfeitDialog] = useState(false)
  const [showReactions, setShowReactions] = useState(false)

  const isMyTurn = status === 'playing' && currentTurn === myMark && role !== 'spectator'
  const oppMark = myMark === 'X' ? 'O' : 'X'

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-sm mx-auto">
      {/* Room name + spectators */}
      <div className="flex items-center gap-2 text-center">
        <span className="font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
          {displayName}
        </span>
        {spectatorCount > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-teal-50)', color: 'var(--color-teal-600)' }}>
            👁 {spectatorCount}
          </span>
        )}
      </div>

      {/* Score strip */}
      <div className="w-full flex items-center justify-between px-2">
        <ScorePill mark="X" score={scores.X} highlight={myMark === 'X'} />
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Round {round}</span>
        <ScorePill mark="O" score={scores.O} highlight={myMark === 'O'} />
      </div>

      {/* Turn indicator */}
      <div className="flex items-center gap-2 h-8">
        {status === 'playing' && (
          <>
            <span className="font-bold" style={{ color: MARK_COLOR[currentTurn] }}>{currentTurn}</span>
            <span style={{ color: 'var(--text-secondary)' }}>
              {role === 'spectator'
                ? `${currentTurn}'s turn`
                : isMyTurn ? 'Your turn' : "Opponent's turn"
              }
            </span>
          </>
        )}
        {status === 'finished' && winner && (
          <span className="font-bold" style={{
            color: role === 'spectator'
              ? MARK_COLOR[winner]
              : winner === myMark ? 'var(--color-teal-600)' : 'var(--color-red-600)'
          }}>
            {role === 'spectator'
              ? `${winner} wins!`
              : winner === myMark ? 'You win! 🎉' : 'Opponent wins!'
            }
          </span>
        )}
        {status === 'finished' && !winner && (
          <span className="font-bold" style={{ color: 'var(--color-amber-600)' }}>Draw!</span>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <p className="text-sm px-3 py-2 rounded-lg w-full text-center" style={{ backgroundColor: 'var(--color-red-50)', color: 'var(--color-red-600)' }}>
          {error}
        </p>
      )}

      {/* Board */}
      <div className="grid grid-cols-3 gap-2 w-full" aria-label="Tic-tac-toe board">
        {board.map((cell, i) => {
          const isWinCell = winLine?.includes(i)
          const isPlayable = isMyTurn && cell === null && status === 'playing'

          return (
            <button
              key={i}
              onClick={() => isPlayable && move(i)}
              aria-label={`Cell ${i + 1}${cell ? `, ${cell}` : ''}`}
              disabled={!isPlayable}
              className={`
                aspect-square flex items-center justify-center rounded-xl text-4xl font-bold
                border-2 transition-all select-none
                ${isWinCell ? 'bg-[var(--color-amber-100)] border-[var(--color-amber-500)]' : 'bg-[var(--bg-surface)] border-[var(--border-default)]'}
                ${isPlayable ? 'hover:bg-[var(--bg-surface-hover)] hover:scale-[1.04] active:scale-[0.97] cursor-pointer' : 'cursor-default'}
              `}
              style={{
                minHeight: 88,
                fontFamily: 'var(--font-display)',
                color: cell ? MARK_COLOR[cell] : 'transparent',
                boxShadow: isWinCell ? 'var(--shadow-cell-win)' : 'var(--shadow-cell)',
              }}
            >
              {cell || '·'}
            </button>
          )
        })}
      </div>

      {/* Incoming reaction */}
      {incomingReaction && (
        <div
          key={incomingReaction.id}
          className="text-5xl animate-bounce pointer-events-none select-none"
          style={{ lineHeight: 1 }}
        >
          {incomingReaction.emoji}
        </div>
      )}

      {/* Reaction bar (players only, during game or finished) */}
      {role !== 'spectator' && (status === 'playing' || status === 'finished') && (
        <div className="w-full">
          <button
            onClick={() => setShowReactions(v => !v)}
            title="Send reaction"
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
                  onClick={() => { sendReaction(emoji); setShowReactions(false) }}
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
      {role === 'spectator' && (
        <span className="text-xs px-3 py-1 rounded-full" style={{ backgroundColor: 'var(--color-teal-50)', color: 'var(--color-teal-600)' }}>
          Spectating
        </span>
      )}

      {/* Game-end actions */}
      {status === 'finished' && role !== 'spectator' && (
        <div className="flex gap-3 w-full">
          <button
            onClick={rematch}
            className="flex-1 py-3 rounded-xl font-semibold border-2 border-[var(--color-blue-600)] text-[var(--color-blue-600)] hover:bg-[var(--color-blue-50)] transition-colors"
          >
            Rematch
          </button>
          <button
            onClick={reset}
            className="flex-1 py-3 rounded-xl font-semibold text-white transition-all hover:brightness-110 active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
          >
            New Game
          </button>
        </div>
      )}

      {/* Forfeit button */}
      {status === 'playing' && role !== 'spectator' && (
        <button
          onClick={() => setShowForfeitDialog(true)}
          className="text-sm transition-colors hover:text-[var(--color-red-600)]"
          style={{ color: 'var(--text-muted)' }}
        >
          Forfeit
        </button>
      )}

      {/* Forfeit dialog */}
      {showForfeitDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="rounded-2xl p-6 w-full max-w-xs space-y-4" style={{ backgroundColor: 'var(--bg-surface)' }}>
            <h2 className="font-bold text-lg" style={{ fontFamily: 'var(--font-display)' }}>Forfeit game?</h2>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Your opponent will be declared the winner.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowForfeitDialog(false)}
                className="flex-1 py-2 rounded-xl border font-medium hover:bg-[var(--bg-surface-hover)] transition-colors"
                style={{ borderColor: 'var(--border-default)' }}
              >
                Cancel
              </button>
              <button
                onClick={() => { forfeit(); setShowForfeitDialog(false) }}
                className="flex-1 py-2 rounded-xl font-medium bg-[var(--color-red-600)] text-white hover:bg-[var(--color-red-700)] transition-colors"
              >
                Forfeit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ScorePill({ mark, score, highlight }) {
  return (
    <div className={`flex items-center gap-2 ${highlight ? 'font-bold' : ''}`}>
      <span style={{ fontFamily: 'var(--font-display)', color: MARK_COLOR[mark], fontSize: highlight ? '1.25rem' : '1rem' }}>
        {mark}
      </span>
      <span className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
        {score}
      </span>
    </div>
  )
}
