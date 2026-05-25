// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect, vi } from 'vitest'
import { emptyBoard, MARKS, indexOf, drop } from '../logic.js'
import { meta } from '../meta.js'
import { botInterface } from '../botInterface.js'
import { deserializeState } from '../serializer.js'

const Y = MARKS.FIRST
const R = MARKS.SECOND

describe('botInterface — SDK contract surface', () => {
  it('exports every required BotInterface field', () => {
    expect(typeof botInterface.makeMove).toBe('function')
    expect(typeof botInterface.getTrainingConfig).toBe('function')
    expect(typeof botInterface.train).toBe('function')
    expect(typeof botInterface.serializeState).toBe('function')
    expect(typeof botInterface.deserializeMove).toBe('function')
    expect(Array.isArray(botInterface.personas)).toBe(true)
    expect(botInterface.personas.length).toBeGreaterThan(0)
  })

  it('personas matches meta.builtInBots exactly (single source of truth)', () => {
    expect(botInterface.personas).toBe(meta.builtInBots)
  })
})

describe('botInterface — makeMove for minimax personas', () => {
  const easyPersona = meta.builtInBots.find(p => p.id === 'minimax-easy')
  const mediumPersona = meta.builtInBots.find(p => p.id === 'minimax-medium')

  it('returns a column index 0..6 for an empty board', () => {
    const move = botInterface.makeMove(emptyBoard(), 'bot1', easyPersona, null)
    expect(Number.isInteger(move)).toBe(true)
    expect(move).toBeGreaterThanOrEqual(0)
    expect(move).toBeLessThan(7)
  })

  it('uses center on an empty board with the medium persona', () => {
    const move = botInterface.makeMove(emptyBoard(), 'bot1', mediumPersona, null)
    expect(move).toBe(3) // canonical strongest opening
  })

  it('accepts both bare-board and {board, currentTurn} state shapes', () => {
    const bare = emptyBoard()
    const wrapped = { board: bare, currentTurn: Y, marks: { 'bot1': Y } }
    const m1 = botInterface.makeMove(bare,    'bot1', mediumPersona, null)
    const m2 = botInterface.makeMove(wrapped, 'bot1', mediumPersona, null)
    expect(m1).toBe(m2)
  })

  it('returns -1 when the board is full (no legal moves)', () => {
    // Reuse the parity-broken draw board from logic tests.
    const full = `
      YYRRYYR
      RRYYRRY
      YYRRYYR
      RRYYRRY
      YYRRYYR
      RRYYRRY
    `.replace(/[^YR]/g, '').split('').map(c => c)
    expect(full.length).toBe(42)
    expect(botInterface.makeMove(full, 'bot1', mediumPersona, null)).toBe(-1)
  })

  it('throws clearly when state is missing a board', () => {
    expect(() => botInterface.makeMove({}, 'bot1', easyPersona, null)).toThrow(/missing board/)
    expect(() => botInterface.makeMove(null, 'bot1', easyPersona, null)).toThrow(/missing board/)
  })
})

describe('botInterface — makeMove fallback for ML personas without weights', () => {
  const mlPersona = { id: 'ql-untrained', name: 'Untrained', description: '', difficulty: 'medium', algorithm: 'qlearning' }

  it('returns a legal column index when no weights are supplied', () => {
    const move = botInterface.makeMove(emptyBoard(), 'bot1', mlPersona, null)
    expect(Number.isInteger(move)).toBe(true)
    expect(move).toBeGreaterThanOrEqual(0)
    expect(move).toBeLessThan(7)
  })

  it('does not throw with weights either (B4 will wire real engines)', () => {
    expect(() => botInterface.makeMove(emptyBoard(), 'bot1', mlPersona, { /* opaque */ })).not.toThrow()
  })
})

