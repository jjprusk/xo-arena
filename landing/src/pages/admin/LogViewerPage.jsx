// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useState, useEffect, useRef } from 'react'
import { getToken } from '../../lib/getToken.js'
import { api } from '../../lib/api.js'
import { useEventStream } from '../../lib/useEventStream.js'

const LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']
const SOURCES = ['frontend', 'api', 'realtime', 'ai']

const LEVEL_STYLE = {
  DEBUG: { color: 'var(--text-muted)',        dot: 'var(--color-gray-400)' },
  INFO:  { color: 'var(--color-blue-600)',    dot: 'var(--color-blue-500)' },
  WARN:  { color: 'var(--color-amber-600)',   dot: 'var(--color-amber-500)' },
  ERROR: { color: 'var(--color-red-600)',     dot: 'var(--color-red-500)' },
  FATAL: { color: 'var(--color-red-700)',     dot: 'var(--color-red-700)' },
}

const LEVEL_ROW_BG = {
  ERROR: 'rgba(226, 75, 74, 0.04)',
  FATAL: 'rgba(194, 59, 58, 0.07)',
}

export default function LogViewerPage() {
  const [logs, setLogs] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [liveTail, setLiveTail] = useState(false)

  const [activeLevels, setActiveLevels] = useState(new Set(['INFO', 'WARN', 'ERROR', 'FATAL']))
  const [activeSources, setActiveSources] = useState(new Set(SOURCES))
  const [userId, setUserId] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [roomId, setRoomId] = useState('')
  const [textSearch, setTextSearch] = useState('')
  const [expanded, setExpanded] = useState(new Set())

  const listRef = useRef(null)

  function toggleLevel(l) {
    setActiveLevels((prev) => { const n = new Set(prev); n.has(l) ? n.delete(l) : n.add(l); return n })
  }
  function toggleSource(s) {
    setActiveSources((prev) => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n })
  }
  function toggleExpand(id) {
    setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  useEffect(() => {
    setLoading(true)
    getToken()
      .then(token => api.logs.list(token, { limit: 1000 }))
      .then((res) => { setLogs(res.logs || []); setTotal(res.total || 0) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEventStream({
    channels:   ['admin:logs:'],
    eventTypes: ['admin:logs:entry'],
    enabled:    liveTail,
    onEvent: (channel, payload) => {
      if (channel === 'admin:logs:entry') setLogs((prev) => [payload, ...prev.slice(0, 999)])
    },
  })

  const filtered = logs.filter((log) => {
    if (!activeLevels.has(log.level)) return false
    if (!activeSources.has(log.source)) return false
    if (userId && log.userId !== userId) return false
    if (sessionId && log.sessionId !== sessionId) return false
    if (roomId && log.roomId !== roomId) return false
    if (textSearch && !log.message?.toLowerCase().includes(textSearch.toLowerCase())) return false
    return true
  })

  function exportJSON() {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'logs.json'; a.click()
    URL.revokeObjectURL(url)
  }
  function exportCSV() {
    const header = 'timestamp,level,source,userId,sessionId,roomId,message'
    const rows = filtered.map((l) =>
      [l.timestamp, l.level, l.source, l.userId || '', l.sessionId || '', l.roomId || '', JSON.stringify(l.message)].join(',')
    )
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'logs.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="pb-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-default)' }}>
        <h1 className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>Log Viewer</h1>
        <span
          className="text-xs font-semibold px-2.5 py-1 rounded-full"
          style={{ backgroundColor: 'var(--color-amber-100)', color: 'var(--color-amber-700)' }}
        >
          Admin
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {LEVELS.map((l) => (
          <button
            key={l}
            onClick={() => toggleLevel(l)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-semibold border transition-opacity ${activeLevels.has(l) ? 'opacity-100' : 'opacity-30'}`}
            style={{ color: LEVEL_STYLE[l].color, borderColor: LEVEL_STYLE[l].dot }}
          >
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: LEVEL_STYLE[l].dot }} />
            {l}
          </button>
        ))}
        <span className="w-px mx-1 self-stretch" style={{ backgroundColor: 'var(--border-default)' }} />
        {SOURCES.map((s) => (
          <button
            key={s}
            onClick={() => toggleSource(s)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-opacity ${activeSources.has(s) ? 'opacity-100' : 'opacity-30'}`}
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {[['User ID', userId, setUserId], ['Session ID', sessionId, setSessionId], ['Room', roomId, setRoomId]].map(([ph, val, setVal]) => (
          <input
            key={ph}
            type="text"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder={ph}
            className="px-3 py-1.5 rounded-lg border text-xs outline-none focus:border-[var(--color-blue-600)] transition-colors"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
          />
        ))}
        <input
          type="search"
          value={textSearch}
          onChange={(e) => setTextSearch(e.target.value)}
          placeholder="Search message…"
          className="px-3 py-1.5 rounded-lg border text-xs outline-none focus:border-[var(--color-blue-600)] transition-colors flex-1 min-w-[200px]"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
        />
      </div>

      <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
        <span>{filtered.length} of {logs.length} entries</span>
        <div className="flex items-center gap-4">
          <button onClick={exportJSON} className="hover:text-[var(--text-primary)] transition-colors">↓ JSON</button>
          <button onClick={exportCSV} className="hover:text-[var(--text-primary)] transition-colors">↓ CSV</button>
          <label className="flex items-center gap-2 cursor-pointer">
            <span>Live tail</span>
            <button
              onClick={() => setLiveTail((v) => !v)}
              className={`relative w-8 h-4 rounded-full transition-colors ${liveTail ? 'bg-[var(--color-teal-600)]' : 'bg-[var(--color-gray-300)]'}`}
            >
              <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${liveTail ? 'left-4.5' : 'left-0.5'}`} />
            </button>
          </label>
        </div>
      </div>

      <div
        ref={listRef}
        className="rounded-xl border overflow-auto max-h-[60vh]"
        style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--shadow-card)' }}
      >
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center py-12 text-sm" style={{ color: 'var(--text-muted)' }}>
            No log entries match your filters.
          </p>
        ) : (
          filtered.map((log, i) => {
            const id = log.id || `${i}`
            const isOpen = expanded.has(id)
            const style = LEVEL_STYLE[log.level] || LEVEL_STYLE.INFO
            const rowBg = LEVEL_ROW_BG[log.level]
            return (
              <div
                key={id}
                className="border-b cursor-pointer hover:bg-[var(--bg-surface-hover)] transition-colors"
                style={{ borderColor: 'var(--border-default)', backgroundColor: rowBg || undefined }}
                onClick={() => toggleExpand(id)}
              >
                <div className="flex items-start gap-3 px-4 py-2 text-xs font-mono">
                  <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: style.dot }} />
                  <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                    {log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '—'}
                  </span>
                  <span className="font-bold w-12 flex-shrink-0" style={{ color: style.color }}>{log.level}</span>
                  <span className="w-16 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{log.source}</span>
                  <span className="flex-1 truncate" style={{ color: 'var(--text-primary)' }}>{log.message}</span>
                </div>
                {isOpen && log.meta && (
                  <div className="px-4 pb-3">
                    <pre
                      className="text-xs p-3 rounded-lg overflow-auto"
                      style={{ backgroundColor: 'var(--color-gray-900)', color: 'var(--color-gray-50)', fontFamily: 'var(--font-mono)' }}
                    >
                      {JSON.stringify(log.meta, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
