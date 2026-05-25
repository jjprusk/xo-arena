// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Unit tests for `@callidity/game-connect-four`'s GameComponent.
 *
 * The tests run from landing's vitest tree (jsdom + RTL already wired
 * via landing/src/test/setup.js) so we don't have to duplicate React
 * test infrastructure inside the package. They import directly from the
 * package source, the same way `PlayPage.test.jsx` does for XO.
 *
 * Surfaces covered:
 *   - 6×7 board renders with 42 cells + 7 column buttons + status line
 *   - clicking a column for the active player calls sdk.submitMove(col)
 *   - clicking when not your turn / column is full / spectator is a no-op
 *   - incoming sdk.onMove updates the board and triggers playSound
 *   - terminal game state triggers signalEnd exactly once
 *   - winning line is highlighted via data-win="1"
 *   - spectator mode shows the badge and disables column buttons
 *   - rematch + forfeit/leave buttons wire to the SDK
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import GameComponent, {
  initialGameState,
  MARKS, drop, indexOf, getWinner,
} from '@callidity/game-connect-four'

const Y = MARKS.FIRST  // 'Y'
const R = MARKS.SECOND // 'R'

// ── Test SDK fixture ──────────────────────────────────────────────────────────
//
// Minimal SDK stand-in matching the GameSDK contract used by GameComponent:
//   submitMove(move), onMove(cb)→unsub, spectate(cb)→unsub, signalEnd,
//   playSound, leaveTable, rematch.
// `triggerMove` lets a test dispatch a server-echo event to whichever
// callback the component subscribed to.

function makeSdk() {
  let activeCb = null
  let spectateCb = null
  const sdk = {
    submitMove: vi.fn(),
    onMove: vi.fn((cb) => { activeCb = cb; return () => { activeCb = null } }),
    spectate: vi.fn((cb) => { spectateCb = cb; return () => { spectateCb = null } }),
    signalEnd: vi.fn(),
    playSound: vi.fn(),
    leaveTable: vi.fn(),
    rematch: vi.fn(),
  }
  return {
    sdk,
    fireMove(event) {
      // Use whichever callback is wired. Active player path takes priority
      // because tests subscribe both for spectator vs active scenarios.
      // Wrap in act() so React flushes the resulting state update before
      // the test's next assertion — otherwise we see stale DOM and a
      // "not wrapped in act(...)" warning in the logs.
      const cb = activeCb ?? spectateCb
      if (cb) act(() => cb(event))
    },
  }
}

function makeSession({ isSpectator = false, myMark = Y, opponentMark = R } = {}) {
  return {
    currentUserId: 'u_me',
    isSpectator,
    players: [
      { id: 'u_me',  displayName: 'Me' },
      { id: 'u_opp', displayName: 'Opp' },
    ],
    settings: {
      marks: { u_me: myMark, u_opp: opponentMark },
      myMark,
    },
  }
}

// ── 6×7 layout ────────────────────────────────────────────────────────────────

describe('C4 GameComponent — layout', () => {
  it('renders 7 column buttons + 42 cells', () => {
    const { sdk } = makeSdk()
    render(<GameComponent session={makeSession()} sdk={sdk} />)
    for (let c = 0; c < 7; c++) expect(screen.getByTestId(`c4-col-${c}`)).toBeInTheDocument()
    for (let i = 0; i < 42; i++) expect(screen.getByTestId(`c4-cell-${i}`)).toBeInTheDocument()
  })

  it('renders the status line with the current round and 0-0 score', () => {
    const { sdk } = makeSdk()
    render(<GameComponent session={makeSession()} sdk={sdk} />)
    const status = screen.getByTestId('c4-status')
    expect(status.textContent).toContain('Round 1')
    expect(status.textContent).toContain('0')
    expect(status.textContent).toContain('Your turn')
  })

  it('initialGameState exports a fresh, internally-consistent game state', () => {
    const s = initialGameState()
    expect(s.board.length).toBe(42)
    expect(s.board.every(c => c === null)).toBe(true)
    expect(s.currentTurn).toBe(Y)
    expect(s.status).toBe('playing')
    expect(s.winner).toBeNull()
    expect(s.scores).toEqual({ [Y]: 0, [R]: 0 })
    expect(s.round).toBe(1)
  })
})

// ── Player input ──────────────────────────────────────────────────────────────

