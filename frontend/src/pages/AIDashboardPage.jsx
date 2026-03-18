import React, { useEffect, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { api } from '../lib/api.js'

const DIFFICULTIES = ['', 'easy', 'medium', 'hard']
const DIFFICULTY_COLOR = { easy: 'var(--color-teal-600)', medium: 'var(--color-amber-600)', hard: 'var(--color-red-600)' }
const CELL_LABELS = ['TL', 'TM', 'TR', 'ML', 'C', 'MR', 'BL', 'BM', 'BR']

export default function AIDashboardPage() {
  const [summary, setSummary] = useState({ total: 0, rows: [] })
  const [histogram, setHistogram] = useState([])
  const [heatmap, setHeatmap] = useState([])
  const [difficulty, setDifficulty] = useState('')
  const [loading, setLoading] = useState(false)

  // Fetch summary once (not filtered)
  useEffect(() => {
    api.get('/admin/ai/summary').then(setSummary).catch(() => {})
  }, [])

  // Fetch histogram + heatmap when difficulty changes
  useEffect(() => {
    setLoading(true)
    const qs = difficulty ? `?difficulty=${difficulty}` : ''
    Promise.all([
      api.get(`/admin/ai/histogram${qs}`),
      api.get(`/admin/ai/heatmap${qs}`),
    ])
      .then(([h, hm]) => {
        setHistogram(h.histogram || [])
        setHeatmap(hm.heatmap || [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [difficulty])

  const maxHeatmapCount = Math.max(1, ...heatmap.map((c) => c.count))

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          AI Dashboard
        </h1>
        <span className="text-xs px-2 py-1 rounded-full" style={{ backgroundColor: 'var(--color-amber-100)', color: 'var(--color-amber-700)' }}>
          Admin
        </span>
      </div>

      {/* Scorecard */}
      <section>
        <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>Summary</h2>
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
          <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>
            No moves recorded yet. Play some AI games to populate this dashboard.
          </p>
        )}
      </section>

      {/* Difficulty filter */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Filter:</span>
        {DIFFICULTIES.map((d) => (
          <button
            key={d || 'all'}
            onClick={() => setDifficulty(d)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              difficulty === d ? 'border-[var(--color-blue-600)] text-[var(--color-blue-600)]' : 'border-[var(--border-default)]'
            }`}
            style={{ color: difficulty === d ? 'var(--color-blue-600)' : 'var(--text-secondary)' }}
          >
            {d || 'All'}
          </button>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Histogram */}
        <section>
          <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>
            Move Computation Time
          </h2>
          <div
            className="rounded-xl border p-4"
            style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
          >
            {loading ? (
              <Spinner />
            ) : histogram.length === 0 ? (
              <Empty />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={histogram} margin={{ top: 4, right: 4, bottom: 4, left: -20 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 12 }}
                    cursor={{ fill: 'var(--bg-surface-hover)' }}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {histogram.map((entry, i) => (
                      <Cell key={i} fill="var(--color-blue-600)" fillOpacity={0.7 + 0.05 * i} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        {/* Heatmap */}
        <section>
          <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>
            Cell Selection Heatmap
          </h2>
          <div
            className="rounded-xl border p-4 flex flex-col items-center"
            style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
          >
            {loading ? (
              <Spinner />
            ) : heatmap.length === 0 ? (
              <Empty />
            ) : (
              <div className="grid grid-cols-3 gap-1.5 w-full max-w-[240px]">
                {heatmap.map(({ index, count }) => {
                  const intensity = count / maxHeatmapCount
                  return (
                    <div
                      key={index}
                      className="aspect-square rounded-lg flex flex-col items-center justify-center gap-0.5"
                      style={{
                        backgroundColor: `rgba(var(--color-teal-600-raw, 20,184,166), ${0.08 + intensity * 0.7})`,
                        border: '1px solid var(--border-default)',
                      }}
                    >
                      <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{count}</span>
                      <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>{CELL_LABELS[index]}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Move time bar chart by difficulty */}
      <section>
        <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>
          Avg Computation Time by Difficulty
        </h2>
        <div
          className="rounded-xl border p-4"
          style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
        >
          {summary.rows.length === 0 ? (
            <Empty />
          ) : (
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
      className="rounded-xl border p-4 space-y-1"
      style={{
        borderColor: accentColor || 'var(--border-default)',
        backgroundColor: 'var(--bg-surface)',
        borderLeftWidth: accentColor ? 3 : 1,
      }}
    >
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-xl font-bold" style={{ color: accentColor || 'var(--text-primary)' }}>{value}</p>
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
    <p className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>
      No data yet.
    </p>
  )
}
