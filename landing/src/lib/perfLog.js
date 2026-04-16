// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Opt-in perf logger for /play load investigations.
 *
 * Enabled when the URL contains `?perf=1` (or `&perf=1`). Stays completely
 * dormant otherwise — a single short-circuit check and no console noise.
 *
 * Usage at a measurement point:
 *   import { perfMark } from '../lib/perfLog.js'
 *   perfMark('AppLayout:mount')
 *
 * Every mark logs `<elapsed ms since first mark> <label>` so the console is
 * a clean waterfall without timestamps to parse.
 */

let _enabled = null            // lazy-resolved once per session
let _last = null               // previous mark time, for deltas
const _marks = []              // ordered log for summary dump

// Anchor to navigation start (performance.timeOrigin) so "total ms" means
// "time since the browser started loading this page" — that includes Vite's
// dev transforms on the module graph, HTML fetch, etc., not just JS runtime.

function enabled() {
  if (_enabled !== null) return _enabled
  try {
    _enabled = /\bperf=1\b/.test(window.location.search)
  } catch { _enabled = false }
  return _enabled
}

export function perfMark(label, extra) {
  if (!enabled()) return
  const now = performance.now()          // ms since performance.timeOrigin ≈ navigationStart
  const total = Math.round(now)
  const delta = _last === null ? total : Math.round(now - _last)
  _last = now
  _marks.push({ label, total, delta, extra })
  // Tab-separated so copy-paste into a sheet is easy.
  // eslint-disable-next-line no-console
  console.log(`[perf] +${String(delta).padStart(5)}ms\t${String(total).padStart(5)}ms\t${label}`, extra ?? '')
}

/**
 * Dump a single, easy-to-copy summary of every mark so far.
 * Prints as ONE console.log call — click once in the console, select-all,
 * copy. Also stashes the text on `window.__perfSummary` for copy via:
 *   copy(window.__perfSummary)
 * run in the DevTools console.
 */
export function perfDumpSummary(label = 'summary') {
  if (!enabled()) return
  const lines = _marks.map(m =>
    `+${String(m.delta).padStart(5)}ms  ${String(m.total).padStart(5)}ms  ${m.label}${m.extra ? ' ' + JSON.stringify(m.extra) : ''}`
  )
  const summary = `=== perf ${label} (${_marks.length} marks) ===\n` + lines.join('\n') + '\n=== end ==='
  try { window.__perfSummary = summary } catch {}
  // eslint-disable-next-line no-console
  console.log(summary)
}

/**
 * Convenience — wrap a promise and mark completion once it resolves.
 */
export async function perfTrace(label, promise) {
  if (!enabled()) return promise
  const t = performance.now()
  try {
    const result = await promise
    perfMark(`${label}:ok`, `(${Math.round(performance.now() - t)}ms)`)
    return result
  } catch (err) {
    perfMark(`${label}:err`, err?.message)
    throw err
  }
}
