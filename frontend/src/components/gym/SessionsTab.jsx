import React, { useState, useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Card, SectionLabel, SESSION_COLOR, SESSION_BADGE } from './gymShared.jsx'

function StatCell({ label, value }) {
  return (
    <div className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border-default)' }}>
      <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-sm font-semibold mt-0.5">{value}</p>
    </div>
  )
}

export default function SessionsTab({ model, sessions }) {
  const [selected, setSelected] = useState(() => sessions[0]?.id ?? '')
  const listRef = useRef(null)

  // Keep selection valid when sessions list changes
  useEffect(() => {
    if (sessions.length > 0 && !selected) setSelected(sessions[0].id)
  }, [sessions])

  const sel = sessions.find(s => s.id === selected) ?? null

  const virtualizer = useVirtualizer({
    count: sessions.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 48,
    overscan: 5,
  })

  function fmtDuration(s) {
    if (!s.startedAt || !s.completedAt) return '—'
    const ms = new Date(s.completedAt) - new Date(s.startedAt)
    const mins = Math.floor(ms / 60000)
    const secs = Math.floor((ms % 60000) / 1000)
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
  }

  return (
    <Card>
      <SectionLabel>Training Sessions</SectionLabel>
      <p className="text-xs mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>
        History of all training runs for this model.
      </p>
      {sessions.length === 0 ? (
        <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>No training sessions yet.</p>
      ) : (
        <div className="space-y-3">
          {/* Virtualized session list */}
          <div
            ref={listRef}
            className="rounded-lg border overflow-y-auto"
            style={{ maxHeight: 300, borderColor: 'var(--border-default)' }}
          >
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map(vItem => {
                const s = sessions[vItem.index]
                const color = SESSION_COLOR[s.status] || 'gray'
                const isSelected = s.id === selected
                return (
                  <div
                    key={s.id}
                    data-index={vItem.index}
                    ref={virtualizer.measureElement}
                    onClick={() => setSelected(s.id)}
                    className="absolute w-full px-3 py-2.5 flex items-center gap-3 cursor-pointer transition-colors"
                    style={{
                      top: vItem.start,
                      backgroundColor: isSelected ? 'var(--color-blue-50)' : 'var(--bg-surface)',
                      borderBottom: vItem.index < sessions.length - 1 ? '1px solid var(--border-default)' : 'none',
                    }}
                  >
                    <span className={`badge ${SESSION_BADGE[s.status] || 'badge-draft'} shrink-0`}>
                      {s.status}
                    </span>
                    <span className="text-xs truncate flex-1" style={{ color: isSelected ? 'var(--color-blue-700)' : 'var(--text-secondary)' }}>
                      {new Date(s.startedAt).toLocaleDateString()} · {s.mode.replace(/_/g, ' ')} · {s.iterations.toLocaleString()} eps
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Selected session detail */}
          {sel && (
            <div className="rounded-lg border px-4 py-4 space-y-3"
              style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{sel.mode.replace(/_/g, ' ')}</span>
                <span className={`badge ${SESSION_BADGE[sel.status] || 'badge-draft'}`}>{sel.status}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <StatCell label="Episodes" value={sel.iterations.toLocaleString()} />
                <StatCell label="Duration" value={fmtDuration(sel)} />
                <StatCell label="Started" value={new Date(sel.startedAt).toLocaleString()} />
                {sel.summary && <>
                  <StatCell label="Win rate" value={sel.summary.winRate != null ? `${(sel.summary.winRate * 100).toFixed(1)}%` : '—'} />
                  <StatCell label="Wins" value={sel.summary.wins ?? '—'} />
                  <StatCell label="Losses" value={sel.summary.losses ?? '—'} />
                  <StatCell label="Draws" value={sel.summary.draws ?? '—'} />
                  <StatCell label="Final ε" value={sel.summary.finalEpsilon != null ? sel.summary.finalEpsilon.toFixed(4) : '—'} />
                  {sel.summary.avgQDelta != null && <StatCell label="Avg Q-Δ" value={sel.summary.avgQDelta.toFixed(4)} />}
                </>}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
