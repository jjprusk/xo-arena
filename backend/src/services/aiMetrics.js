// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * In-memory AI metrics store.
 * Accumulates per-move records in a capped ring buffer (max 10 000 entries).
 * All aggregation happens at query time — no persistence needed for the dashboard.
 */

const MAX_ENTRIES = 10_000

/** @type {Array<{implementation:string, difficulty:string, durationMs:number, cellIndex:number, timestamp:number}>} */
const _entries = []

/** Record a single AI move. Called from the POST /ai/move handler. */
export function recordMove({ implementation, difficulty, durationMs, cellIndex }) {
  if (_entries.length >= MAX_ENTRIES) _entries.shift()
  _entries.push({ implementation, difficulty, durationMs, cellIndex, timestamp: Date.now() })
}

/** Summary scorecard: totals and averages per implementation+difficulty combo. */
export function getSummary() {
  const map = {}
  for (const e of _entries) {
    const key = `${e.implementation}::${e.difficulty}`
    if (!map[key]) map[key] = { implementation: e.implementation, difficulty: e.difficulty, count: 0, totalMs: 0, maxMs: 0 }
    map[key].count++
    map[key].totalMs += e.durationMs
    if (e.durationMs > map[key].maxMs) map[key].maxMs = e.durationMs
  }
  return Object.values(map).map((m) => ({
    ...m,
    avgMs: m.count ? Math.round(m.totalMs / m.count) : 0,
  }))
}

/** Move time histogram bucketed in ms. */
const BUCKETS = [
  { label: '0–10ms', max: 10 },
  { label: '10–50ms', max: 50 },
  { label: '50–100ms', max: 100 },
  { label: '100–200ms', max: 200 },
  { label: '200–500ms', max: 500 },
  { label: '500ms+', max: Infinity },
]

export function getHistogram(implementation, difficulty) {
  const filtered = _entries.filter(
    (e) =>
      (!implementation || e.implementation === implementation) &&
      (!difficulty || e.difficulty === difficulty),
  )
  const counts = BUCKETS.map((b) => ({ label: b.label, count: 0 }))
  for (const e of filtered) {
    const idx = BUCKETS.findIndex((b) => e.durationMs <= b.max)
    counts[idx >= 0 ? idx : counts.length - 1].count++
  }
  return counts
}

/** Cell frequency heatmap — how often each of the 9 cells is chosen. */
export function getHeatmap(implementation, difficulty) {
  const filtered = _entries.filter(
    (e) =>
      (!implementation || e.implementation === implementation) &&
      (!difficulty || e.difficulty === difficulty),
  )
  const cells = Array(9).fill(0)
  for (const e of filtered) {
    if (e.cellIndex >= 0 && e.cellIndex < 9) cells[e.cellIndex]++
  }
  return cells.map((count, index) => ({ index, count }))
}

/** Total move count. */
export function getTotal() {
  return _entries.length
}

/** Clear all data (used in tests). */
export function _reset() {
  _entries.length = 0
}
