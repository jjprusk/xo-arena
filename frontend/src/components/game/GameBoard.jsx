import React from 'react'
import { useEffect, useCallback, useState } from 'react'
import { useGameStore } from '../../store/gameStore.js'
import { useSoundStore } from '../../store/soundStore.js'
import { api } from '../../lib/api.js'

const MARK_COLOR = {
  X: 'var(--color-blue-600)',
  O: 'var(--color-teal-600)',
}

export default function GameBoard() {
  const {
    board, currentTurn, status, winner, winLine, scores, round,
    playerMark, mode, difficulty, aiImplementation, isAIThinking,
    makeMove, setAIThinking, rematch, newGame,
  } = useGameStore()

  const { play } = useSoundStore()
  const [showForfeitDialog, setShowForfeitDialog] = useState(false)
  const [aiError, setAIError] = useState(null)

  const aiMark = playerMark === 'X' ? 'O' : 'X'
  const isPlayerTurn = status === 'playing' && currentTurn === playerMark

  // AI move effect
  useEffect(() => {
    if (mode !== 'pvai') return
    if (status !== 'playing') return
    if (currentTurn !== aiMark) return

    let cancelled = false

    async function fetchAIMove() {
      setAIThinking(true)
      setAIError(null)
      try {
        const res = await api.ai.move(board, difficulty, aiMark, aiImplementation)
        if (!cancelled) {
          makeMove(res.move)
          play('move')
        }
      } catch (err) {
        if (!cancelled) setAIError('AI failed to respond. Please try again.')
      } finally {
        if (!cancelled) setAIThinking(false)
      }
    }

    fetchAIMove()
    return () => { cancelled = true }
  }, [currentTurn, status, mode])

  const handleCellClick = useCallback((i) => {
    if (!isPlayerTurn) return
    if (board[i] !== null) return
    makeMove(i)
    play('move')
  }, [isPlayerTurn, board, makeMove, play])

  const handleForfeit = () => {
    useGameStore.getState().forfeit()
    setShowForfeitDialog(false)
    play('forfeit')
  }

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-sm mx-auto">
      {/* Round + score strip */}
      <div className="w-full flex items-center justify-between px-2">
        <ScorePill mark="X" score={scores.X} />
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Round {round}</span>
        <ScorePill mark="O" score={scores.O} />
      </div>

      {/* Turn indicator */}
      <div className="flex items-center gap-2 h-8">
        {status === 'playing' && !isAIThinking && (
          <>
            <span className="font-bold" style={{ color: MARK_COLOR[currentTurn] }}>{currentTurn}</span>
            <span style={{ color: 'var(--text-secondary)' }}>
              {currentTurn === playerMark ? "Your turn" : (mode === 'pvai' ? "AI's turn" : "Opponent's turn")}
            </span>
          </>
        )}
        {isAIThinking && (
          <span style={{ color: 'var(--text-secondary)' }}>AI is thinking…</span>
        )}
        {status === 'won' && (
          <span className="font-bold" style={{ color: winner === playerMark ? 'var(--color-teal-600)' : 'var(--color-red-600)' }}>
            {winner === playerMark ? 'You win! 🎉' : (mode === 'pvai' ? 'AI wins!' : `${winner} wins!`)}
          </span>
        )}
        {status === 'draw' && (
          <span className="font-bold" style={{ color: 'var(--color-amber-600)' }}>Draw!</span>
        )}
        {status === 'forfeit' && (
          <span className="font-bold" style={{ color: 'var(--color-red-600)' }}>Forfeited.</span>
        )}
      </div>

      {/* Board */}
      <div
        className={`relative grid grid-cols-3 gap-2 w-full transition-opacity ${isAIThinking ? 'opacity-50' : ''}`}
        aria-label="Tic-tac-toe board"
      >
        {board.map((cell, i) => {
          const isWinCell = winLine?.includes(i)
          const isPlayable = isPlayerTurn && cell === null && status === 'playing'

          return (
            <button
              key={i}
              onClick={() => handleCellClick(i)}
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

        {/* AI thinking overlay */}
        {isAIThinking && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-8 h-8 border-4 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* AI error */}
      {aiError && (
        <p className="text-sm text-[var(--color-red-600)]">{aiError}</p>
      )}

      {/* Game-end actions */}
      {(status === 'won' || status === 'draw' || status === 'forfeit') && (
        <div className="flex gap-3 w-full">
          <button
            onClick={() => { rematch(); play('move') }}
            className="flex-1 py-3 rounded-xl font-semibold border-2 border-[var(--color-blue-600)] text-[var(--color-blue-600)] hover:bg-[var(--color-blue-50)] transition-colors"
          >
            Rematch
          </button>
          <button
            onClick={newGame}
            className="flex-1 py-3 rounded-xl font-semibold text-white transition-all hover:brightness-110 active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
          >
            New Game
          </button>
        </div>
      )}

      {/* Forfeit button (during play) */}
      {status === 'playing' && (
        <button
          onClick={() => setShowForfeitDialog(true)}
          className="text-sm transition-colors hover:text-[var(--color-red-600)]"
          style={{ color: 'var(--text-muted)' }}
        >
          Forfeit
        </button>
      )}

      {/* Forfeit confirmation dialog */}
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
                className="flex-1 py-2 rounded-xl border font-medium transition-colors hover:bg-[var(--bg-surface-hover)]"
                style={{ borderColor: 'var(--border-default)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleForfeit}
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

function ScorePill({ mark, score }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-bold text-lg" style={{ fontFamily: 'var(--font-display)', color: MARK_COLOR[mark] }}>
        {mark}
      </span>
      <span
        className="text-2xl font-bold"
        style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}
      >
        {score}
      </span>
    </div>
  )
}
