import React from 'react'
import { useEffect, useCallback, useState, useRef } from 'react'
import { useSession } from '../../lib/auth-client.js'
import { getToken } from '../../lib/getToken.js'
import { useGameStore } from '../../store/gameStore.js'
import { useSoundStore } from '../../store/soundStore.js'
import { api } from '../../lib/api.js'

const MARK_COLOR = {
  X: 'var(--color-blue-600)',
  O: 'var(--color-teal-600)',
}

const MINIMAX_RULES = [
  { id: 'win',             label: 'Win',             desc: 'Complete a two-in-a-row to win immediately' },
  { id: 'block',           label: 'Block',           desc: "Stop your two-in-a-row threat" },
  { id: 'fork',            label: 'Fork',            desc: 'Create two simultaneous winning threats' },
  { id: 'block_fork',      label: 'Block fork',      desc: 'Deny you a fork opportunity' },
  { id: 'center',          label: 'Center',          desc: 'Take the center square for maximum control' },
  { id: 'opposite_corner', label: 'Opposite corner', desc: 'Play opposite your corner to neutralise it' },
  { id: 'corner',          label: 'Corner',          desc: 'Claim an empty corner' },
  { id: 'side',            label: 'Side',            desc: 'Play an empty side square' },
]

const RULE_LABELS = Object.fromEntries(
  MINIMAX_RULES.map(r => [r.id, { short: r.label, desc: r.desc }])
)

const THEME_MARKS = {
  default: { X: 'var(--color-blue-600)',   O: 'var(--color-teal-600)' },
  neon:    { X: 'var(--color-neon-x)',     O: 'var(--color-neon-o)' },
  minimal: { X: '#111111',                 O: '#111111' },
  retro:   { X: 'var(--color-retro-x)',    O: 'var(--color-retro-o)' },
}

/** Minimum ms between AI moves in AI-vs-AI mode (spectator pacing) */
const AIVAI_MOVE_DELAY_MS = 700

