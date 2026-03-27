import { create } from 'zustand'

const EMPTY_BOARD = Array(9).fill(null)

export const useGameStore = create((set, get) => ({
  // Mode selection
  mode: null,         // 'pvai' | 'pvp' | 'aivai'
  difficulty: 'intermediate',
  aiImplementation: 'minimax',
  mlModelId: null,    // modelId when aiImplementation === 'ml' or ruleSetId for 'rule_based'
  pvbotModelId: null, // when set, game records as PVBOT with this botModelId string
  playerMark: 'X',   // which mark the human plays
  alternating: false, // swap playerMark on each rematch
  playerName: '',

  // AI vs AI second engine config
  ai2Implementation: 'minimax',
  ai2Difficulty: 'master',
  ai2ModelId: null,

  // Game options
  timerEnabled: false,
  timerSeconds: 30,
  bestOf: 7,          // 3 | 5 | 7 | null (unlimited)
  misereMode: false,  // completing 3-in-a-row means you LOSE
  boardTheme: 'default',

  // Game state
  board: [...EMPTY_BOARD],
  currentTurn: 'X',
  scores: { X: 0, O: 0 },
  round: 1,
  status: 'idle',     // 'idle' | 'playing' | 'won' | 'draw' | 'forfeit'
  winner: null,
  winLine: null,
  isAIThinking: false,
  seriesWinner: null, // set when bestOf target reached
  moveHistory: [],    // [{ board, move, mark }] — snapshot before each move
  hintCell: null,     // highlighted hint cell index

  // Actions
  setMode(mode) { set({ mode }) },
  setDifficulty(d) { set({ difficulty: d }) },
  setAIImplementation(id) { set({ aiImplementation: id }) },
  setMLModelId(id) { set({ mlModelId: id }) },
  setPvbotModelId(id) { set({ pvbotModelId: id }) },
  setAI2Implementation(id) { set({ ai2Implementation: id }) },
  setAI2Difficulty(d) { set({ ai2Difficulty: d }) },
  setAI2ModelId(id) { set({ ai2ModelId: id }) },
  setPlayerMark(mark) { set({ playerMark: mark }) },
  setAlternating(val) { set({ alternating: val }) },
  setPlayerName(name) { set({ playerName: name }) },
  setTimerEnabled(val) { set({ timerEnabled: val }) },
  setTimerSeconds(n) { set({ timerSeconds: n }) },
  setBestOf(n) { set({ bestOf: n }) },
  setMisereMode(val) { set({ misereMode: val }) },
  setBoardTheme(t) { set({ boardTheme: t }) },
  setHintCell(i) { set({ hintCell: i }) },

  startGame() {
    set({
      board: [...EMPTY_BOARD],
      currentTurn: 'X',
      status: 'playing',
      winner: null,
      winLine: null,
      isAIThinking: false,
      seriesWinner: null,
      moveHistory: [],
      hintCell: null,
    })
  },

  makeMove(index) {
    const { board, currentTurn, status, misereMode, moveHistory, scores, bestOf } = get()
    if (status !== 'playing') return
    if (board[index] !== null) return

    // Snapshot board state before the move (for undo/replay)
    const histEntry = { board: [...board], move: index, mark: currentTurn }

    const next = [...board]
    next[index] = currentTurn

    const { winner: lineWinner, winLine } = checkWin(next)
    // In misère mode, completing a line means the OTHER player wins
    const winner = lineWinner
      ? (misereMode ? (lineWinner === 'X' ? 'O' : 'X') : lineWinner)
      : null
    const isDraw = !lineWinner && next.every((c) => c !== null)

    const newScores = winner
      ? { ...scores, [winner]: scores[winner] + 1 }
      : scores

    // Check best-of-N series completion
    const targetWins = bestOf ? Math.ceil(bestOf / 2) : null
    const seriesWinner = targetWins
      ? (newScores.X >= targetWins ? 'X' : newScores.O >= targetWins ? 'O' : null)
      : null

    set({
      board: next,
      currentTurn: currentTurn === 'X' ? 'O' : 'X',
      status: winner ? 'won' : isDraw ? 'draw' : 'playing',
      winner: winner || null,
      winLine: winLine || null,
      scores: newScores,
      moveHistory: [...moveHistory, histEntry],
      hintCell: null,
      ...(seriesWinner ? { seriesWinner } : {}),
    })
  },

  setAIThinking(val) { set({ isAIThinking: val }) },

  undoMove() {
    const { moveHistory, mode, status } = get()
    if (mode !== 'pvai') return
    if (status !== 'playing') return
    if (moveHistory.length === 0) return

    // Undo last 2 moves (AI + human) or 1 if only 1 move has been made
    const undoCount = Math.min(2, moveHistory.length)
    const targetIdx = moveHistory.length - undoCount
    const target = moveHistory[targetIdx]

    set({
      board: [...target.board],
      currentTurn: target.mark,
      status: 'playing',
      winner: null,
      winLine: null,
      hintCell: null,
      moveHistory: moveHistory.slice(0, targetIdx),
    })
  },

  rematch() {
    const { currentTurn, alternating, playerMark, seriesWinner } = get()
    if (seriesWinner) return // series is over; start a new game
    set({
      board: [...EMPTY_BOARD],
      currentTurn: currentTurn === 'X' ? 'O' : 'X',
      status: 'playing',
      winner: null,
      winLine: null,
      isAIThinking: false,
      round: get().round + 1,
      moveHistory: [],
      hintCell: null,
      ...(alternating ? { playerMark: playerMark === 'X' ? 'O' : 'X' } : {}),
    })
  },

  newGame() {
    set({
      board: [...EMPTY_BOARD],
      currentTurn: 'X',
      scores: { X: 0, O: 0 },
      round: 1,
      status: 'idle',
      winner: null,
      winLine: null,
      isAIThinking: false,
      mode: null,
      pvbotModelId: null,
      alternating: false,
      seriesWinner: null,
      moveHistory: [],
      hintCell: null,
    })
  },

  forfeit() {
    const { currentTurn, scores, bestOf } = get()
    const opp = currentTurn === 'X' ? 'O' : 'X'
    const newScores = { ...scores, [opp]: scores[opp] + 1 }
    const targetWins = bestOf ? Math.ceil(bestOf / 2) : null
    const seriesWinner = targetWins
      ? (newScores.X >= targetWins ? 'X' : newScores.O >= targetWins ? 'O' : null)
      : null
    set({
      status: 'forfeit',
      winner: opp,
      scores: newScores,
      ...(seriesWinner ? { seriesWinner } : {}),
    })
  },
}))

// WIN_LINES here so gameStore is self-contained
const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
]

function checkWin(board) {
  for (const line of WIN_LINES) {
    const [a, b, c] = line
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], winLine: line }
    }
  }
  return { winner: null, winLine: null }
}