describe('botInterface — getTrainingConfig schema', () => {
  it('returns a TrainingConfig with required keys', () => {
    const cfg = botInterface.getTrainingConfig()
    expect(typeof cfg.algorithm).toBe('string')
    expect(typeof cfg.defaultEpisodes).toBe('number')
    expect(cfg.defaultEpisodes).toBeGreaterThan(0)
    expect(typeof cfg.hyperparameters).toBe('object')
  })

  it('lists every algorithm in the algorithm select', () => {
    const cfg = botInterface.getTrainingConfig()
    const opts = cfg.hyperparameters.algorithm.options.map(o => o.value)
    for (const algo of ['qlearning', 'sarsa', 'montecarlo', 'policygradient', 'dqn', 'alphazero']) {
      expect(opts).toContain(algo)
    }
  })

  it('every hyperparameter has a label and default', () => {
    const hp = botInterface.getTrainingConfig().hyperparameters
    for (const key of Object.keys(hp)) {
      expect(typeof hp[key].label).toBe('string')
      expect(hp[key].default).not.toBeUndefined()
    }
  })
})

describe('botInterface — train stub', () => {
  it('throws a clear, identifiable error pending B4 implementation', async () => {
    await expect(
      botInterface.train({ algorithm: 'qlearning', episodes: 10, params: {} }, null, vi.fn())
    ).rejects.toThrow(/not implemented yet/)
  })
})

describe('botInterface — serializeState / deserializeMove', () => {
  it('serializeState round-trips through deserializeState', () => {
    let b = emptyBoard()
    b = drop(b, 3, Y).board
    b = drop(b, 3, R).board
    const s = botInterface.serializeState({ board: b, turn: Y })
    const back = deserializeState(s)
    expect(back.board).toEqual(b)
    expect(back.turn).toBe(Y)
  })

  it('deserializeMove accepts numbers and numeric strings', () => {
    expect(botInterface.deserializeMove(3)).toBe(3)
    expect(botInterface.deserializeMove('5')).toBe(5)
    expect(botInterface.deserializeMove(0)).toBe(0)
    expect(botInterface.deserializeMove(6)).toBe(6)
  })

  it('deserializeMove throws on out-of-range or non-numeric input', () => {
    expect(() => botInterface.deserializeMove(-1)).toThrow()
    expect(() => botInterface.deserializeMove(7)).toThrow()
    expect(() => botInterface.deserializeMove(3.5)).toThrow()
    expect(() => botInterface.deserializeMove('abc')).toThrow()
    expect(() => botInterface.deserializeMove(null)).toThrow()
  })
})

describe('meta — SDK conformance', () => {
  it('declares all required GameMeta fields', () => {
    expect(meta.id).toBe('connect-four')
    expect(typeof meta.title).toBe('string')
    expect(typeof meta.description).toBe('string')
    expect(meta.minPlayers).toBe(2)
    expect(meta.maxPlayers).toBe(2)
    expect(meta.inputMode).toBe('column')
    expect(meta.layout.preferredWidth).toBe('wide')
    expect(meta.supportsBots).toBe(true)
    expect(meta.supportsTraining).toBe(true)
    expect(Array.isArray(meta.builtInBots)).toBe(true)
  })

  it('declares Connect Four-specific opt-in fields', () => {
    expect(meta.tournamentMovesElo).toBe(true)
    expect(meta.matchFormat.ranked).toBe('bo2')
    expect(meta.matchFormat.tournament).toBe('bo3')
    expect(meta.matchFormat.master).toBe('bo2')
    expect(meta.masterStrategy).toBe('solver')
  })

  it('ships 4 built-in minimax tiers including a master that is off-ladder', () => {
    expect(meta.builtInBots.length).toBe(4)
    const ids = meta.builtInBots.map(b => b.id)
    expect(ids).toContain('minimax-easy')
    expect(ids).toContain('minimax-medium')
    expect(ids).toContain('minimax-hard')
    expect(ids).toContain('minimax-master')
    const master = meta.builtInBots.find(b => b.difficulty === 'master')
    expect(master.offLadder).toBe(true)
  })
})
