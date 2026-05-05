#!/usr/bin/env node
// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * XO Arena — Perf Trend summarizer
 *
 * Reads every JSON in perf/baselines/, groups files into "runs" (same env,
 * within 15 min of each other), extracts key metrics, and writes a markdown
 * trend table to doc/Performance_Trend.md. Each row shows the metric value
 * plus a Δ vs. the previous same-env run; rows where any p95 regressed by
 * >10% are flagged.
 *
 * Idempotent — overwrites Performance_Trend.md every run. Wire into the
 * tail of /stage and /promote (after rebaseline) to keep the trend doc
 * fresh on every staging cut and prod promote.
 *
 * Usage:
 *   node perf/perf-summarize.js
 *   node perf/perf-summarize.js --max-rows=30      # cap table size
 *   node perf/perf-summarize.js --since=2026-05-01 # only after this date
 *
 * Output:
 *   doc/Performance_Trend.md   (overwritten)
 *
 * The PDF companion is regenerated separately by the caller (skill step):
 *   pandoc Performance_Trend.md -o Performance_Trend.pdf --pdf-engine=xelatex …
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const args      = process.argv.slice(2)
const MAX_ROWS  = parseInt(args.find(a => a.startsWith('--max-rows='))?.split('=')[1] ?? '40') || 40
const SINCE     = args.find(a => a.startsWith('--since='))?.split('=')[1] ?? null

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BL_DIR    = join(REPO_ROOT, 'perf', 'baselines')
const CHANGELOG = join(REPO_ROOT, 'landing', 'public', 'changelog.json')
const OUT_PATH  = join(REPO_ROOT, 'doc', 'Performance_Trend.md')

// 15-minute window — perf-rebaseline.sh runs all 7 scripts in ~9-10 minutes
// against prod. Any cluster of files within this window from the same env
// is treated as a single "run".
const RUN_WINDOW_MS = 15 * 60 * 1000

// Metric regression threshold — flag if a p95 grew by >10% vs. previous
// same-env run. Choose 10% to filter the typical p95 noise band; tighten
// to 5% later when RUM data lets us compute real envelope.
const REGRESSION_THRESHOLD_PCT = 10

// ── Parse all baseline files ─────────────────────────────────────────────────
function parseFilename(f) {
  // <kind>-<env>-<isoTimestamp-with-dashes>.json
  // The kind itself can contain dashes (e.g. "backend-p95", "bundle-composition"),
  // so we anchor on the env token (local|staging|prod).
  const m = f.match(/^(.+?)-(local|staging|prod)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.json$/)
  if (!m) return null
  const [, kind, env, rawTs] = m
  // Convert "2026-05-05T01-30-31-342Z" → "2026-05-05T01:30:31.342Z"
  const iso = rawTs.replace(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    '$1T$2:$3:$4.$5Z',
  )
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return null
  return { file: f, kind, env, ts, iso }
}

function loadChangelog() {
  if (!existsSync(CHANGELOG)) return []
  try {
    const arr = JSON.parse(readFileSync(CHANGELOG, 'utf8'))
    return Array.isArray(arr) ? arr.filter(e => e.version && e.date) : []
  } catch {
    return []
  }
}

function versionForDate(changelog, dateStr) {
  // changelog is sorted newest first; return the first entry on or before dateStr.
  for (const entry of changelog) if (entry.date <= dateStr) return entry.version
  return null
}

function readJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null }
}