export default function GameBoard({ roomName }) {
  const [xModelName, setXModelName] = useState(null)
  const [oModelName, setOModelName] = useState(null)
  const [xCreatorName, setXCreatorName] = useState(null)
  const [oCreatorName, setOCreatorName] = useState(null)
  const [autoRematchCountdown, setAutoRematchCountdown] = useState(null)

  const {
    board, currentTurn, status, winner, winLine, scores, round,
    playerMark, mode, difficulty, aiImplementation, mlModelId, isAIThinking,
    timerEnabled, timerSeconds, bestOf, seriesWinner, moveHistory, hintCell, misereMode,
    boardTheme,
    // AI vs AI
    ai2Implementation, ai2Difficulty, ai2ModelId,
    makeMove, setAIThinking, rematch, newGame, forfeit, undoMove, setHintCell,
  } = useGameStore()

  const { data: session } = useSession()
  const user = session?.user ?? null
  const isSignedIn = !!session?.user
  const { play } = useSoundStore()
  const [showForfeitDialog, setShowForfeitDialog] = useState(false)
  const [aiError, setAIError] = useState(null)
  const [aiConfidence, setAIConfidence] = useState(null)
  const [aiReason, setAIReason] = useState(null)
  const [showStrategy, setShowStrategy] = useState(false)
  const [lastPlacedCell, setLastPlacedCell] = useState(null)
  const [hintLoading, setHintLoading] = useState(false)
  // Post-game analysis
  const [analyzeMode, setAnalyzeMode] = useState(false)
  const [replayIdx, setReplayIdx] = useState(0)

  const gameStartRef = useRef(null)
  const lastHumanMoveRef = useRef(null)
  const aivaiMoveActiveRef = useRef(false)

  const aiMark = playerMark === 'X' ? 'O' : 'X'
  const isAivai = mode === 'aivai'

  // ── Fetch ML model names + creator for AI vs AI display ─────────────────
  useEffect(() => {
    if (!isAivai) return
    setXModelName(null)
    setOModelName(null)
    setXCreatorName(null)
    setOCreatorName(null)
    if (aiImplementation === 'ml' && mlModelId) {
      api.ml.getModel(mlModelId).then(d => {
        setXModelName(d?.model?.name ?? null)
        setXCreatorName(d?.model?.creatorName ?? null)
      }).catch(() => {})
    }
    if (ai2Implementation === 'ml' && ai2ModelId) {
      api.ml.getModel(ai2ModelId).then(d => {
        setOModelName(d?.model?.name ?? null)
        setOCreatorName(d?.model?.creatorName ?? null)
      }).catch(() => {})
    }
  }, [isAivai, aiImplementation, mlModelId, ai2Implementation, ai2ModelId])
  const isPlayerTurn = !isAivai && status === 'playing' && currentTurn === playerMark
  const isOpponentTurn = !isAivai && status === 'playing' && currentTurn !== playerMark

  const themeMarkColor = THEME_MARKS[boardTheme] || THEME_MARKS.default

  // ── Auto-rematch for AI vs AI series ────────────────────────────────────
  useEffect(() => {
    if (!isAivai) return
    const gameOver = status === 'won' || status === 'draw'
    if (!gameOver || seriesWinner) { setAutoRematchCountdown(null); return }

    let seconds = 3
    setAutoRematchCountdown(seconds)
    const interval = setInterval(() => {
      seconds -= 1
      if (seconds <= 0) {
        clearInterval(interval)
        setAutoRematchCountdown(null)
        rematch()
      } else {
        setAutoRematchCountdown(seconds)
      }
    }, 1000)
    return () => { clearInterval(interval); setAutoRematchCountdown(null) }
  }, [isAivai, status, seriesWinner])

  // ── Ticking thinking timer for the opponent ──────────────────────────────
  const thinkingStartRef = useRef(null)
  const [thinkingMs, setThinkingMs] = useState(0)
  const [frozenThinkingMs, setFrozenThinkingMs] = useState(null)
  useEffect(() => {
    if (!isOpponentTurn) {
      if (thinkingStartRef.current) setFrozenThinkingMs(Date.now() - thinkingStartRef.current)
      setThinkingMs(0)
      thinkingStartRef.current = null
      return
    }
    setFrozenThinkingMs(null)
    thinkingStartRef.current = Date.now()
    setThinkingMs(0)
    const id = setInterval(() => setThinkingMs(Date.now() - thinkingStartRef.current), 100)
    return () => clearInterval(id)
  }, [isOpponentTurn])

  // ── Turn timer (countdown) ───────────────────────────────────────────────
  const [timeLeft, setTimeLeft] = useState(null)
  const timerRef = useRef(null)

  useEffect(() => {
    if (!timerEnabled || isAivai) { setTimeLeft(null); return }
    if (status !== 'playing') { setTimeLeft(null); return }

    setTimeLeft(timerSeconds)
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current)
          // Time's up — forfeit the current player
          useGameStore.getState().forfeit()
          play('forfeit')
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [currentTurn, status, timerEnabled, timerSeconds, isAivai])

  // ── Track game start time ────────────────────────────────────────────────
  useEffect(() => {
    if (status === 'playing' && !gameStartRef.current) {
      gameStartRef.current = Date.now()
    }
    if (status === 'idle') {
      gameStartRef.current = null
    }
  }, [status])

  // ── Track last placed cell for animation ────────────────────────────────
  useEffect(() => {
    if (moveHistory.length === 0) { setLastPlacedCell(null); return }
    const last = moveHistory[moveHistory.length - 1]
    setLastPlacedCell(last.move)
    const t = setTimeout(() => setLastPlacedCell(null), 350)
    return () => clearTimeout(t)
  }, [moveHistory.length])

  // ── Record PvAI game result when game ends ───────────────────────────────
  useEffect(() => {
    if (mode !== 'pvai') return
    if (status !== 'won' && status !== 'draw' && status !== 'forfeit') return

    async function recordGame() {
      const token = await getToken()
      if (!token) return

      const totalMoves = board.filter(Boolean).length
      const startedAt = gameStartRef.current || Date.now()
      const durationMs = Date.now() - startedAt

      let outcome = 'DRAW'
      if (status === 'won' || status === 'forfeit') {
        outcome = winner === playerMark ? 'PLAYER1_WIN' : 'AI_WIN'
      }

      api.games.record({
        outcome,
        difficulty,
        aiImplementationId: aiImplementation,
        totalMoves,
        durationMs,
        startedAt,
      }, token).catch(() => {})

      if (aiImplementation === 'ml' && mlModelId && isSignedIn && user?.id) {
        api.ml.recordGameEnd(mlModelId, user.id).catch(() => {})
      }
    }

    recordGame()
  }, [status])

  // ── AI move effect (PvAI — player's AI opponent) ─────────────────────────
  useEffect(() => {
    if (mode !== 'pvai') return
    if (status !== 'playing') return
    if (currentTurn !== aiMark) return

    let cancelled = false

    async function fetchAIMove() {
      setAIThinking(true)
      setAIError(null)
      const isML = aiImplementation === 'ml'
      const profileUserId = isML && isSignedIn && user?.id ? user.id : null
      const humanLastMove = profileUserId ? lastHumanMoveRef.current : null
      try {
        const res = await api.ai.move(board, difficulty, aiMark, aiImplementation, mlModelId, true, profileUserId, humanLastMove)
        if (!cancelled) {
          makeMove(res.move)
          play('move')
          if (res.explanation) {
            setAIConfidence(res.explanation.confidence ?? null)
            setAIReason(res.explanation.rule ?? null)
          } else {
            setAIConfidence(null)
            setAIReason(null)
          }
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

  // ── AI vs AI move effect ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isAivai) return
    if (status !== 'playing') return
    if (aivaiMoveActiveRef.current) return

    let cancelled = false
    aivaiMoveActiveRef.current = true

    async function fetchAIVsAIMove() {
      setAIThinking(true)
      const moveStart = Date.now()

      // X always uses the first AI config, O uses the second
      const isXTurn = currentTurn === 'X'
      const impl = isXTurn ? aiImplementation : ai2Implementation
      const diff  = isXTurn ? difficulty        : ai2Difficulty
      const model = isXTurn ? mlModelId         : ai2ModelId

      try {
        const res = await api.ai.move(board, diff, currentTurn, impl, model, false)
        if (!cancelled) {
          // Enforce minimum delay for spectator pacing
          const elapsed = Date.now() - moveStart
          const delay = Math.max(0, AIVAI_MOVE_DELAY_MS - elapsed)
          await new Promise(r => setTimeout(r, delay))
          if (!cancelled) {
            makeMove(res.move)
            play('move')
          }
        }
      } catch {
        if (!cancelled) setAIError('AI failed to respond.')
      } finally {
        if (!cancelled) {
          setAIThinking(false)
          aivaiMoveActiveRef.current = false
        }
      }
    }

    fetchAIVsAIMove()
    return () => {
      cancelled = true
      aivaiMoveActiveRef.current = false
    }
  }, [currentTurn, status, isAivai])

  // ── Hint ─────────────────────────────────────────────────────────────────
  async function handleHint() {
    if (!isPlayerTurn || hintLoading) return
    setHintLoading(true)
    try {
      // Always use minimax master for best-move hints
      const res = await api.ai.move(board, 'master', playerMark, 'minimax', null, false)
      setHintCell(res.move)
    } catch { /* non-fatal */ } finally {
      setHintLoading(false)
    }
  }

  const handleCellClick = useCallback((i) => {
    if (!isPlayerTurn) return
    if (board[i] !== null) return
    lastHumanMoveRef.current = i
    makeMove(i)
    play('move')
  }, [isPlayerTurn, board, makeMove, play])

  const handleForfeit = () => {
    forfeit()
    setShowForfeitDialog(false)
    play('forfeit')
  }

  // ── Post-game analysis helpers ───────────────────────────────────────────
  const totalMoves = moveHistory.length
  const replayBoard = analyzeMode && moveHistory.length > 0
    ? (replayIdx < moveHistory.length
        ? moveHistory[replayIdx].board
        : board)
    : null
  const replayMoveIdx = analyzeMode && replayIdx < moveHistory.length
    ? moveHistory[replayIdx].move
    : null

  const displayBoard = replayBoard || board

  // ── Board theme class ────────────────────────────────────────────────────
  const themeClass = boardTheme !== 'default' ? `board-theme-${boardTheme}` : ''

  return (
    <div className={`flex flex-col items-center ${isAivai ? 'gap-3' : 'gap-4'} w-full max-w-sm mx-auto ${themeClass}`}>
      {/* Room name */}
      {roomName && (
        <h1 className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          {roomName}
        </h1>
      )}

      {/* Series winner banner */}
      {seriesWinner && (
        <div
          className="w-full text-center py-3 px-4 rounded-xl font-bold text-lg"
          style={{
            backgroundColor: seriesWinner === playerMark ? 'var(--color-teal-50)' : 'var(--color-red-50)',
            color: seriesWinner === playerMark ? 'var(--color-teal-700)' : 'var(--color-red-700)',
            border: `2px solid ${seriesWinner === playerMark ? 'var(--color-teal-500)' : 'var(--color-red-500)'}`,
          }}
        >
          {isAivai
            ? `${seriesWinner} wins the series! Best of ${bestOf}`
            : seriesWinner === playerMark
              ? `You win the series! Best of ${bestOf}`
              : `AI wins the series. Best of ${bestOf}`}
        </div>
      )}

      {/* AI vs AI matchup strip */}
      {isAivai && (
        <div className="w-full flex items-center gap-2">
          <AiPlayer
            mark="X"
            impl={aiImplementation}
            difficulty={difficulty}
            modelName={xModelName}
            creatorName={xCreatorName}
            isActive={status === 'playing' && currentTurn === 'X'}
            isThinking={isAIThinking && currentTurn === 'X'}
          />
          <span className="shrink-0 text-xs font-bold px-1" style={{ color: 'var(--text-muted)' }}>vs</span>
          <AiPlayer
            mark="O"
            impl={ai2Implementation}
            difficulty={ai2Difficulty}
            modelName={oModelName}
            creatorName={oCreatorName}
            isActive={status === 'playing' && currentTurn === 'O'}
            isThinking={isAIThinking && currentTurn === 'O'}
          />
        </div>
      )}

      {/* Round + score strip */}
      <div className="w-full flex items-center justify-between px-2">
        <ScorePill mark="X" score={scores.X} />
        <div className="text-center">
          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Round {round}{bestOf ? ` / Best of ${bestOf}` : ''}
          </span>
          {misereMode && (
            <div className="text-xs font-medium" style={{ color: 'var(--color-amber-600)' }}>Misère mode</div>
          )}
        </div>
        <ScorePill mark="O" score={scores.O} />
      </div>

      {/* Turn timer bar */}
      {timerEnabled && !isAivai && status === 'playing' && timeLeft !== null && (
        <div className="w-full space-y-1">
          <div className="flex justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
            <span>Time left</span>
            <span
              className="font-mono font-bold tabular-nums"
              style={{ color: timeLeft <= 5 ? 'var(--color-red-600)' : 'var(--text-secondary)' }}
            >
              {timeLeft}s
            </span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-gray-200)' }}>
            <div
              className="h-full rounded-full transition-all duration-1000"
              style={{
                width: `${(timeLeft / timerSeconds) * 100}%`,
                backgroundColor: timeLeft <= 5 ? 'var(--color-red-500)' : 'var(--color-blue-500)',
              }}
            />
          </div>
        </div>
      )}

      {/* Turn indicator */}
      <div className="flex items-center gap-2 h-8">
        {status === 'playing' && !analyzeMode && (
          <>
            <span className="font-bold" style={{ color: themeMarkColor[currentTurn] ?? MARK_COLOR[currentTurn] }}>{currentTurn}</span>
            {isAivai && (
              <span style={{ color: 'var(--text-secondary)' }}>
                {isAIThinking ? 'thinking…' : 'AI vs AI'}
              </span>
            )}
            {isPlayerTurn && (
              <>
                <span style={{ color: 'var(--text-secondary)' }}>Your turn</span>
                {frozenThinkingMs != null && (
                  <span className="ml-1 tabular-nums text-sm font-mono" style={{ color: 'var(--text-muted)' }}>
                    {(frozenThinkingMs / 1000).toFixed(2)}s
                  </span>
                )}
              </>
            )}
            {isOpponentTurn && (
              <>
                <span style={{ color: 'var(--text-secondary)' }}>
                  {isAIThinking ? 'AI is thinking…' : (mode === 'pvai' ? "AI's turn" : "Opponent's turn")}
                </span>
                <span className="ml-1 tabular-nums text-sm font-mono" style={{ color: 'var(--text-muted)' }}>
                  {(thinkingMs / 1000).toFixed(2)}s
                </span>
              </>
            )}
          </>
        )}
        {analyzeMode && (
          <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            Replay — move {replayIdx} / {totalMoves}
          </span>
        )}
        {status === 'won' && !analyzeMode && (
          <>
            <span className="font-bold" style={{ color: winner === playerMark ? 'var(--color-teal-600)' : 'var(--color-red-600)' }}>
              {isAivai
                ? `${winner} wins!`
                : winner === playerMark ? 'You win! 🎉' : (mode === 'pvai' ? 'AI wins!' : `${winner} wins!`)}
            </span>
            {isAivai && autoRematchCountdown !== null && (
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>· Next in {autoRematchCountdown}…</span>
            )}
          </>
        )}
        {status === 'draw' && !analyzeMode && (
          <>
            <span className="font-bold" style={{ color: 'var(--color-amber-600)' }}>Draw!</span>
            {isAivai && autoRematchCountdown !== null && (
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>· Next in {autoRematchCountdown}…</span>
            )}
          </>
        )}
        {status === 'forfeit' && !analyzeMode && (
          <span className="font-bold" style={{ color: 'var(--color-red-600)' }}>Forfeited.</span>
        )}
      </div>

      {/* ML confidence bar */}
      {aiImplementation === 'ml' && aiConfidence !== null && status === 'playing' && !analyzeMode && (
        <div className="w-full space-y-1">
          <div className="flex justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
            <span>AI confidence</span>
            <span>{Math.round(aiConfidence * 100)}%</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-gray-200)' }}>
            <div className="h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.round(aiConfidence * 100)}%`, backgroundColor: 'var(--color-teal-500)' }} />
          </div>
        </div>
      )}

      {/* Minimax last-move rule badge */}
      {aiImplementation === 'minimax' && aiReason && !analyzeMode && (
        <div className="w-full flex items-center gap-2">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>AI played:</span>
          <span
            className="text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: 'var(--color-blue-50)', color: 'var(--color-blue-700)' }}
          >
            {RULE_LABELS[aiReason]?.short ?? aiReason}
          </span>
        </div>
      )}

      {/* Minimax strategy panel */}
      {aiImplementation === 'minimax' && mode === 'pvai' && status === 'playing' && !analyzeMode && (
        <div className="w-full">
          <button
            onClick={() => setShowStrategy(v => !v)}
            className="w-full flex items-center justify-between text-xs px-3 py-2 rounded-lg border transition-colors hover:bg-[var(--bg-surface-hover)]"
            style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-surface)', color: 'var(--text-secondary)' }}
          >
            <span className="font-medium">How Minimax thinks</span>
            <span>{showStrategy ? '▲' : '▼'}</span>
          </button>
          {showStrategy && (
            <div
              className="mt-1 rounded-lg border overflow-hidden"
              style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
            >
              {MINIMAX_RULES.map((rule, idx) => {
                const isActive = aiReason === rule.id
                return (
                  <div
                    key={rule.id}
                    className="flex items-start gap-3 px-3 py-2 border-b last:border-0 transition-colors"
                    style={{
                      borderColor: 'var(--border-default)',
                      backgroundColor: isActive ? 'var(--color-blue-50)' : 'transparent',
                    }}
                  >
                    <span
                      className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold mt-0.5"
                      style={{
                        backgroundColor: isActive ? 'var(--color-blue-600)' : 'var(--color-gray-200)',
                        color: isActive ? 'white' : 'var(--text-muted)',
                      }}
                    >
                      {idx + 1}
                    </span>
                    <div>
                      <div
                        className="text-xs font-semibold"
                        style={{ color: isActive ? 'var(--color-blue-700)' : 'var(--text-primary)' }}
                      >
                        {rule.label}
                      </div>
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{rule.desc}</div>
                    </div>
                  </div>
                )
              })}
              {difficulty === 'novice' && (
                <p className="text-xs px-3 py-2" style={{ color: 'var(--text-muted)' }}>
                  Easy mode plays randomly — no strategy is applied.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Board */}
      <div
        className={`relative grid grid-cols-3 gap-2 w-full transition-opacity ${isAIThinking && !analyzeMode ? 'opacity-60' : ''}`}
        aria-label="Tic-tac-toe board"
      >
        {displayBoard.map((cell, i) => {
          const isWinCell = !analyzeMode && winLine?.includes(i)
          const isPlayable = isPlayerTurn && cell === null && status === 'playing' && !analyzeMode
          const isHint = hintCell === i && isPlayerTurn
          const isLastPlaced = lastPlacedCell === i && !analyzeMode
          const isReplayMove = analyzeMode && replayMoveIdx === i

          return (
            <button
              key={i}
              onClick={() => handleCellClick(i)}
              aria-label={`Cell ${i + 1}${cell ? `, ${cell}` : ''}`}
              disabled={!isPlayable}
              className={`
                aspect-square flex items-center justify-center rounded-xl text-4xl font-bold
                border-2 transition-all select-none
                ${isWinCell ? 'bg-[var(--color-amber-100)] border-[var(--color-amber-500)]' : ''}
                ${isHint && !cell ? 'border-[var(--color-teal-500)] bg-[var(--color-teal-50)] animate-pulse' : ''}
                ${isReplayMove ? 'border-[var(--color-blue-500)] bg-[var(--color-blue-50)]' : ''}
                ${!isWinCell && !isHint && !isReplayMove ? 'bg-[var(--bg-surface)] border-[var(--border-default)]' : ''}
                ${isPlayable ? 'hover:bg-[var(--bg-surface-hover)] hover:scale-[1.04] active:scale-[0.97] cursor-pointer' : 'cursor-default'}
                ${isLastPlaced ? 'mark-pop' : ''}
              `}
              style={{
                minHeight: 88,
                fontFamily: 'var(--font-display)',
                color: cell ? (themeMarkColor[cell] ?? MARK_COLOR[cell]) : 'transparent',
                boxShadow: isWinCell ? 'var(--shadow-cell-win)' : 'var(--shadow-cell)',
              }}
            >
              {cell || '·'}
            </button>
          )
        })}

        {/* AI thinking overlay */}
        {isAIThinking && !analyzeMode && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-8 h-8 border-4 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* AI error */}
      {aiError && (
        <p className="text-sm text-[var(--color-red-600)]">{aiError}</p>
      )}

      {/* Hint + Undo row (during play, pvai only) */}
      {mode === 'pvai' && status === 'playing' && !analyzeMode && (
        <div className="flex gap-2 w-full">
          <button
            onClick={handleHint}
            disabled={!isPlayerTurn || hintLoading}
            className="flex-1 py-2 rounded-lg text-sm font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--bg-surface-hover)]"
            style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-surface)', color: 'var(--color-teal-600)' }}
          >
            {hintLoading ? 'Thinking…' : 'Hint'}
          </button>
          <button
            onClick={undoMove}
            disabled={moveHistory.length < 2}
            className="flex-1 py-2 rounded-lg text-sm font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--bg-surface-hover)]"
            style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
          >
            Undo
          </button>
        </div>
      )}

      {/* Post-game analysis panel */}
      {(status === 'won' || status === 'draw' || status === 'forfeit') && moveHistory.length > 0 && !analyzeMode && (
        <button
          onClick={() => { setAnalyzeMode(true); setReplayIdx(0) }}
          className="w-full py-2 rounded-lg text-sm font-medium border transition-colors hover:bg-[var(--bg-surface-hover)]"
          style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
        >
          Analyze game
        </button>
      )}

      {analyzeMode && (
        <div className="w-full space-y-3">
          <div className="flex gap-2 items-center">
            <button
              onClick={() => setReplayIdx(0)}
              disabled={replayIdx === 0}
              className="px-2 py-1.5 rounded-lg border text-sm font-medium disabled:opacity-40 transition-colors hover:bg-[var(--bg-surface-hover)]"
              style={{ borderColor: 'var(--border-default)' }}
            >«</button>
            <button
              onClick={() => setReplayIdx(i => Math.max(0, i - 1))}
              disabled={replayIdx === 0}
              className="px-3 py-1.5 rounded-lg border text-sm font-medium disabled:opacity-40 transition-colors hover:bg-[var(--bg-surface-hover)]"
              style={{ borderColor: 'var(--border-default)' }}
            >‹ Prev</button>
            <span className="flex-1 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
              {replayIdx < totalMoves
                ? `Before move ${replayIdx + 1} (${moveHistory[replayIdx]?.mark} → cell ${moveHistory[replayIdx]?.move + 1})`
                : 'Final position'}
            </span>
            <button
              onClick={() => setReplayIdx(i => Math.min(totalMoves, i + 1))}
              disabled={replayIdx >= totalMoves}
              className="px-3 py-1.5 rounded-lg border text-sm font-medium disabled:opacity-40 transition-colors hover:bg-[var(--bg-surface-hover)]"
              style={{ borderColor: 'var(--border-default)' }}
            >Next ›</button>
            <button
              onClick={() => setReplayIdx(totalMoves)}
              disabled={replayIdx >= totalMoves}
              className="px-2 py-1.5 rounded-lg border text-sm font-medium disabled:opacity-40 transition-colors hover:bg-[var(--bg-surface-hover)]"
              style={{ borderColor: 'var(--border-default)' }}
            >»</button>
          </div>
          <button
            onClick={() => setAnalyzeMode(false)}
            className="w-full py-2 rounded-lg text-sm font-medium border transition-colors hover:bg-[var(--bg-surface-hover)]"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}
          >
            Exit analysis
          </button>
        </div>
      )}

      {/* Game-end actions */}
      {(status === 'won' || status === 'draw' || status === 'forfeit') && !analyzeMode && !seriesWinner && !isAivai && (
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

      {/* Series over — only New Game */}
      {(status === 'won' || status === 'draw' || status === 'forfeit') && !analyzeMode && seriesWinner && (
        <button
          onClick={newGame}
          className="w-full py-3 rounded-xl font-semibold text-white transition-all hover:brightness-110 active:scale-[0.98]"
          style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
        >
          New Game
        </button>
      )}

      {/* Forfeit button (during play) */}
      {status === 'playing' && !isAivai && !analyzeMode && (
        <button
          onClick={() => setShowForfeitDialog(true)}
          className="text-sm transition-colors hover:text-[var(--color-red-600)]"
          style={{ color: 'var(--text-muted)' }}
        >
          Forfeit
        </button>
      )}

      {/* AI vs AI stop button */}
      {isAivai && !analyzeMode && (
        <button
          onClick={newGame}
          className="text-sm transition-colors hover:text-[var(--color-red-600)]"
          style={{ color: 'var(--text-secondary)' }}
        >
          Stop spectating
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

function implLabel(impl, difficulty, modelName) {
  if (impl === 'ml') return modelName ?? 'ML model'
  if (impl === 'minimax') return `Minimax · ${difficulty ?? ''}`
  if (impl === 'random') return 'Random'
  return impl ?? '—'
}

function AiPlayer({ mark, impl, difficulty, modelName, creatorName, isActive, isThinking }) {
  const color = mark === 'X' ? 'var(--color-blue-600)' : 'var(--color-teal-600)'
  const bgActive = mark === 'X' ? 'var(--color-blue-50)' : 'var(--color-teal-50)'
  const borderActive = mark === 'X' ? 'var(--color-blue-300)' : 'var(--color-teal-300)'
  const label = implLabel(impl, difficulty, modelName)
  const tooltip = creatorName ? `${label} · by ${creatorName}` : undefined
  return (
    <div
      className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl border transition-all"
      style={{
        backgroundColor: isActive ? bgActive : 'var(--bg-surface)',
        borderColor: isActive ? borderActive : 'var(--border-default)',
        boxShadow: isActive ? `0 0 0 2px ${borderActive}` : 'none',
      }}
    >
      <span className="text-xl font-bold shrink-0" style={{ fontFamily: 'var(--font-display)', color }}>{mark}</span>
      <div className="min-w-0">
        <div className="text-xs font-semibold truncate" style={{ color: isActive ? color : 'var(--text-primary)' }} title={tooltip}>
          {label}
        </div>
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {isThinking ? (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: color }} />
              thinking…
            </span>
          ) : isActive ? 'to move' : 'waiting'}
        </div>
      </div>
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