describe('C4 GameComponent — active player input', () => {
  it('clicking a column submits the column index via sdk.submitMove', async () => {
    const user = userEvent.setup()
    const { sdk } = makeSdk()
    render(<GameComponent session={makeSession()} sdk={sdk} />)
    await user.click(screen.getByTestId('c4-col-3'))
    expect(sdk.submitMove).toHaveBeenCalledTimes(1)
    expect(sdk.submitMove).toHaveBeenCalledWith(3)
  })

  it('does NOT submit when it is the opponent\'s turn', async () => {
    const user = userEvent.setup()
    const { sdk, fireMove } = makeSdk()
    render(<GameComponent session={makeSession()} sdk={sdk} />)
    // Opponent (R) just moved → it's now opponent's turn for me, no wait
    // — toggle the currentTurn to R so isMyTurn is false.
    fireMove({
      move: 3,
      state: { ...initialGameState(), currentTurn: R },
    })
    await user.click(screen.getByTestId('c4-col-3'))
    expect(sdk.submitMove).not.toHaveBeenCalled()
  })

  it('does NOT submit when the column is full', async () => {
    const user = userEvent.setup()
    const { sdk, fireMove } = makeSdk()
    render(<GameComponent session={makeSession()} sdk={sdk} />)
    // Fill column 0 by handing the component a state with col 0 full and
    // Y still to move.
    let b = initialGameState().board
    for (let r = 0; r < 6; r++) {
      b = drop(b, 0, r % 2 ? R : Y).board
    }
    fireMove({
      move: 0,
      state: { ...initialGameState(), board: b, currentTurn: Y },
    })
    await user.click(screen.getByTestId('c4-col-0'))
    expect(sdk.submitMove).not.toHaveBeenCalled()
    // Column button should be disabled (UI affordance, not just no-op).
    expect(screen.getByTestId('c4-col-0')).toBeDisabled()
  })
})

// ── Move event handling ──────────────────────────────────────────────────────

describe('C4 GameComponent — server-echo move events', () => {
  it('renders the incoming board state and plays drop sound for opponent moves', () => {
    const { sdk, fireMove } = makeSdk()
    render(<GameComponent session={makeSession()} sdk={sdk} />)
    const after = { ...initialGameState() }
    after.board = drop(after.board, 3, R).board  // opponent (R) drops col 3
    after.currentTurn = Y
    after.lastMove = { row: 5, col: 3, index: indexOf(5, 3) }
    fireMove({ move: 3, state: after })
    const cell = screen.getByTestId(`c4-cell-${indexOf(5, 3)}`)
    expect(cell.getAttribute('data-mark')).toBe(R)
    expect(sdk.playSound).toHaveBeenCalledWith('drop')
  })

  it('suppresses the drop sound on echo of own move (no double beep)', async () => {
    const user = userEvent.setup()
    const { sdk, fireMove } = makeSdk()
    render(<GameComponent session={makeSession()} sdk={sdk} />)
    // Submit col 3.
    await user.click(screen.getByTestId('c4-col-3'))
    // Server echoes back the same move.
    const after = { ...initialGameState() }
    after.board = drop(after.board, 3, Y).board
    after.currentTurn = R
    after.lastMove = { row: 5, col: 3, index: indexOf(5, 3) }
    fireMove({ move: 3, state: after })
    // No drop sound for own echo.
    expect(sdk.playSound).not.toHaveBeenCalledWith('drop')
  })

  it('signals end exactly once on terminal state and plays the win sound', () => {
    const { sdk, fireMove } = makeSdk()
    render(<GameComponent session={makeSession()} sdk={sdk} />)
    // Build a position where Y just won (4 in bottom row cols 0-3).
    let b = initialGameState().board
    for (const col of [0, 1, 2, 3]) b = drop(b, col, Y).board
    const w = getWinner(b)
    const finalState = {
      board: b, currentTurn: R, status: 'finished',
      winner: w.mark, winLine: w.line,
      scores: { [Y]: 1, [R]: 0 }, round: 1,
      lastMove: { row: 5, col: 3, index: indexOf(5, 3) },
    }
    fireMove({ move: 3, state: finalState })
    expect(sdk.playSound).toHaveBeenCalledWith('win')
    expect(sdk.signalEnd).toHaveBeenCalledTimes(1)
    // Re-firing the same finished state should NOT signal again.
    fireMove({ move: 3, state: finalState })
    expect(sdk.signalEnd).toHaveBeenCalledTimes(1)
  })

  it('plays the draw sound on a draw (no winner, status=finished)', () => {
    const { sdk, fireMove } = makeSdk()
    render(<GameComponent session={makeSession()} sdk={sdk} />)
    fireMove({
      move: 0,
      state: {
        board: Array(42).fill(Y), // contrived terminal — winner=null path
        currentTurn: R, status: 'finished',
        winner: null, winLine: null,
        scores: { [Y]: 0, [R]: 0 }, round: 1,
        lastMove: { row: 0, col: 0, index: 0 },
      },
    })
    expect(sdk.playSound).toHaveBeenCalledWith('draw')
  })

  it('skips side effects on replay events (no sound, no signalEnd)', () => {
    const { sdk, fireMove } = makeSdk()
    render(<GameComponent session={makeSession()} sdk={sdk} />)
    fireMove({
      move: 3, replay: true,
      state: { ...initialGameState(), status: 'finished', winner: Y },
    })
    expect(sdk.playSound).not.toHaveBeenCalled()
    expect(sdk.signalEnd).not.toHaveBeenCalled()
  })
})

