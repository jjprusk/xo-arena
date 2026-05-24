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

  return (
    <div className="space-y-4" data-testid="stacked-curves-chart">
      {labels.map(label => {
        const points = groups.get(label) ?? []
        // Recharts can't draw a useful area from a single point and a
        // saturation check on <3 points is uninformative — skip until
        // we have at least 2 eval points for this curve.
        if (points.length < 2) return null
        const rows = toChartRows(points)
        const saturated = isCurveSaturated(points)
        const opacity   = saturated ? 0.4 : 1.0
        return (
          <div
            key={label}
            data-testid={`stacked-curve-${label}`}
            data-saturated={saturated ? 'true' : 'false'}
            style={{ opacity }}
          >
            <ChartPanel
              label={
                <span className="flex items-center gap-2">
                  <span>{CURVE_LABEL[label] ?? `vs ${label}`}</span>
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
      })}
    </div>
  )
}