// ── Extract metrics for a single run ─────────────────────────────────────────
function metricsForRun(run) {
  const m = { env: run.env, ts: run.startTs, date: new Date(run.startTs).toISOString().slice(0, 10) }
  const byKind = Object.fromEntries(run.files.map(f => [f.kind, f]))

  if (byKind['sse-rtt']) {
    const j = readJson(join(BL_DIR, byKind['sse-rtt'].file))
    if (j?.summary?.playerEvent) {
      m.sse_p50 = j.summary.playerEvent.p50
      m.sse_p95 = j.summary.playerEvent.p95
    }
    m.sse_fail = j?.failures ?? null
    m.sse_runs = j?.runs ?? null
  }

  if (byKind['perf']) {
    const j = readJson(join(BL_DIR, byKind['perf'].file))
    const homeMob = j?.results?.find(r => r.route === 'Home' && r.device === 'mobile' && r.context === 'cold-anon')
    const homeDsk = j?.results?.find(r => r.route === 'Home' && r.device === 'desktop' && r.context === 'cold-anon')
    if (homeMob) {
      m.mob_ready = homeMob.stats.ready_p50
      m.mob_lcp   = homeMob.stats.lcp_p50
      m.img_kb    = homeMob.stats.img_kb
      m.js_kb     = homeMob.stats.js_kb
    }
    if (homeDsk) m.dsk_ready = homeDsk.stats.ready_p50
  }

  if (byKind['backend-p95']) {
    const j = readJson(join(BL_DIR, byKind['backend-p95'].file))
    if (Array.isArray(j?.results) && j.results.length) {
      const worst = j.results.reduce((a, r) => Math.max(a, r.stats?.p95 ?? 0), 0)
      m.backend_worst_p95 = worst || null
    }
  }

  if (byKind['longtasks']) {
    const j = readJson(join(BL_DIR, byKind['longtasks'].file))
    const homeMob = j?.results?.find(r => r.route === 'Home' && r.device === 'mobile')
    m.mob_tbt = homeMob?.stats?.tbt?.p50 ?? null
  }

  if (byKind['inp']) {
    const j = readJson(join(BL_DIR, byKind['inp'].file))
    if (Array.isArray(j?.results)) {
      const samples = j.results
        .map(r => r.stats?.inp_p50)
        .filter(v => v != null && v > 0)
      m.inp_max = samples.length ? Math.max(...samples) : null
    }
  }

  m.kinds = Object.keys(byKind).sort()
  return m
}

// ── Δ vs previous same-env run ───────────────────────────────────────────────
function computeDeltas(rows) {
  // rows are sorted newest first; "prev" for a row means the next row down
  // with the same env.
  for (let i = 0; i < rows.length; i++) {
    const cur  = rows[i]
    const prev = rows.slice(i + 1).find(r => r.env === cur.env)
    cur.delta = {}
    cur.regressions = []
    if (!prev) continue
    const fields = [
      { k: 'mob_ready',         label: 'mob Ready' },
      { k: 'dsk_ready',         label: 'dsk Ready' },
      { k: 'mob_lcp',           label: 'mob LCP'   },
      { k: 'sse_p50',           label: 'SSE p50'   },
      { k: 'sse_p95',           label: 'SSE p95'   },
      { k: 'mob_tbt',           label: 'mob TBT'   },
      { k: 'backend_worst_p95', label: 'backend p95' },
      { k: 'img_kb',            label: 'img KB'    },
      { k: 'js_kb',             label: 'js KB'     },
    ]
    for (const { k, label } of fields) {
      const a = cur[k], b = prev[k]
      if (a == null || b == null || b === 0) continue
      const pct = ((a - b) / b) * 100
      cur.delta[k] = pct
      // Regression: bigger is worse for everything we track here.
      if (pct > REGRESSION_THRESHOLD_PCT) {
        cur.regressions.push({ k, label, prev: b, cur: a, pct })
      }
    }
  }
}

// ── Format helpers ───────────────────────────────────────────────────────────
function fmtDelta(pct, { suppressWarn = false } = {}) {
  if (pct == null || !isFinite(pct)) return ''
  const sign = pct >= 0 ? '+' : ''
  const arrow = pct > REGRESSION_THRESHOLD_PCT && !suppressWarn ? ' ⚠️'
              : pct < -5 ? ' ↓'
              : ''
  return `${sign}${pct.toFixed(0)}%${arrow}`
}
function v(x, suffix = 'ms') {
  if (x == null) return '—'
  return `${x}${suffix}`
}