// ── Win highlight ─────────────────────────────────────────────────────────────

describe('C4 GameComponent — win highlight', () => {
  it('marks the four winning cells with data-win="1"', () => {
    const { sdk, fireMove } = makeSdk()
    render(<GameComponent session={makeSession()} sdk={sdk} />)
    let b = initialGameState().board
    for (const col of [0, 1, 2, 3]) b = drop(b, col, Y).board
    const w = getWinner(b)
    fireMove({
      move: 3,
      state: {
        board: b, currentTurn: R, status: 'finished',
        winner: w.mark, winLine: w.line,
        scores: { [Y]: 1, [R]: 0 }, round: 1,
        lastMove: { row: 5, col: 3, index: indexOf(5, 3) },
      },
    })
    for (const idx of w.line) {
      expect(screen.getByTestId(`c4-cell-${idx}`).getAttribute('data-win')).toBe('1')
    }
    // All non-winning cells stay at data-win="0".
    for (let i = 0; i < 42; i++) {
      if (!w.line.includes(i)) {
        expect(screen.getByTestId(`c4-cell-${i}`).getAttribute('data-win')).toBe('0')
      }
    }
  })
})

// ── Spectator mode ────────────────────────────────────────────────────────────

describe('C4 GameComponent — spectator mode', () => {
  it('shows the Spectating badge and disables all column buttons', async () => {
    const user = userEvent.setup()
    const { sdk } = makeSdk()
    render(<GameComponent session={makeSession({ isSpectator: true })} sdk={sdk} />)
    expect(screen.getByText('Spectating')).toBeInTheDocument()
    for (let c = 0; c < 7; c++) {
      expect(screen.getByTestId(`c4-col-${c}`)).toBeDisabled()
    }
    await user.click(screen.getByTestId('c4-col-3'))
    expect(sdk.submitMove).not.toHaveBeenCalled()
  })

  it('subscribes via sdk.spectate (not sdk.onMove) for spectators', () => {
    const { sdk } = makeSdk()
    render(<GameComponent session={makeSession({ isSpectator: true })} sdk={sdk} />)
    expect(sdk.spectate).toHaveBeenCalledTimes(1)
    expect(sdk.onMove).not.toHaveBeenCalled()
  })

  it('subscribes via sdk.onMove (not sdk.spectate) for active players', () => {
    const { sdk } = makeSdk()
    render(<GameComponent session={makeSession()} sdk={sdk} />)
    expect(sdk.onMove).toHaveBeenCalledTimes(1)
    expect(sdk.spectate).not.toHaveBeenCalled()
  })
})

// ── End-of-game actions ──────────────────────────────────────────────────────

describe('C4 GameComponent — end-of-game actions', () => {
  function fireFinishedState(fireMove, opts = {}) {
    fireMove({
      move: 3,
      state: {
        ...initialGameState(),
        status: 'finished',
        winner: opts.winner ?? Y,
        scores: { [Y]: opts.scoreY ?? 1, [R]: opts.scoreR ?? 0 },
      },
    })
  }

  it('shows Rematch + Leave when finished; clicking Rematch calls sdk.rematch', async () => {
    const user = userEvent.setup()
    const { sdk, fireMove } = makeSdk()
    render(<GameComponent session={makeSession()} sdk={sdk} />)
    fireFinishedState(fireMove)
    await user.click(screen.getByTestId('c4-rematch'))
    expect(sdk.rematch).toHaveBeenCalledTimes(1)
  })

  it('mid-game Leave button opens the forfeit dialog; confirming calls leaveTable', async () => {
    const user = userEvent.setup()
    const { sdk } = makeSdk()
    render(<GameComponent session={makeSession()} sdk={sdk} />)
    // Mid-game: Leave should open dialog (it's labeled "Forfeit" when in-progress).
    await user.click(screen.getByTestId('c4-leave'))
    expect(screen.getByTestId('c4-forfeit-dialog')).toBeInTheDocument()
    // Confirm.
    await user.click(within(screen.getByTestId('c4-forfeit-dialog')).getByText(/Forfeit and leave/i))
    expect(sdk.leaveTable).toHaveBeenCalledTimes(1)
    expect(sdk.playSound).toHaveBeenCalledWith('forfeit')
  })

  it('post-game Leave button calls leaveTable directly (no forfeit dialog)', async () => {
    const user = userEvent.setup()
    const { sdk, fireMove } = makeSdk()
    render(<GameComponent session={makeSession()} sdk={sdk} />)
    fireFinishedState(fireMove)
    await user.click(screen.getByTestId('c4-leave'))
    expect(screen.queryByTestId('c4-forfeit-dialog')).toBeNull()
    expect(sdk.leaveTable).toHaveBeenCalledTimes(1)
  })
})
