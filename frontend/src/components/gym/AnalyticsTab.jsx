import React, { useState, useEffect } from 'react'
import {
  LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts'
import { api } from '../../lib/api.js'
import {
  Card, SectionLabel, MiniStat, ChartPanel, Spinner, tooltipStyle,
} from './gymShared.jsx'

const ROLLING_WINDOWS = [50, 100, 500]

function buildRolling(episodes, W) {
  if (episodes.length === 0) return []
  const step = Math.max(1, Math.floor(episodes.length / 200))
  return episodes.filter((_, i) => i % step === 0).map((_, idx) => {
    const realIdx = idx * step
    const slice = episodes.slice(Math.max(0, realIdx - W), realIdx + 1)
    const wins   = slice.filter(e => e.outcome === 'WIN').length
    const losses = slice.filter(e => e.outcome === 'LOSS').length
    const draws  = slice.filter(e => e.outcome === 'DRAW').length
    return {
      ep:       episodes[realIdx].episodeNum,
      winRate:  Math.round((wins   / slice.length) * 100),
      lossRate: Math.round((losses / slice.length) * 100),
      drawRate: Math.round((draws  / slice.length) * 100),
    }
  })
}

function buildChartData(episodes) {
  if (episodes.length === 0) return []
  const step = Math.max(1, Math.floor(episodes.length / 200))
  return episodes.filter((_, i) => i % step === 0).map(e => ({
    ep:      e.episodeNum,
    qDelta:  parseFloat(e.avgQDelta.toFixed(5)),
    epsilon: parseFloat((e.epsilon * 100).toFixed(1)),
  }))
}

export default function AnalyticsTab({ model, sessions }) {
  const [selSession, setSelSession]   = useState(null)
  const [cmpSession, setCmpSession]   = useState(null)
  const [episodes, setEpisodes]       = useState([])
  const [cmpEpisodes, setCmpEpisodes] = useState([])
  const [window, setWindow]           = useState(50)
  const [loading, setLoading]         = useState(false)

  // Set initial session when sessions become available from parent
  useEffect(() => {
    if (sessions.length > 0 && !selSession) setSelSession(sessions[0])
  }, [sessions])

  useEffect(() => {
    if (!selSession) return
    setLoading(true)
    api.ml.getEpisodes(selSession.id, 1).then(r => setEpisodes(r.episodes)).finally(() => setLoading(false))
  }, [selSession])

  useEffect(() => {
    if (!cmpSession) { setCmpEpisodes([]); return }
    api.ml.getEpisodes(cmpSession.id, 1).then(r => setCmpEpisodes(r.episodes))
  }, [cmpSession])

  const rollingA   = buildRolling(episodes, window)
  const rollingB   = buildRolling(cmpEpisodes, window)
  const chartData  = buildChartData(episodes)

  // Merge primary + comparison rolling data by episode index
  const comparisonData = (() => {
    if (rollingB.length === 0) return rollingA.map(d => ({ ...d, winRateA: d.winRate }))
    const maxLen = Math.max(rollingA.length, rollingB.length)
    return Array.from({ length: maxLen }).map((_, i) => ({
      i,
      winRateA: rollingA[i]?.winRate ?? null,
      winRateB: rollingB[i]?.winRate ?? null,
    }))
  })()

  if (sessions.length === 0) {
    return <Card><p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>No training sessions yet. Train this model first.</p></Card>
  }

  return (
    <div className="space-y-4">
      {/* Session selector + comparison */}
      <Card>
        <div className="flex flex-wrap items-start gap-6">
          <div className="flex-1 min-w-[180px]">
            <SectionLabel>Primary session</SectionLabel>
            <select
              className="mt-2 w-full px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{ backgroundColor: 'var(--bg-surface-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}
              value={selSession?.id ?? ''}
              onChange={e => setSelSession(sessions.find(s => s.id === e.target.value) ?? null)}
            >
              {sessions.map(s => (
                <option key={s.id} value={s.id}>
                  {s.mode.replace('_', ' ')} · {s.iterations.toLocaleString()} eps
                </option>
              ))}
            </select>
          </div>
          {sessions.length > 1 && (
            <div className="flex-1 min-w-[180px]">
              <SectionLabel>Compare with</SectionLabel>
              <select
                className="mt-2 w-full px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ backgroundColor: 'var(--bg-surface-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}
                value={cmpSession?.id ?? ''}
                onChange={e => setCmpSession(sessions.find(s => s.id === e.target.value) ?? null)}
              >
                <option value="">None</option>
                {sessions.filter(s => s.id !== selSession?.id).map(s => (
                  <option key={s.id} value={s.id}>
                    {s.mode.replace('_', ' ')} · {s.iterations.toLocaleString()} eps
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Rolling window selector */}
        <div className="mt-4 flex items-center gap-2">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Rolling window:</span>
          {ROLLING_WINDOWS.map(w => (
            <button key={w} onClick={() => setWindow(w)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${window === w ? 'bg-[var(--color-blue-600)] text-white' : ''}`}
              style={{ backgroundColor: window === w ? undefined : 'var(--bg-surface-hover)', color: window === w ? undefined : 'var(--text-secondary)' }}>
              {w}
            </button>
          ))}
        </div>

        {selSession?.summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
            <MiniStat label="Win Rate" value={`${Math.round((selSession.summary.winRate ?? 0) * 100)}%`} color="var(--color-teal-600)" />
            <MiniStat label="Final ε" value={(selSession.summary.finalEpsilon ?? 0).toFixed(4)} />
            <MiniStat label="Avg ΔQ" value={(selSession.summary.avgQDelta ?? 0).toFixed(5)} />
            <MiniStat label="States" value={(selSession.summary.stateCount ?? 0).toLocaleString()} />
          </div>
        )}
      </Card>

      {loading && <div className="flex justify-center py-8"><Spinner /></div>}

      {!loading && comparisonData.length > 1 && (
        <>
          <ChartPanel label={`Rolling Win Rate (window=${window})${cmpSession ? ' — comparison overlay' : ''}`}>
            <LineChart data={comparisonData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
              <XAxis dataKey="i" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} label={{ value: 'episode →', position: 'insideRight', offset: -10, fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} unit="%" />
              <Tooltip contentStyle={tooltipStyle} formatter={v => [`${v}%`]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="winRateA" stroke="var(--color-teal-600)" dot={false} strokeWidth={2} name={selSession?.mode?.replace('_', ' ') ?? 'Session A'} connectNulls />
              {cmpSession && <Line type="monotone" dataKey="winRateB" stroke="var(--color-blue-600)" dot={false} strokeWidth={2} strokeDasharray="5 3" name={cmpSession.mode.replace('_', ' ') + ' (cmp)'} connectNulls />}
            </LineChart>
          </ChartPanel>
          <ChartPanel label="Q-delta Convergence">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
              <XAxis dataKey="ep" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line type="monotone" dataKey="qDelta" stroke="var(--color-blue-600)" dot={false} strokeWidth={2} name="Avg ΔQ" />
            </LineChart>
          </ChartPanel>
          <ChartPanel label="Exploration Rate Decay">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
              <XAxis dataKey="ep" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} unit="%" />
              <Tooltip contentStyle={tooltipStyle} formatter={v => [`${v}%`, 'ε']} />
              <Line type="monotone" dataKey="epsilon" stroke="var(--color-amber-600)" dot={false} strokeWidth={2} />
            </LineChart>
          </ChartPanel>
        </>
      )}
    </div>
  )
}
