import React, { useEffect, useState } from 'react'
import { getToken } from '../lib/getToken.js'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { api } from '../lib/api.js'

const DIFFICULTIES = ['', 'novice', 'intermediate', 'advanced', 'master']
const DIFFICULTY_COLOR = {
  novice:       'var(--color-teal-600)',
  intermediate: 'var(--color-amber-600)',
  advanced:     'var(--color-orange-600)',
  master:       'var(--color-red-600)',
}
const CELL_LABELS = ['TL', 'TM', 'TR', 'ML', 'C', 'MR', 'BL', 'BM', 'BR']

export default function AIDashboardPage() {
  const [summary, setSummary] = useState({ total: 0, rows: [] })
  const [histogram, setHistogram] = useState([])
  const [heatmap, setHeatmap] = useState([])
  const [difficulty, setDifficulty] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    getToken().then(token => api.get('/admin/ai/summary', token)).then(setSummary).catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    const qs = difficulty ? `?difficulty=${difficulty}` : ''
    getToken().then(token => Promise.all([
      api.get(`/admin/ai/histogram${qs}`, token),
      api.get(`/admin/ai/heatmap${qs}`, token),
    ]))
      .then(([h, hm]) => { setHistogram(h.histogram || []); setHeatmap(hm.heatmap || []) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [difficulty])

  const maxHeatmapCount = Math.max(1, ...heatmap.map((c) => c.count))

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="pb-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-default)' }}>
        <h1 className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>AI Dashboard</h1>
        <span
          className="text-xs font-semibold px-2.5 py-1 rounded-full"
          style={{ backgroundColor: 'var(--color-amber-100)', color: 'var(--color-amber-700)' }}
        >
          Admin
        </span>
      </div>

      {/* Summary scorecard */}
      <section className="space-y-3">
        <SectionLabel>Summary</SectionLabel>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total Moves" value={summary.total.toLocaleString()} />
          {summary.rows.map((row) => (
            <StatCard
              key={`${row.implementation}::${row.difficulty}`}
              label={`${row.implementation} / ${row.difficulty}`}
              value={`${row.count} moves`}
              sub={`avg ${row.avgMs}ms · max ${row.maxMs}ms`}
              accentColor={DIFFICULTY_COLOR[row.difficulty]}
            />
          ))}
        </div>
        {summary.rows.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            No moves recorded yet. Play some AI games to populate this dashboard.
          </p>
        )}
      </section>

      {/* Difficulty filter */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Filter:</span>
        <div
          className="flex rounded-lg border overflow-hidden"
          style={{ borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-sm)' }}
        >
          {DIFFICULTIES.map((d) => (
            <button
              key={d || 'all'}
              onClick={() => setDifficulty(d)}
              className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                difficulty === d ? 'bg-[var(--color-blue-600)] text-white' : 'hover:bg-[var(--bg-surface-hover)]'
              }`}
              style={{ color: difficulty === d ? 'white' : 'var(--text-secondary)' }}
            >
              {d || 'All'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Histogram */}
        <section className="space-y-3">
          <SectionLabel>Move Computation Time</SectionLabel>
          <div
            className="rounded-xl border p-4"
            style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--shadow-card)' }}
          >
            {loading ? <Spinner /> : histogram.length === 0 ? <Empty /> : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={histogram} margin={{ top: 4, right: 4, bottom: 4, left: -20 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 12 }}
                    cursor={{ fill: 'var(--bg-surface-hover)' }}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {histogram.map((_, i) => (
                      <Cell key={i} fill="var(--color-blue-600)" fillOpacity={0.7 + 0.05 * i} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        {/* Heatmap */}
        <section className="space-y-3">
          <SectionLabel>Cell Selection Heatmap</SectionLabel>
          <div
            className="rounded-xl border p-4 flex flex-col items-center"
            style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--shadow-card)' }}
          >
            {loading ? <Spinner /> : heatmap.length === 0 ? <Empty /> : (
              <div className="grid grid-cols-3 gap-1.5 w-full max-w-[240px]">
                {heatmap.map(({ index, count }) => {
                  const intensity = count / maxHeatmapCount
                  return (
                    <div
                      key={index}
                      className="aspect-square rounded-lg flex flex-col items-center justify-center gap-0.5"
                      style={{
                        backgroundColor: `color-mix(in srgb, var(--color-teal-500) ${Math.round((0.08 + intensity * 0.7) * 100)}%, transparent)`,
                        border: '1px solid var(--border-default)',
                      }}
                    >
                      <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>{count}</span>
                      <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>{CELL_LABELS[index]}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Avg time by difficulty */}
      <section className="space-y-3">
        <SectionLabel>Avg Computation Time by Difficulty</SectionLabel>
        <div
          className="rounded-xl border p-4"
          style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--shadow-card)' }}
        >
          {summary.rows.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={summary.rows} margin={{ top: 4, right: 4, bottom: 4, left: -20 }}>
                <XAxis dataKey="difficulty" tick={{ fontSize: 11, fill: 'var(--text-muted)', textTransform: 'capitalize' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} unit="ms" />
                <Tooltip
                  formatter={(v) => [`${v}ms`, 'Avg time']}
                  contentStyle={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 12 }}
                  cursor={{ fill: 'var(--bg-surface-hover)' }}
                />
                <Bar dataKey="avgMs" radius={[4, 4, 0, 0]}>
                  {summary.rows.map((row, i) => (
                    <Cell key={i} fill={DIFFICULTY_COLOR[row.difficulty] || 'var(--color-blue-600)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>
    </div>
  )
}

function StatCard({ label, value, sub, accentColor }) {
  return (
    <div
      className="rounded-xl border p-4 space-y-1 overflow-hidden relative"
      style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--shadow-card)' }}
    >
      {accentColor && (
        <div className="absolute top-0 left-0 right-0 h-0.5" style={{ backgroundColor: accentColor }} />
      )}
      <p className="text-xs font-medium uppercase tracking-wide pt-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-xl font-bold" style={{ fontFamily: 'var(--font-display)', color: accentColor || 'var(--text-primary)' }}>{value}</p>
      {sub && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex justify-center py-8">
      <div className="w-6 h-6 border-4 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function Empty() {
  return (
    <p className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>No data yet.</p>
  )
}

function SectionLabel({ children }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
      {children}
    </h2>
  )
}
