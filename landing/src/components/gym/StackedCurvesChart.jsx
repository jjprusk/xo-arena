// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * A3b.7 — stacked W/D/L visualization for multi-curve training eval.
 *
 * One stacked-area chart per opponent curve (`primary`, `easy`,
 * `medium`, `master`). Each chart shows wins / draws / losses as a
 * 100%-stacked area over training episode — so the model's progress
 * against that specific opponent is visible at a glance, and the
 * three curves are visually comparable on the same y-axis.
 *
 * Saturation fade: when a curve's last 3 eval points are all 100%
 * wins, the chart card dims to opacity 0.4 and shows a "(saturated)"
 * badge. Hover/legend remain fully readable. The intent is to fade
 * solved opponents (e.g., Easy at ep 800) so the user's attention
 * stays on curves that are still moving.
 *
 * Data shape (from GET /ml/sessions/:id/metrics):
 *   { metrics: [{ episodeNum, opponentLabel, wins, draws, losses, asFirstMover }] }
 *
 * No curve renders until ≥2 eval points exist for it — a single point
 * doesn't tell a story and recharts can't draw a one-point area.
 */
import React, { useEffect, useState, useMemo } from 'react'
import {
  AreaChart, Area,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts'
import { api } from '../../lib/api.js'
import { ChartPanel, tooltipStyle } from './gymShared.jsx'

// Display order + labels for opponent curves. Anything not in this list
// (future labels, typos) renders at the end in insertion order.
const CURVE_ORDER = ['primary', 'easy', 'medium', 'master']
const CURVE_LABEL = {
  primary: 'vs Primary opponent',
  easy:    'vs Easy',
  medium:  'vs Medium',
  master:  'vs Master',
}

// Last N consecutive eval points all at 100% wins → saturated.
// Three is enough to suppress single-point flukes but tight enough
// that a 5000-episode session with eval every 1000 reaches it before
// the user has to scroll past the chart.
const SATURATION_WINDOW = 3

function groupByLabel(metrics) {
  const groups = new Map()
  for (const m of metrics ?? []) {
    if (!groups.has(m.opponentLabel)) groups.set(m.opponentLabel, [])
    groups.get(m.opponentLabel).push(m)
  }
  // Sort the inner arrays by episode — defensive even though the API
  // already orders ascending, because metrics arrive incrementally
  // during live training and a late-arriving point would otherwise
  // render out of order.
  for (const arr of groups.values()) arr.sort((a, b) => a.episodeNum - b.episodeNum)
  return groups
}

function orderedLabels(groups) {
  const known = CURVE_ORDER.filter(l => groups.has(l))
  const extras = [...groups.keys()].filter(l => !CURVE_ORDER.includes(l))
  return [...known, ...extras]
}

/**
 * A3b.9 — Master split detector. When a curve's eval points include
 * both `asFirstMover=true` and `asFirstMover=false` rows, the curve
 * gets rendered as two sub-charts (one per side) instead of one. This
 * lights up in Phase B when Connect 4 ships its Master solver; on TTT
 * every row has `asFirstMover=null` and this function returns
 * `{ split: false }` so the existing single-chart behavior is
 * preserved.
 *
 * Rows where `asFirstMover` is null/undefined when the curve is being
 * split fall back into BOTH halves (a defensive choice — losing them
 * would silently underreport the curve). In practice the writer either
 * splits every row or no row for a given curve, so this fallback is
 * only a guard.
 */
export function splitByFirstMover(points) {
  const hasFirst  = points.some(p => p.asFirstMover === true)
  const hasSecond = points.some(p => p.asFirstMover === false)
  if (!(hasFirst && hasSecond)) return { split: false }
  const firstMover  = points.filter(p => p.asFirstMover !== false)
  const secondMover = points.filter(p => p.asFirstMover !== true)
  return { split: true, firstMover, secondMover }
}

/**
 * A curve is saturated when its last SATURATION_WINDOW eval points are
 * all 100% wins. Returns true / false; called once per curve.
 */
export function isCurveSaturated(points, window = SATURATION_WINDOW) {
  if (!points || points.length < window) return false
  const tail = points.slice(-window)
  return tail.every(p => {
    const total = p.wins + p.draws + p.losses
    return total > 0 && p.wins === total
  })
}

/**
 * Normalize a curve's points into the recharts row shape. Wins/draws/
 * losses get converted to percentages so the three curves are visually
 * comparable on the same y-axis even when eval budgets differ across
 * tiers (Easy might run 20 games while Primary runs 50).
 */
function toChartRows(points) {
  return points.map(p => {
    const total = p.wins + p.draws + p.losses
    const denom = total > 0 ? total : 1
    return {
      ep:    p.episodeNum,
      win:   Math.round((p.wins   / denom) * 100),
      draw:  Math.round((p.draws  / denom) * 100),
      loss:  Math.round((p.losses / denom) * 100),
      total,
    }
  })
}

export default function StackedCurvesChart({ sessionId, refreshMs = 0 }) {
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  // Fetch + optional poll. We don't pull SWR for this because the
  // component is only mounted in two contexts (live training, post-
  // training summary) and both want explicit control over the cadence.
  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    async function load() {
      try {
        const r = await api.ml.getMetrics(sessionId)
        if (cancelled) return
        setMetrics(r.metrics ?? [])
        setError(null)
      } catch (err) {
        if (cancelled) return
        setError(err.message ?? 'Failed to load metrics')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    if (refreshMs > 0) {
      const id = setInterval(load, refreshMs)
      return () => { cancelled = true; clearInterval(id) }
    }
    return () => { cancelled = true }
  }, [sessionId, refreshMs])

  const groups = useMemo(() => groupByLabel(metrics ?? []), [metrics])
  const labels = useMemo(() => orderedLabels(groups), [groups])

  // Empty state: nothing to show. We deliberately don't render a
  // placeholder during loading — the chart card has its own loaded
  // state, and the upstream TrainTab caller controls whether it shows
  // at all (only after a session exists). If metrics is empty after
  // load, the session didn't run multi-curve eval (legacy single-
  // opponent sessions) and we render nothing.
  if (loading || error) return null
  if (!metrics?.length) return null

  // Inner renderer — one card per chart. Pulled out so the A3b.9 split
  // path can call it twice (first-mover + second-mover) without
  // duplicating the JSX.
  const renderCurve = ({ key, testId, headerSuffix, points }) => {
    if (points.length < 2) return null
    const rows = toChartRows(points)
    const saturated = isCurveSaturated(points)
    const opacity   = saturated ? 0.4 : 1.0
    const labelKey  = key.replace(/-(firstmover|secondmover)$/, '')
    const baseTitle = CURVE_LABEL[labelKey] ?? `vs ${labelKey}`
    return (
      <div
        key={testId}
        data-testid={testId}
        data-saturated={saturated ? 'true' : 'false'}
        style={{ opacity }}
      >
        <ChartPanel
          label={
            <span className="flex items-center gap-2">
              <span>{baseTitle}{headerSuffix ? ` ${headerSuffix}` : ''}</span>
              {saturated && (
                <span
                  className="text-xs font-normal"
                  style={{ color: 'var(--text-muted)' }}
                >
                  (saturated — wins ≥ 100% for last {SATURATION_WINDOW} eval points)
                </span>
              )}
            </span>
          }
        >
          <AreaChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
            <XAxis dataKey="ep" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} unit="%" />
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v}%`]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area
              isAnimationActive={false}
              type="monotone" dataKey="win"  stackId="1"
              stroke="var(--color-teal-600)"  fill="var(--color-teal-600)"
              fillOpacity={0.55} name="Wins %"
            />
            <Area
              isAnimationActive={false}
              type="monotone" dataKey="draw" stackId="1"
              stroke="var(--color-amber-600)" fill="var(--color-amber-600)"
              fillOpacity={0.55} name="Draws %"
            />
            <Area
              isAnimationActive={false}
              type="monotone" dataKey="loss" stackId="1"
              stroke="var(--color-red-500)"   fill="var(--color-red-500)"
              fillOpacity={0.55} name="Losses %"
            />
          </AreaChart>
        </ChartPanel>
      </div>
    )
  }

  return (
    <div className="space-y-4" data-testid="stacked-curves-chart">
      {labels.flatMap(label => {
        const points = groups.get(label) ?? []
        if (points.length < 2) return []
        // A3b.9 — Master curve (and any future per-side-split curve)
        // renders as two sub-charts when the underlying eval ran first-
        // mover and second-mover passes separately. TTT is unsplit so
        // this collapses to the existing single-chart path.
        const split = splitByFirstMover(points)
        if (split.split) {
          return [
            renderCurve({
              key:          label,
              testId:       `stacked-curve-${label}-firstmover`,
              headerSuffix: '— as first-mover',
              points:       split.firstMover,
            }),
            renderCurve({
              key:          label,
              testId:       `stacked-curve-${label}-secondmover`,
              headerSuffix: '— as second-mover',
              points:       split.secondMover,
            }),
          ]
        }
        return [renderCurve({
          key:    label,
          testId: `stacked-curve-${label}`,
          points,
        })]
      })}
    </div>
  )
}
