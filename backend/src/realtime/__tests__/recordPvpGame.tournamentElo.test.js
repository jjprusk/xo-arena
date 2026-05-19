// A3a — tournament BO3 match-level ELO is opt-in via the game's SDK meta
// (`tournamentMovesElo`), mirrored into `TOURNAMENT_ELO_GAME_IDS`.
//
// • Flag off (TTT today): no ELO call on series completion — behaviour
//   preserved from pre-A3a.
// • Flag on (Connect 4 future): one `updateBothElosAfterMatch` call per
//   series, with W/D/L aggregated from Game rows (participant-keyed) — not
//   from `xWins/oWins` (mark-keyed across swapping colors).
//
// We mock the world around `recordPvpGame` and inspect the eloService call.

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../services/userService.js', () => ({
  createGame: vi.fn().mockResolvedValue({ id: 'game-created' }),
}))

vi.mock('../../services/creditService.js', () => ({
  recordGameCompletion: vi.fn().mockResolvedValue(undefined),
}))

const { mockUpdateBothElosAfterMatch, mockUpdatePlayersEloAfterPvP } = vi.hoisted(() => ({
  mockUpdateBothElosAfterMatch: vi.fn().mockResolvedValue(undefined),
  mockUpdatePlayersEloAfterPvP: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../services/eloService.js', () => ({
  updateBothElosAfterMatch: mockUpdateBothElosAfterMatch,
  updatePlayersEloAfterPvP: mockUpdatePlayersEloAfterPvP,
}))

vi.mock('../../services/rankedMatchOrchestrator.js', () => ({
  advanceMatchAfterGame: vi.fn(),
}))

vi.mock('../../services/tableFlowService.js', () => ({
  rematchRankedTableInPlace: vi.fn(),
}))

vi.mock('../../services/journeyService.js', () => ({
  completeStep: vi.fn().mockResolvedValue(undefined),
}))

const { mockDeletePendingPvpMatch } = vi.hoisted(() => ({
  mockDeletePendingPvpMatch: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../lib/tournamentBridge.js', () => ({
  deletePendingPvpMatch: mockDeletePendingPvpMatch,
}))

vi.mock('./tablePresence.js', () => ({
  removeAllWatchersForTable: vi.fn(),
  getPresence: vi.fn(() => ({ userIds: [] })),
}))

vi.mock('../../services/tablePresenceService.js', () => ({
  dualEmitPresence: vi.fn(),
}))

vi.mock('../../lib/eventStream.js', () => ({
  appendToStream: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../lib/tableReleased.js', () => ({
  dispatchTableReleased: vi.fn(),
  TABLE_RELEASED_REASONS: {},
}))

vi.mock('../../lib/tableLabel.js', () => ({
  formatTableLabel: vi.fn(() => 'Table'),
}))

const {
  mockUserFindUnique,
  mockGameFindMany,
  mockTournamentMatchUpdate,
  mockTournamentMatchFindUnique,
  mockTournamentParticipantFindUnique,
} = vi.hoisted(() => ({
  mockUserFindUnique:                  vi.fn(),
  mockGameFindMany:                    vi.fn().mockResolvedValue([]),
  mockTournamentMatchUpdate:           vi.fn().mockResolvedValue({}),
  mockTournamentMatchFindUnique:       vi.fn().mockResolvedValue({ participant1Id: 'p-host', participant2Id: 'p-guest' }),
  mockTournamentParticipantFindUnique: vi.fn().mockResolvedValue(null),
}))
vi.mock('../../lib/db.js', () => ({
  default: {
    user:                  { findUnique: mockUserFindUnique },
    game:                  { findMany: mockGameFindMany },
    tournamentMatch:       { update: mockTournamentMatchUpdate, findUnique: mockTournamentMatchFindUnique },
    tournamentParticipant: { findUnique: mockTournamentParticipantFindUnique },
  },
}))

// Fetch is called for completeTournamentMatch — stub a 200 OK.
global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })

// Mutable mirror of TOURNAMENT_ELO_GAME_IDS so tests can flip the flag
// without monkey-patching the constants module.
const { mockTournamentEloSet } = vi.hoisted(() => ({
  mockTournamentEloSet: new Set(),
}))
vi.mock('../../constants/games.js', () => ({
  GAME_IDS: { TIC_TAC_TOE: 'tic-tac-toe', CONNECT_FOUR: 'connect-four' },
  TOURNAMENT_ELO_GAME_IDS: mockTournamentEloSet,
  tournamentMovesElo: (gameId) => mockTournamentEloSet.has(gameId),
}))

const { recordPvpGame } = await import('../socketHandler.js')

const HOST_BA = 'host-ba-id'
const GUEST_BA = 'guest-ba-id'
const HOST_DOMAIN = 'host-domain-id'
const GUEST_DOMAIN = 'guest-domain-id'

