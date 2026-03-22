import { describe, it, expect, beforeEach } from 'vitest'
import {
  recordMove,
  getSummary,
  getHistogram,
  getHeatmap,
  getTotal,
  _reset,
} from '../aiMetrics.js'

beforeEach(() => _reset())

describe('aiMetrics', () => {
  it('starts empty', () => {
    expect(getTotal()).toBe(0)
    expect(getSummary()).toEqual([])
  })

  it('recordMove increments total', () => {
    recordMove({ implementation: 'minimax', difficulty: 'master', durationMs: 5, cellIndex: 4 })
    expect(getTotal()).toBe(1)
  })

  it('getSummary groups by implementation+difficulty', () => {
    recordMove({ implementation: 'minimax', difficulty: 'master', durationMs: 10, cellIndex: 0 })
    recordMove({ implementation: 'minimax', difficulty: 'master', durationMs: 20, cellIndex: 4 })
    recordMove({ implementation: 'minimax', difficulty: 'novice', durationMs: 2, cellIndex: 1 })

    const rows = getSummary()
    expect(rows).toHaveLength(2)

    const hard = rows.find((r) => r.difficulty === 'master')
    expect(hard.count).toBe(2)
    expect(hard.avgMs).toBe(15)
    expect(hard.maxMs).toBe(20)

    const easy = rows.find((r) => r.difficulty === 'novice')
    expect(easy.count).toBe(1)
    expect(easy.avgMs).toBe(2)
  })

  it('getHistogram buckets by durationMs', () => {
    recordMove({ implementation: 'minimax', difficulty: 'master', durationMs: 5, cellIndex: 0 })  // 0-10ms
    recordMove({ implementation: 'minimax', difficulty: 'master', durationMs: 30, cellIndex: 0 }) // 10-50ms
    recordMove({ implementation: 'minimax', difficulty: 'master', durationMs: 600, cellIndex: 0 }) // 500ms+

    const hist = getHistogram()
    expect(hist.find((b) => b.label === '0–10ms').count).toBe(1)
    expect(hist.find((b) => b.label === '10–50ms').count).toBe(1)
    expect(hist.find((b) => b.label === '500ms+').count).toBe(1)
  })

  it('getHistogram filters by implementation and difficulty', () => {
    recordMove({ implementation: 'minimax', difficulty: 'master', durationMs: 5, cellIndex: 0 })
    recordMove({ implementation: 'minimax', difficulty: 'novice', durationMs: 1, cellIndex: 0 })

    const hist = getHistogram('minimax', 'master')
    const total = hist.reduce((s, b) => s + b.count, 0)
    expect(total).toBe(1)
  })

  it('getHeatmap counts cell selections', () => {
    recordMove({ implementation: 'minimax', difficulty: 'master', durationMs: 5, cellIndex: 4 })
    recordMove({ implementation: 'minimax', difficulty: 'master', durationMs: 5, cellIndex: 4 })
    recordMove({ implementation: 'minimax', difficulty: 'master', durationMs: 5, cellIndex: 0 })

    const heatmap = getHeatmap()
    expect(heatmap[4].count).toBe(2)
    expect(heatmap[0].count).toBe(1)
    expect(heatmap[1].count).toBe(0)
  })

  it('getHeatmap filters by implementation and difficulty', () => {
    recordMove({ implementation: 'minimax', difficulty: 'master', durationMs: 5, cellIndex: 4 })
    recordMove({ implementation: 'minimax', difficulty: 'novice', durationMs: 1, cellIndex: 0 })

    const heatmap = getHeatmap('minimax', 'master')
    expect(heatmap[4].count).toBe(1)
    expect(heatmap[0].count).toBe(0)
  })
})