// ── Main ─────────────────────────────────────────────────────────────────────
function main() {
  const allFiles = readdirSync(BL_DIR)
    .map(parseFilename)
    .filter(Boolean)
    .filter(f => !SINCE || f.iso.slice(0, 10) >= SINCE)
    .sort((a, b) => a.ts - b.ts) // ascending

  // Cluster into runs.
  const runs = []
  let cur = null
  for (const f of allFiles) {
    if (!cur || cur.env !== f.env || (f.ts - cur.endTs) > RUN_WINDOW_MS) {
      cur = { env: f.env, startTs: f.ts, endTs: f.ts, files: [f] }
      runs.push(cur)
    } else {
      cur.files.push(f)
      cur.endTs = f.ts
    }
  }

  // Bundle composition is local-only and runs separately during the
  // rebaseline against any env (it measures the dist/ build, same regardless
  // of TARGET). Drop runs that are *only* the bundle file — they aren't
  // observations of an environment, just artifacts of the local build.
  const realRuns = runs.filter(r => r.files.some(f => f.kind !== 'bundle-composition'))

  // Only keep "ceremony" runs — full /stage- or /promote-style runs that
  // include at least 5 of the 7 baseline scripts. Ad-hoc single-script
  // spot-checks during debugging would otherwise pollute the trend.
  const FULL_RUN_MIN_KINDS = 5
  const rows = realRuns
    .map(metricsForRun)
    .filter(m => m.env !== 'local')
    .filter(m => (m.kinds?.length ?? 0) >= FULL_RUN_MIN_KINDS)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, MAX_ROWS)

  computeDeltas(rows)

  // Suppress false-positive SSE regressions when the previous run was
  // mostly broken — pre-fix runs with high failure counts compute p50/p95
  // over a tiny sample and look artificially fast. The "regression" is
  // really recovery to a representative baseline.
  for (let i = 0; i < rows.length; i++) {
    const cur  = rows[i]
    const prev = rows.slice(i + 1).find(r => r.env === cur.env)
    if (!prev) continue
    const prevWasBroken = prev.sse_runs && prev.sse_fail != null
      && prev.sse_fail / prev.sse_runs > 0.25
    const curIsHealthy = cur.sse_runs && cur.sse_fail != null
      && cur.sse_fail / cur.sse_runs <= 0.05
    if (prevWasBroken && curIsHealthy) {
      cur.regressions = cur.regressions.filter(x => !['sse_p50', 'sse_p95'].includes(x.k))
      cur.sseRecovery = { prevFail: prev.sse_fail, prevRuns: prev.sse_runs }
    }
  }

  const changelog = loadChangelog()
  for (const r of rows) r.version = versionForDate(changelog, r.date)

  // ── Render ─────────────────────────────────────────────────────────────────
  const out = []
  out.push('---')
  out.push('title: XO Arena — Performance Trend')
  out.push('subtitle: Auto-regenerated after every baseline run')
  out.push('---')
  out.push('')
  out.push('# XO Arena — Performance Trend')
  out.push('')
  out.push(`Generated: ${new Date().toISOString()}`)
  out.push('')
  out.push('Auto-regenerated by `perf/perf-summarize.js` from every JSON in')
  out.push('`perf/baselines/`. Wire into the tail of `/stage` and `/promote`')
  out.push('to keep this fresh on every staging cut + prod promote.')
  out.push('')
  out.push('## Targets (from `Performance_Plan_v2.md`)')
  out.push('')
  out.push('- Mobile cold-anon Ready p50: **≤ 2000 ms**')
  out.push('- Desktop cold-anon Ready p50: **≤ 1000 ms**')
  out.push('- Mobile LCP p50: **≤ 1500 ms**')
  out.push('- SSE round-trip (POST move → SSE state) p50: **≤ 300 ms**')
  out.push('- Backend endpoint p95 (worst of measured): **≤ 200 ms**')
  out.push('- Mobile TBT p50: **≤ 100 ms**')
  out.push('')
  out.push('Regressions flagged ⚠️ when a p95 grew >' + REGRESSION_THRESHOLD_PCT + '% vs the previous same-env run.')
  out.push('')

  // ── Cold-page table ───────────────────────────────────────────────────────
  out.push('## Cold-page — Home, mobile + desktop')
  out.push('')
  out.push('| Date       | Version             | Env  | mob Ready  | dsk Ready  | mob LCP    | mob TBT  | img KB | js KB | regressions |')
  out.push('|------------|---------------------|------|-----------:|-----------:|-----------:|---------:|------:|------:|:------------|')
  for (const r of rows) {
    const reg = r.regressions
      .filter(x => ['mob_ready','dsk_ready','mob_lcp','mob_tbt','img_kb','js_kb'].includes(x.k))
      .map(x => `${x.label} +${x.pct.toFixed(0)}%`)
      .join(', ') || '—'
    out.push([
      `| ${r.date}`,
      `${(r.version ?? '—').padEnd(19)}`,
      `${r.env.padEnd(4)}`,
      `${v(r.mob_ready)} ${fmtDelta(r.delta.mob_ready)}`.trim(),
      `${v(r.dsk_ready)} ${fmtDelta(r.delta.dsk_ready)}`.trim(),
      `${v(r.mob_lcp)}   ${fmtDelta(r.delta.mob_lcp)}`.trim(),
      `${v(r.mob_tbt)} ${fmtDelta(r.delta.mob_tbt)}`.trim(),
      `${v(r.img_kb, '')} ${fmtDelta(r.delta.img_kb)}`.trim(),
      `${v(r.js_kb, '')} ${fmtDelta(r.delta.js_kb)}`.trim(),
      `${reg} |`,
    ].join(' | '))
  }
  out.push('')

  // ── Realtime + backend table ──────────────────────────────────────────────
  out.push('## Realtime + backend')
  out.push('')
  out.push('| Date       | Version             | Env  | SSE p50   | SSE p95    | SSE fail | backend worst p95 | INP max p50 | note |')
  out.push('|------------|---------------------|------|----------:|-----------:|---------:|------------------:|------------:|:-----|')
  for (const r of rows) {
    const failStr = r.sse_fail != null ? `${r.sse_fail}/${r.sse_runs ?? '?'}` : '—'
    const sseRecovery = !!r.sseRecovery
    const note = sseRecovery
      ? `recovery from ${r.sseRecovery.prevFail}/${r.sseRecovery.prevRuns} broken`
      : '—'
    out.push([
      `| ${r.date}`,
      `${(r.version ?? '—').padEnd(19)}`,
      `${r.env.padEnd(4)}`,
      `${v(r.sse_p50)} ${fmtDelta(r.delta.sse_p50, { suppressWarn: sseRecovery })}`.trim(),
      `${v(r.sse_p95)} ${fmtDelta(r.delta.sse_p95, { suppressWarn: sseRecovery })}`.trim(),
      `${failStr.padStart(8)}`,
      `${v(r.backend_worst_p95)} ${fmtDelta(r.delta.backend_worst_p95)}`.trim(),
      `${v(r.inp_max)}`,
      `${note} |`,
    ].join(' | '))
  }
  out.push('')

  // ── Regressions section ───────────────────────────────────────────────────
  const flaggedRows = rows.filter(r => r.regressions.length > 0)
  out.push('## Regressions detected')
  out.push('')
  if (flaggedRows.length === 0) {
    out.push('None in the visible window. ✓')
  } else {
    for (const r of flaggedRows) {
      out.push(`### ${r.date} — ${r.env} (v${r.version ?? '?'})`)
      out.push('')
      for (const x of r.regressions) {
        out.push(`- **${x.label}** ${x.prev} → ${x.cur} (+${x.pct.toFixed(0)}%)`)
      }
      out.push('')
    }
  }
  out.push('')

  // ── Coverage / freshness ──────────────────────────────────────────────────
  out.push('## Coverage')
  out.push('')
  out.push('| Run start (UTC)   | Env  | Scripts present                                  |')
  out.push('|-------------------|------|--------------------------------------------------|')
  for (const r of rows.slice(0, 12)) {
    const ts = new Date(r.ts).toISOString().slice(0, 16).replace('T', ' ')
    out.push(`| ${ts} | ${r.env.padEnd(4)} | ${r.kinds.join(', ')} |`)
  }
  out.push('')

  writeFileSync(OUT_PATH, out.join('\n'))
  console.log(`✓ wrote ${OUT_PATH.replace(REPO_ROOT + '/', '')}  (${rows.length} runs)`)
  if (flaggedRows.length) {
    console.log(`⚠  ${flaggedRows.length} run(s) with regressions — see "Regressions detected"`)
  }
}

main()