beforeEach(() => {
  vi.clearAllMocks()
  mockTournamentEloSet.clear()
  mockUserFindUnique.mockImplementation(async ({ where }) => {
    if (where.betterAuthId === HOST_BA)  return { id: HOST_DOMAIN }
    if (where.betterAuthId === GUEST_BA) return { id: GUEST_DOMAIN }
    return null
  })
  // Default: host is participant1. Tests that need the inverted orientation
  // override this in-test.
  mockTournamentMatchFindUnique.mockResolvedValue({
    participant1Id: 'p-host',
    participant2Id: 'p-guest',
  })
  mockTournamentParticipantFindUnique.mockImplementation(async ({ where }) => {
    if (where.id === 'p-host')  return { userId: HOST_DOMAIN }
    if (where.id === 'p-guest') return { userId: GUEST_DOMAIN }
    return null
  })
})

// Build a Table that looks like a just-finished tournament BO3 series
// (final game finishes with X winning, so totalMoves > 0). Series score
// passed in as { xWins, oWins } reflects the mark-aggregated totals.
function makeTournamentTable({ gameId, xWins, oWins, finalGameRound, finalMarks }) {
  return {
    id:                'tbl-tournament',
    gameId,
    isHvb:             false,
    tournamentMatchId: 'tm-1',
    tournamentId:      'tournament-1',
    bestOfN:           3,
    matchId:           null,
    createdAt:         new Date('2026-05-19T00:00:00Z'),
    updatedAt:         new Date('2026-05-19T00:30:00Z'),
    seats: [
      { userId: HOST_BA,  status: 'occupied' },
      { userId: GUEST_BA, status: 'occupied' },
    ],
    previewState: {
      // Some non-empty board so recordPvpGame doesn't early-return.
      board:    ['X', null, null, null, 'X', null, null, null, 'X'],
      marks:    finalMarks,
      winner:   'X',
      scores:   { X: xWins, O: oWins },
      round:    finalGameRound,
    },
  }
}

describe('recordPvpGame — tournament BO3 ELO (A3a, flag-gated)', () => {
  it('flag off (TTT today): does NOT call updateBothElosAfterMatch', async () => {
    // TTT not in the set → flag false.
    const table = makeTournamentTable({
      gameId:         'tic-tac-toe',
      xWins:          2,
      oWins:          1,
      finalGameRound: 3,
      finalMarks:     { [HOST_BA]: 'X', [GUEST_BA]: 'O' },
    })

    await recordPvpGame(table)

    expect(mockUpdateBothElosAfterMatch).not.toHaveBeenCalled()
    // And the casual-PvP ELO call must also stay skipped for tournament rooms.
    expect(mockUpdatePlayersEloAfterPvP).not.toHaveBeenCalled()
  })

  it('flag on: calls updateBothElosAfterMatch once with participant-keyed W/D/L', async () => {
    mockTournamentEloSet.add('connect-four')

    // BO3 series: host won 2, guest won 1, no draws. Marks swapped each game
    // so X/O totals don't track player identity — Game.winnerId does.
    mockGameFindMany.mockResolvedValue([
      { winnerId: HOST_DOMAIN },
      { winnerId: GUEST_DOMAIN },
      { winnerId: HOST_DOMAIN },
    ])

    const table = makeTournamentTable({
      gameId:         'connect-four',
      xWins:          1,   // mark-aggregated; deliberately != hostWins
      oWins:          2,
      finalGameRound: 3,
      finalMarks:     { [HOST_BA]: 'O', [GUEST_BA]: 'X' },
    })

    await recordPvpGame(table)

    expect(mockUpdateBothElosAfterMatch).toHaveBeenCalledTimes(1)
    const call = mockUpdateBothElosAfterMatch.mock.calls[0][0]
    expect(call).toMatchObject({
      player1Id: HOST_DOMAIN,
      player2Id: GUEST_DOMAIN,
      p1Wins:    2,
      p2Wins:    1,
      drawGames: 0,
      isP2Bot:   false,
    })
  })

  it('flag on with a draw in the series: counts it as a draw, not a loss', async () => {
    mockTournamentEloSet.add('connect-four')

    // 1-1-1 mythical scenario: 1 host win, 1 guest win, 1 draw.
    mockGameFindMany.mockResolvedValue([
      { winnerId: HOST_DOMAIN },
      { winnerId: GUEST_DOMAIN },
      { winnerId: null },
    ])

    const table = makeTournamentTable({
      gameId:         'connect-four',
      xWins:          1,
      oWins:          1,
      finalGameRound: 3,
      finalMarks:     { [HOST_BA]: 'X', [GUEST_BA]: 'O' },
    })

    await recordPvpGame(table)

    expect(mockUpdateBothElosAfterMatch).toHaveBeenCalledTimes(1)
    expect(mockUpdateBothElosAfterMatch.mock.calls[0][0]).toMatchObject({
      p1Wins:    1,
      p2Wins:    1,
      drawGames: 1,
    })
  })

  it('flag on but HvB tournament: skips ELO (bot-vs-human tournament ELO is out of scope)', async () => {
    mockTournamentEloSet.add('connect-four')
    const table = makeTournamentTable({
      gameId:         'connect-four',
      xWins:          2,
      oWins:          1,
      finalGameRound: 3,
      finalMarks:     { [HOST_BA]: 'X', [GUEST_BA]: 'O' },
    })
    table.isHvb = true

    await recordPvpGame(table)

    expect(mockUpdateBothElosAfterMatch).not.toHaveBeenCalled()
  })
})

