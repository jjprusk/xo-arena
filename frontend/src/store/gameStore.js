import { create } from 'zustand'

const EMPTY_BOARD = Array(9).fill(null)

export const useGameStore = create((set, get) => ({
  // Mode selection
  mode: null,         // 'pvai' | 'pvp'
  difficulty: 'medium',
  aiImplementation: 'minimax',
  playerMark: 'X',   // which mark the human plays
  playerName: '',

  // Game state
  board: [...EMPTY_BOARD],
  currentTurn: 'X',
  scores: { X: 0, O: 0 },
  round: 1,
  status: 'idle',     // 'idle' | 'playing' | 'won' | 'draw' | 'forfeit'
  winner: null,
  winLine: null,
  isAIThinking: false,

  // Actions
  setMode(mode) { set({ mode }) },
  setDifficulty(d) { set({ difficulty: d }) },
  setAIImplementation(id) { set({ aiImplementation: id }) },
  setPlayerMark(mark) { set({ playerMark: mark }) },
  setPlayerName(name) { set({ playerName: name }) },

  startGame() {
    set({
      board: [...EMPTY_BOARD],
      currentTurn: 'X',
      status: 'playing',
      winner: null,
      winLine: null,
      isAIThinking: false,
    })
  },

  makeMove(index) {
    const { board, currentTurn, status } = get()
    if (status !== 'playing') return
    if (board[index] !== null) return

    const next = [...board]
    next[index] = currentTurn

    const { winner, winLine } = checkWin(next)
    const isDraw = !winner && next.every((c) => c !== null)

    set({
      board: next,
      currentTurn: currentTurn === 'X' ? 'O' : 'X',
      status: winner ? 'won' : isDraw ? 'draw' : 'playing',
      winner: winner || null,
      winLine: winLine || null,
    })

    if (winner) {
      set((state) => ({
        scores: {
          ...state.scores,
          [winner]: state.scores[winner] + 1,
        },
      }))
    }
  },

  setAIThinking(val) { set({ isAIThinking: val }) },

  rematch() {
    const { currentTurn } = get()
    set({
      board: [...EMPTY_BOARD],
      currentTurn: currentTurn === 'X' ? 'O' : 'X',
      status: 'playing',
      winner: null,
      winLine: null,
      isAIThinking: false,
      round: get().round + 1,
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
    })
  },

  forfeit() {
    const { currentTurn } = get()
    const opp = currentTurn === 'X' ? 'O' : 'X'
    set({
      status: 'forfeit',
      winner: opp,
      scores: (state) => ({ ...state.scores, [opp]: state.scores[opp] + 1 }),
    })
  },
}))

// WIN_LINES copied here so gameStore is self-contained (game logic lives in backend for AI)
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
