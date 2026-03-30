import React, { useState } from 'react'
import { api } from '../../lib/api.js'
import { Card, SectionLabel, Btn, downloadJSON, downloadCSV } from './gymShared.jsx'

export default function ExportTab({ model, sessions }) {
  const [selSession, setSelSession] = useState(() => sessions[0]?.id ?? null)

  async function exportQTable() {
    const data = await api.ml.getQTable(model.id)
    downloadJSON(data, `qtable_${model.name.replace(/\s+/g, '_')}.json`)
  }

  async function exportEpisodes() {
    if (!selSession) return
    const { episodes } = await api.ml.getEpisodes(selSession, 1)
    downloadCSV(episodes, ['episodeNum', 'outcome', 'totalMoves', 'avgQDelta', 'epsilon', 'durationMs'],
      `episodes_${model.name.replace(/\s+/g, '_')}_${selSession.slice(-6)}.csv`)
  }

  return (
    <Card>
      <SectionLabel>Export Data</SectionLabel>
      <div className="mt-4 space-y-4">
        <div className="flex items-center justify-between rounded-lg border px-4 py-3"
          style={{ borderColor: 'var(--border-default)' }}>
          <div>
            <p className="text-sm font-semibold">Q-Table (JSON)</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Full state→Q-value mapping. {model.totalEpisodes.toLocaleString()} episodes learned.</p>
          </div>
          <Btn onClick={exportQTable}>Download</Btn>
        </div>

        {sessions.length > 0 && (
          <div className="rounded-lg border px-4 py-3 space-y-2" style={{ borderColor: 'var(--border-default)' }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Episode Data (CSV)</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Per-episode outcome, Q-delta, epsilon for selected session.</p>
              </div>
              <Btn onClick={exportEpisodes}>Download</Btn>
            </div>
            <select value={selSession || ''} onChange={e => setSelSession(e.target.value)}
              className="w-full text-sm rounded-lg border px-3 py-1.5 outline-none"
              style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
              {sessions.map(s => (
                <option key={s.id} value={s.id}>
                  {s.mode.replace('_', ' ')} · {s.iterations.toLocaleString()} eps · {new Date(s.startedAt).toLocaleDateString()}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </Card>
  )
}