// ── A3a.1.5: series-winner mark-vs-participant attribution ─────────────────
// The pre-A3a.1.5 code stored TournamentMatch.p1Wins=xWins and decided the
// series winner from xWins-vs-oWins. Both are wrong when colors swap, which
// they always do in BO3 (game 1: seat1=X, game 2: seat1=O, game 3: random).
// This block fixes attribution: aggregate per-game `winnerId` from Game
// rows, map host/guest → participant1/participant2 by reading the
// TournamentMatch row, and persist participant-keyed totals.

describe('recordPvpGame — tournament BO3 series-winner attribution (A3a.1.5)', () => {
  it('host swept 2-0 with colors swapping: persists p1Wins=2, p2Wins=0, winner=p-host', async () => {
    // Host won game 1 as X, host won game 2 as O. Mark-aggregated would
    // say xWins=1, oWins=1 (a wrong tie). Participant-aggregated is 2-0.
    mockGameFindMany.mockResolvedValue([
      { winnerId: HOST_DOMAIN },
      { winnerId: HOST_DOMAIN },
    ])
    const table = makeTournamentTable({
      gameId:         'tic-tac-toe',
      xWins:          1,
      oWins:          1,
      finalGameRound: 2,
      finalMarks:     { [HOST_BA]: 'O', [GUEST_BA]: 'X' },
    })
    table.bestOfN = 2  // sweep ends at game 2 for BO2-style tournament test

    await recordPvpGame(table)

    expect(global.fetch).toHaveBeenCalledTimes(1)
    const fetchBody = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(fetchBody).toMatchObject({
      p1Wins:    2,
      p2Wins:    0,
      drawGames: 0,
      winnerId:  'p-host',
    })
  })

  it('guest swept 2-0 when guest is participant1: stores p1Wins=2 in participant1 slot', async () => {
    // Inverted orientation: guest is participant1, host is participant2.
    mockTournamentMatchFindUnique.mockResolvedValue({
      participant1Id: 'p-guest',
      participant2Id: 'p-host',
    })
    mockGameFindMany.mockResolvedValue([
      { winnerId: GUEST_DOMAIN },
      { winnerId: GUEST_DOMAIN },
    ])
    const table = makeTournamentTable({
      gameId:         'tic-tac-toe',
      xWins:          1,
      oWins:          1,
      finalGameRound: 2,
      finalMarks:     { [HOST_BA]: 'X', [GUEST_BA]: 'O' },
    })
    table.bestOfN = 2

    await recordPvpGame(table)

    const fetchBody = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(fetchBody).toMatchObject({
      p1Wins:    2,           // guest is participant1, guest swept
      p2Wins:    0,
      winnerId:  'p-guest',
    })
  })

  it('mid-series: persists participant-keyed totals on TournamentMatch row', async () => {
    // BO3 mid-series snapshot after game 2: host won game 1 as X, guest
    // won game 2 as X (host was O game 2). Mark-aggregated: xWins=2, oWins=0.
    // Participant-aggregated: hostWins=1, guestWins=1.
    mockGameFindMany.mockResolvedValue([
      { winnerId: HOST_DOMAIN },
      { winnerId: GUEST_DOMAIN },
    ])
    const table = makeTournamentTable({
      gameId:         'tic-tac-toe',
      xWins:          2,
      oWins:          0,
      finalGameRound: 2,
      finalMarks:     { [HOST_BA]: 'O', [GUEST_BA]: 'X' },
    })
    table.bestOfN = 3  // not done yet — only 2 of 3 games played

    await recordPvpGame(table)

    // Series isn't done — should hit the mid-series persist path.
    expect(mockTournamentMatchUpdate).toHaveBeenCalledTimes(1)
    const updateCall = mockTournamentMatchUpdate.mock.calls[0][0]
    expect(updateCall.data).toMatchObject({
      p1Wins:    1,           // host is participant1
      p2Wins:    1,
      drawGames: 0,
      status:    'IN_PROGRESS',
    })
    // Series-complete should NOT fire.
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('all-draw BO3: ties default to host as series winner (preserves pre-A3a.1.5 fallback)', async () => {
    // 0-0-0 in wins, 3 draws. With max games reached + no majority, fall
    // back to host (pre-A3a.1.5 picked X = seat0; we preserve seat0 = host).
    mockGameFindMany.mockResolvedValue([
      { winnerId: null },
      { winnerId: null },
      { winnerId: null },
    ])
    const table = makeTournamentTable({
      gameId:         'tic-tac-toe',
      xWins:          0,
      oWins:          0,
      finalGameRound: 3,
      finalMarks:     { [HOST_BA]: 'X', [GUEST_BA]: 'O' },
    })

    await recordPvpGame(table)

    const fetchBody = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(fetchBody).toMatchObject({
      p1Wins:    0,
      p2Wins:    0,
      drawGames: 3,
      winnerId:  'p-host',
    })
  })
})
