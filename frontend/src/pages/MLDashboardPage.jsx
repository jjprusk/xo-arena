import React, { useEffect, useState, useCallback, useRef } from 'react'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from 'recharts'
import { api } from '../lib/api.js'
import { getSocket } from '../lib/socket.js'
import QValueHeatmap from '../components/ml/QValueHeatmap.jsx'

const MODES = [
  { value: 'SELF_PLAY', label: 'Self-play', desc: 'Plays both X and O' },
  { value: 'VS_MINIMAX', label: 'vs Minimax', desc: 'Plays against the Minimax engine' },
  { value: 'VS_HUMAN', label: 'vs Human', desc: 'Learns from real player games' },
]
const DIFFICULTIES = ['easy', 'medium', 'hard']
const STATUS_COLOR = { IDLE: 'teal', TRAINING: 'blue' }
const SESSION_COLOR = { COMPLETED: 'teal', RUNNING: 'blue', FAILED: 'red', CANCELLED: 'amber', PENDING: 'gray' }

export default function MLDashboardPage() {
  const [models, setModels]           = useState([])
  const [selectedId, setSelectedId]   = useState(null)
  const [activeTab, setActiveTab]     = useState('train')
  const [showCreate, setShowCreate]   = useState(false)
  const [showClone,  setShowClone]    = useState(false)
  const [showImport, setShowImport]   = useState(false)
  const [regressions, setRegressions] = useState(new Set())

  const selected = models.find(m => m.id === selectedId)

  const loadModels = useCallback(async () => {
    const { models: ms } = await api.ml.listModels()
    setModels(ms)
  }, [])

  useEffect(() => { loadModels() }, [loadModels])

  useEffect(() => {
    const socket = getSocket()
    if (!socket.connected) socket.connect()
    socket.on('ml:regression_detected', ({ modelId }) => {
      setRegressions(prev => new Set([...prev, modelId]))
    })
    return () => { socket.off('ml:regression_detected') }
  }, [])

  // Auto-select first model
  useEffect(() => {
    if (models.length > 0 && !selectedId) setSelectedId(models[0].id)
  }, [models, selectedId])

  // Refresh model in list after training completes
  const refreshModel = useCallback(async (id) => {
    const { model } = await api.ml.getModel(id)
    setModels(ms => ms.map(m => m.id === id ? { ...m, ...model } : m))
  }, [])

  async function handleDelete(id) {
    if (!confirm('Delete this model and all its training history?')) return
    const token = await window.Clerk?.session?.getToken()
    await api.ml.deleteModel(id, token)
    setModels(ms => ms.filter(m => m.id !== id))
    if (selectedId === id) setSelectedId(models.find(m => m.id !== id)?.id || null)
  }

  async function handleReset(id) {
    if (!confirm('Reset this model to untrained baseline? All Q-table data will be lost.')) return
    const token = await window.Clerk?.session?.getToken()
    await api.ml.resetModel(id, token)
    refreshModel(id)
  }

  async function handleExport(id) {
    const data = await api.ml.exportModel(id)
    const src = models.find(m => m.id === id)
    downloadJSON(data, `${(src?.name || 'model').replace(/\s+/g, '_')}.ml.json`)
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="pb-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-default)' }}>
        <h1 className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>ML Dashboard</h1>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full"
            style={{ backgroundColor: 'var(--color-amber-100)', color: 'var(--color-amber-700)' }}>Admin</span>
          <Btn onClick={() => setShowImport(true)} variant="ghost">Import</Btn>
          <button onClick={() => setShowCreate(true)}
            className="px-3 py-1.5 text-sm font-semibold rounded-lg transition-all hover:brightness-110"
            style={{ backgroundColor: 'var(--color-blue-600)', color: 'white' }}>
            + New Model
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[280px_1fr] gap-6">
        {/* Model list */}
        <aside className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>Models</p>
          {models.length === 0 && (
            <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>No models yet.</p>
          )}
          {models.map(m => (
            <button key={m.id} onClick={() => setSelectedId(m.id)}
              className={`w-full text-left rounded-xl border p-3 transition-all ${selectedId === m.id ? 'border-[var(--color-blue-600)] bg-[var(--color-blue-50)]' : 'hover:border-[var(--color-gray-400)]'}`}
              style={{ borderColor: selectedId === m.id ? undefined : 'var(--border-default)', backgroundColor: selectedId === m.id ? undefined : 'var(--bg-surface)' }}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-sm truncate">{m.name}</span>
                <div className="flex items-center gap-1">
                  <StatusBadge status={m.status} />
                  {regressions.has(m.id) && (
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--color-amber-100)] text-[var(--color-amber-700)]">⚠ regressed</span>
                  )}
                </div>
              </div>
              <div className="text-xs mt-1 flex gap-2" style={{ color: 'var(--text-muted)' }}>
                <span>{m.totalEpisodes.toLocaleString()} eps</span>
                <span>·</span>
                <span>ELO {Math.round(m.eloRating)}</span>
              </div>
            </button>
          ))}
        </aside>

        {/* Detail panel */}
        <div>
          {!selected ? (
            <div className="rounded-xl border p-12 text-center" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}>
              <p className="text-lg font-semibold mb-1">No model selected</p>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Select a model from the list or create a new one.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Model header */}
              <div className="rounded-xl border p-4 flex items-center justify-between flex-wrap gap-3"
                style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--shadow-card)' }}>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-bold">{selected.name}</h2>
                    <StatusBadge status={selected.status} />
                  </div>
                  {selected.description && <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>{selected.description}</p>}
                  <div className="flex gap-4 mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span>{selected.algorithm?.replace('_', '-')}</span>
                    <span>{selected.totalEpisodes.toLocaleString()} episodes</span>
                    <span>ELO {Math.round(selected.eloRating)}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Btn onClick={() => handleExport(selected.id)} variant="ghost">Export</Btn>
                  <Btn onClick={() => setShowClone(true)} variant="ghost">Clone</Btn>
                  <Btn onClick={() => handleReset(selected.id)} variant="ghost">Reset</Btn>
                  <Btn onClick={() => handleDelete(selected.id)} variant="danger">Delete</Btn>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex gap-1 border-b" style={{ borderColor: 'var(--border-default)' }}>
                {['train', 'analytics', 'evaluation', 'explainability', 'checkpoints', 'export'].map(tab => (
                  <button key={tab} onClick={() => setActiveTab(tab)}
                    className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${activeTab === tab ? 'border-[var(--color-blue-600)] text-[var(--color-blue-600)]' : 'border-transparent'}`}
                    style={{ color: activeTab === tab ? undefined : 'var(--text-secondary)' }}>
                    {tab}
                  </button>
                ))}
              </div>

              {activeTab === 'train'          && <TrainTab model={selected} onComplete={() => { refreshModel(selected.id) }} />}
              {activeTab === 'analytics'     && <AnalyticsTab model={selected} />}
              {activeTab === 'evaluation'    && <EvaluationTab model={selected} models={models} />}
              {activeTab === 'explainability'&& <ExplainabilityTab model={selected} />}
              {activeTab === 'checkpoints'   && <CheckpointsTab model={selected} onRestore={() => refreshModel(selected.id)} />}
              {activeTab === 'export'        && <ExportTab model={selected} />}
            </div>
          )}
        </div>
      </div>

      {showCreate && <CreateModelModal onClose={() => setShowCreate(false)} onCreate={m => { setModels(ms => [m, ...ms]); setSelectedId(m.id); setShowCreate(false) }} />}
      {showClone  && selected && <CloneModelModal src={selected} onClose={() => setShowClone(false)} onCreate={m => { setModels(ms => [m, ...ms]); setSelectedId(m.id); setShowClone(false) }} />}
      {showImport && <ImportModelModal onClose={() => setShowImport(false)} onCreate={m => { setModels(ms => [m, ...ms]); setSelectedId(m.id); setShowImport(false) }} />}
    </div>
  )
}

// ─── Train Tab ───────────────────────────────────────────────────────────────

function TrainTab({ model, onComplete }) {
  const [mode, setMode]             = useState('SELF_PLAY')
  const [iterations, setIterations] = useState(1000)
  const [difficulty, setDifficulty] = useState('medium')
  const [running, setRunning]       = useState(false)
  const [sessionId, setSessionId]   = useState(null)
  const [progress, setProgress]     = useState(null)
  const [chartData, setChartData]   = useState([])
  const socketRef = useRef(null)

  // Cleanup socket listeners on unmount
  useEffect(() => {
    return () => {
      if (socketRef.current && sessionId) {
        socketRef.current.emit('ml:unwatch', { sessionId })
        socketRef.current.off('ml:progress')
        socketRef.current.off('ml:complete')
        socketRef.current.off('ml:error')
        socketRef.current.off('ml:cancelled')
      }
    }
  }, [sessionId])

  async function handleStart() {
    const token = await window.Clerk?.session?.getToken()
    const cfg = mode === 'VS_MINIMAX' ? { difficulty } : {}
    try {
      const { session } = await api.ml.train(model.id, { mode, iterations, config: cfg }, token)
      setSessionId(session.id)
      setRunning(true)
      setProgress(null)
      setChartData([])

      const socket = getSocket()
      if (!socket.connected) socket.connect()
      socketRef.current = socket
      socket.emit('ml:watch', { sessionId: session.id })

      socket.on('ml:progress', (data) => {
        if (data.sessionId !== session.id) return
        setProgress(data)
        setChartData(prev => [...prev, {
          ep: data.episode,
          winRate: Math.round(data.winRate * 100),
          drawRate: Math.round(data.drawRate * 100),
          epsilon: parseFloat((data.epsilon * 100).toFixed(1)),
          qDelta: parseFloat(data.avgQDelta.toFixed(4)),
        }])
      })

      const finish = () => {
        setRunning(false)
        socket.emit('ml:unwatch', { sessionId: session.id })
        socket.off('ml:progress')
        socket.off('ml:complete')
        socket.off('ml:error')
        socket.off('ml:cancelled')
        onComplete()
      }
      socket.once('ml:complete',   finish)
      socket.once('ml:cancelled',  finish)
      socket.once('ml:error',      (d) => { setRunning(false); alert(`Training failed: ${d.error}`); finish() })
    } catch (err) {
      alert(err.message)
    }
  }

  async function handleCancel() {
    if (!sessionId) return
    const token = await window.Clerk?.session?.getToken()
    await api.ml.cancelSession(sessionId, token)
  }

  const pct = progress ? Math.round((progress.episode / progress.totalEpisodes) * 100) : 0

  return (
    <div className="space-y-6">
      {/* Config */}
      {!running && (
        <Card>
          <SectionLabel>Training Configuration</SectionLabel>
          <div className="mt-3 space-y-4">
            {/* Mode */}
            <div>
              <label className="text-sm font-medium block mb-2" style={{ color: 'var(--text-secondary)' }}>Mode</label>
              <div className="flex flex-wrap gap-2">
                {MODES.map(m => (
                  <button key={m.value} onClick={() => setMode(m.value)}
                    className={`flex-1 min-w-[120px] text-left rounded-lg border p-3 transition-all ${mode === m.value ? 'border-[var(--color-blue-600)] bg-[var(--color-blue-50)]' : ''}`}
                    style={{ borderColor: mode === m.value ? undefined : 'var(--border-default)', backgroundColor: mode === m.value ? undefined : 'var(--bg-base)' }}>
                    <p className="text-sm font-semibold">{m.label}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{m.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Difficulty (VS_MINIMAX only) */}
            {mode === 'VS_MINIMAX' && (
              <div>
                <label className="text-sm font-medium block mb-2" style={{ color: 'var(--text-secondary)' }}>Opponent Difficulty</label>
                <div className="flex gap-2">
                  {DIFFICULTIES.map(d => (
                    <button key={d} onClick={() => setDifficulty(d)}
                      className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-all ${difficulty === d ? 'bg-[var(--color-blue-600)] text-white' : ''}`}
                      style={{ backgroundColor: difficulty === d ? undefined : 'var(--bg-surface-hover)', color: difficulty === d ? undefined : 'var(--text-secondary)' }}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Iterations */}
            <div>
              <label className="text-sm font-medium block mb-2" style={{ color: 'var(--text-secondary)' }}>
                Iterations: <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{iterations.toLocaleString()}</span>
              </label>
              <input type="range" min="100" max="10000" step="100" value={iterations}
                onChange={e => setIterations(Number(e.target.value))}
                className="w-full accent-[var(--color-blue-600)]" />
              <div className="flex justify-between text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                <span>100</span><span>10,000</span>
              </div>
            </div>

            <Btn onClick={handleStart} disabled={model.status === 'TRAINING'}>
              {model.status === 'TRAINING' ? 'Already training…' : 'Start Training'}
            </Btn>
          </div>
        </Card>
      )}

      {/* Live progress */}
      {running && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <SectionLabel>Training in Progress</SectionLabel>
            <Btn onClick={handleCancel} variant="ghost">Cancel</Btn>
          </div>

          {/* Progress bar */}
          <div className="h-2 rounded-full overflow-hidden mb-3" style={{ backgroundColor: 'var(--color-gray-200)' }}>
            <div className="h-full rounded-full transition-all duration-300"
              style={{ width: `${pct}%`, backgroundColor: 'var(--color-blue-600)' }} />
          </div>

          {progress && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <MiniStat label="Episode" value={`${progress.episode.toLocaleString()} / ${progress.totalEpisodes.toLocaleString()}`} />
                <MiniStat label="Win Rate" value={`${Math.round(progress.winRate * 100)}%`} color="var(--color-teal-600)" />
                <MiniStat label="Epsilon ε" value={progress.epsilon.toFixed(4)} color="var(--color-amber-600)" />
                <MiniStat label="Avg ΔQ" value={progress.avgQDelta.toFixed(5)} />
              </div>
              <div className="flex gap-4 text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                <span>Wins: <b style={{ color: 'var(--color-teal-600)' }}>{progress.outcomes.wins.toLocaleString()}</b></span>
                <span>Losses: <b style={{ color: 'var(--color-red-600)' }}>{progress.outcomes.losses.toLocaleString()}</b></span>
                <span>Draws: <b style={{ color: 'var(--color-amber-600)' }}>{progress.outcomes.draws.toLocaleString()}</b></span>
              </div>
            </>
          )}

          {/* Live charts */}
          {chartData.length > 1 && (
            <div className="space-y-4">
              <ChartPanel label="Win Rate % over Episodes">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
                  <XAxis dataKey="ep" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} unit="%" />
                  <Tooltip contentStyle={tooltipStyle} formatter={v => [`${v}%`]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="winRate" stroke="var(--color-teal-600)" dot={false} name="Win %" strokeWidth={2} />
                  <Line type="monotone" dataKey="drawRate" stroke="var(--color-amber-600)" dot={false} name="Draw %" strokeWidth={1} strokeDasharray="4 2" />
                </LineChart>
              </ChartPanel>
              <ChartPanel label="Exploration Rate (ε) Decay">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
                  <XAxis dataKey="ep" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} unit="%" />
                  <Tooltip contentStyle={tooltipStyle} formatter={v => [`${v}%`]} />
                  <Line type="monotone" dataKey="epsilon" stroke="var(--color-blue-600)" dot={false} name="ε %" strokeWidth={2} />
                </LineChart>
              </ChartPanel>
            </div>
          )}
        </Card>
      )}

      {/* Completed — show summary */}
      {!running && chartData.length > 0 && (
        <Card>
          <SectionLabel>Last Training Summary</SectionLabel>
          <div className="mt-3 space-y-4">
            <ChartPanel label="Win Rate over Episodes">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
                <XAxis dataKey="ep" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} unit="%" />
                <Tooltip contentStyle={tooltipStyle} formatter={v => [`${v}%`]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="winRate"  stroke="var(--color-teal-600)"  dot={false} name="Win %" strokeWidth={2} />
                <Line type="monotone" dataKey="drawRate" stroke="var(--color-amber-600)" dot={false} name="Draw %" strokeWidth={1} strokeDasharray="4 2" />
              </LineChart>
            </ChartPanel>
            <ChartPanel label="Q-delta Convergence">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
                <XAxis dataKey="ep" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="qDelta" stroke="var(--color-blue-600)" dot={false} name="Avg ΔQ" strokeWidth={2} />
              </LineChart>
            </ChartPanel>
          </div>
        </Card>
      )}
    </div>
  )
}

// ─── Analytics Tab ────────────────────────────────────────────────────────────

const ROLLING_WINDOWS = [50, 100, 500]
const SESSION_LINE_COLORS = ['var(--color-teal-600)', 'var(--color-blue-600)', 'var(--color-amber-600)', 'var(--color-red-600)']

function buildRolling(episodes, W) {
  if (episodes.length === 0) return []
  const step = Math.max(1, Math.floor(episodes.length / 200))
  return episodes.filter((_, i) => i % step === 0).map((_, idx) => {
    const realIdx = idx * step
    const slice = episodes.slice(Math.max(0, realIdx - W), realIdx + 1)
    const wins  = slice.filter(e => e.outcome === 'WIN').length
    return { ep: episodes[realIdx].episodeNum, winRate: Math.round((wins / slice.length) * 100) }
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

function AnalyticsTab({ model }) {
  const [sessions, setSessions]       = useState([])
  const [selSession, setSelSession]   = useState(null)
  const [cmpSession, setCmpSession]   = useState(null)   // comparison session
  const [episodes, setEpisodes]       = useState([])
  const [cmpEpisodes, setCmpEpisodes] = useState([])
  const [window, setWindow]           = useState(50)
  const [loading, setLoading]         = useState(false)

  useEffect(() => {
    api.ml.getSessions(model.id).then(r => {
      setSessions(r.sessions)
      if (r.sessions.length > 0) setSelSession(r.sessions[0])
    })
  }, [model.id])

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
            <div className="mt-2 flex flex-wrap gap-2">
              {sessions.map(s => (
                <button key={s.id} onClick={() => setSelSession(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${selSession?.id === s.id ? 'bg-[var(--color-teal-600)] text-white' : ''}`}
                  style={{ backgroundColor: selSession?.id === s.id ? undefined : 'var(--bg-surface-hover)', color: selSession?.id === s.id ? undefined : 'var(--text-secondary)' }}>
                  {s.mode.replace('_', ' ')} · {s.iterations.toLocaleString()} eps
                </button>
              ))}
            </div>
          </div>
          {sessions.length > 1 && (
            <div className="flex-1 min-w-[180px]">
              <SectionLabel>Compare with</SectionLabel>
              <div className="mt-2 flex flex-wrap gap-2">
                <button onClick={() => setCmpSession(null)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${!cmpSession ? 'bg-[var(--color-gray-600)] text-white' : ''}`}
                  style={{ backgroundColor: !cmpSession ? undefined : 'var(--bg-surface-hover)', color: !cmpSession ? undefined : 'var(--text-secondary)' }}>
                  None
                </button>
                {sessions.filter(s => s.id !== selSession?.id).map(s => (
                  <button key={s.id} onClick={() => setCmpSession(s)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${cmpSession?.id === s.id ? 'bg-[var(--color-blue-600)] text-white' : ''}`}
                    style={{ backgroundColor: cmpSession?.id === s.id ? undefined : 'var(--bg-surface-hover)', color: cmpSession?.id === s.id ? undefined : 'var(--text-secondary)' }}>
                    {s.mode.replace('_', ' ')} · {s.iterations.toLocaleString()} eps
                  </button>
                ))}
              </div>
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

// ─── Explainability Tab ───────────────────────────────────────────────────────

const EMPTY_BOARD = Array(9).fill(null)

function ExplainabilityTab({ model }) {
  const [board, setBoard]           = useState([...EMPTY_BOARD])
  const [qValues, setQValues]       = useState(null)
  const [bestCell, setBestCell]     = useState(null)
  const [loading, setLoading]       = useState(false)
  const [openingBook, setOpeningBook] = useState(null)
  const [obLoading, setObLoading]   = useState(false)
  const [activeSection, setSection] = useState('position') // 'position' | 'opening' | 'diff'

  // Fetch Q-values whenever board changes
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.ml.explainMove(model.id, board)
      .then(r => { if (!cancelled) { setQValues(r.qvalues); setBestCell(r.bestCell) } })
      .catch(() => { if (!cancelled) { setQValues(null); setBestCell(null) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [model.id, board.join(',')])

  function handleCellClick(i) {
    setBoard(prev => {
      const next = [...prev]
      if (next[i] === null)      next[i] = 'X'
      else if (next[i] === 'X')  next[i] = 'O'
      else                       next[i] = null
      return next
    })
  }

  function handleLoadOpeningBook() {
    setObLoading(true)
    api.ml.getOpeningBook(model.id)
      .then(r => setOpeningBook(r))
      .finally(() => setObLoading(false))
  }

  // Ranked legal moves by Q-value
  const rankedMoves = qValues
    ? qValues
        .map((v, i) => ({ i, v, mark: board[i] }))
        .filter(m => m.mark === null && m.v !== null)
        .sort((a, b) => b.v - a.v)
    : []

  const topQ = rankedMoves[0]?.v ?? 0
  const secondQ = rankedMoves[1]?.v ?? 0
  const confidence = rankedMoves.length >= 2 && topQ !== secondQ
    ? Math.min(100, Math.round(((topQ - secondQ) / (Math.abs(topQ) + Math.abs(secondQ) + 1e-6)) * 100))
    : 0

  return (
    <div className="space-y-4">
      {/* Section toggle */}
      <div className="flex gap-2 flex-wrap">
        {[['position', 'Position Analysis'], ['opening', 'Opening Book'], ['diff', 'Version Diff']].map(([s, label]) => (
          <button key={s} onClick={() => setSection(s)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${activeSection === s ? 'bg-[var(--color-blue-600)] text-white' : ''}`}
            style={{ backgroundColor: activeSection === s ? undefined : 'var(--bg-surface-hover)', color: activeSection === s ? undefined : 'var(--text-secondary)' }}>
            {label}
          </button>
        ))}
      </div>

      {activeSection === 'position' && (
        <div className="grid md:grid-cols-2 gap-4">
          {/* Left: interactive board */}
          <Card>
            <SectionLabel>Board Position</SectionLabel>
            <p className="text-xs mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>
              Click cells to cycle X → O → empty. Q-values update live.
            </p>
            <div className="flex justify-center mb-4">
              <QValueHeatmap board={board} qValues={qValues} highlight={bestCell} onCellClick={handleCellClick} />
            </div>
            <div className="flex gap-2 mt-2">
              <Btn onClick={() => setBoard([...EMPTY_BOARD])} variant="ghost">Clear</Btn>
              {bestCell !== null && (
                <p className="text-xs self-center" style={{ color: 'var(--text-muted)' }}>
                  Best cell: <b style={{ color: 'var(--color-blue-600)' }}>#{bestCell + 1}</b>
                  {' '}· Confidence: <b>{confidence}%</b>
                </p>
              )}
            </div>
          </Card>

          {/* Right: ranked moves */}
          <Card>
            <SectionLabel>Move Rankings</SectionLabel>
            {loading && <div className="flex justify-center py-8"><Spinner /></div>}
            {!loading && rankedMoves.length === 0 && (
              <p className="text-sm py-6 text-center" style={{ color: 'var(--text-muted)' }}>
                {board.every(c => c !== null) ? 'Board is full.' : 'No Q-values for this state yet — train the model first.'}
              </p>
            )}
            {!loading && rankedMoves.length > 0 && (
              <div className="mt-3 space-y-2">
                {rankedMoves.map(({ i, v }, rank) => {
                  const pct = topQ !== 0 ? Math.max(0, Math.round((v / Math.max(Math.abs(topQ), 1e-6)) * 100)) : 50
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-xs w-4 text-right font-semibold" style={{ color: 'var(--text-muted)' }}>#{rank + 1}</span>
                      <span className="text-xs w-12 font-mono font-bold" style={{ color: rank === 0 ? 'var(--color-teal-600)' : 'var(--text-secondary)' }}>
                        Cell {i + 1}
                      </span>
                      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-gray-200)' }}>
                        <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.abs(pct))}%`, backgroundColor: v >= 0 ? 'var(--color-teal-500)' : 'var(--color-red-500)' }} />
                      </div>
                      <span className="text-xs font-mono w-14 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                        {v.toFixed(4)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        </div>
      )}

      {activeSection === 'opening' && (
        <div className="space-y-4">
          {!openingBook ? (
            <Card>
              <SectionLabel>Opening Book</SectionLabel>
              <p className="text-xs mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>
                Analyze the model's first-move preferences and responses to opponent openings.
              </p>
              <Btn onClick={handleLoadOpeningBook} disabled={obLoading}>
                {obLoading ? 'Loading…' : 'Load Opening Book'}
              </Btn>
            </Card>
          ) : (
            <>
              {/* Agent's own first move */}
              <Card>
                <SectionLabel>Agent's Preferred First Move</SectionLabel>
                <p className="text-xs mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>
                  Q-values from the empty board ({openingBook.stateCount.toLocaleString()} states learned).
                </p>
                <div className="flex gap-6 items-start flex-wrap">
                  <QValueHeatmap
                    board={EMPTY_BOARD}
                    qValues={openingBook.firstMoveQVals}
                    highlight={openingBook.firstMoveQVals.indexOf(Math.max(...openingBook.firstMoveQVals))}
                  />
                  <div className="space-y-1.5 text-xs flex-1 min-w-[140px]">
                    {openingBook.firstMoveQVals
                      .map((v, i) => ({ i, v }))
                      .sort((a, b) => b.v - a.v)
                      .slice(0, 5)
                      .map(({ i, v }, rank) => (
                        <div key={i} className="flex items-center gap-2">
                          <span style={{ color: 'var(--text-muted)' }}>#{rank + 1}</span>
                          <span style={{ color: 'var(--text-secondary)' }}>Cell {i + 1}</span>
                          <span className="font-mono" style={{ color: rank === 0 ? 'var(--color-teal-600)' : 'var(--text-secondary)' }}>{v.toFixed(4)}</span>
                        </div>
                      ))}
                  </div>
                </div>
              </Card>

              {/* Responses to opponent openings */}
              <Card>
                <SectionLabel>Responses to Opponent Openings</SectionLabel>
                <p className="text-xs mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>
                  Hover a cell below to see the agent's Q-values when the opponent plays there first.
                </p>
                <OpeningResponseGrid responses={openingBook.responses} />
              </Card>
            </>
          )}
        </div>
      )}

      {activeSection === 'diff' && <VersionDiffViewer model={model} />}
    </div>
  )
}

// ─── Version Diff Viewer ──────────────────────────────────────────────────────

function VersionDiffViewer({ model }) {
  const [checkpoints, setCheckpoints] = useState([])
  const [versionA, setVersionA] = useState('current')
  const [versionB, setVersionB] = useState(null)
  const [qtableA, setQtableA]   = useState(null)
  const [qtableB, setQtableB]   = useState(null)
  const [loading, setLoading]   = useState(false)

  useEffect(() => {
    api.ml.getCheckpoints(model.id).then(r => {
      setCheckpoints(r.checkpoints)
      if (r.checkpoints.length > 0) setVersionB(r.checkpoints[0].id)
    })
  }, [model.id])

  async function fetchQTable(version) {
    if (version === 'current') {
      const r = await api.ml.getQTable(model.id)
      return r.qtable
    }
    const r = await api.ml.getCheckpoint(model.id, version)
    return r.checkpoint.qtable
  }

  async function runDiff() {
    if (!versionB) return
    setLoading(true)
    try {
      const [a, b] = await Promise.all([fetchQTable(versionA), fetchQTable(versionB)])
      setQtableA(a)
      setQtableB(b)
    } finally {
      setLoading(false)
    }
  }

  const diff = (() => {
    if (!qtableA || !qtableB) return null
    const allKeys = new Set([...Object.keys(qtableA), ...Object.keys(qtableB)])
    let added = 0, removed = 0, changed = 0
    const deltas = []
    for (const key of allKeys) {
      const a = qtableA[key]
      const b = qtableB[key]
      if (!a) { added++; continue }
      if (!b) { removed++; continue }
      const maxDelta = Math.max(...a.map((v, i) => Math.abs(v - b[i])))
      if (maxDelta > 1e-6) {
        changed++
        deltas.push({ key, a, b, maxDelta })
      }
    }
    deltas.sort((x, y) => y.maxDelta - x.maxDelta)
    // Build histogram (bins 0-0.1, 0.1-0.2, ..., 1+)
    const bins = Array.from({ length: 11 }).map((_, i) => ({ range: i < 10 ? `${i/10}–${(i+1)/10}` : '1+', count: 0 }))
    for (const d of deltas) {
      const bi = Math.min(10, Math.floor(d.maxDelta * 10))
      bins[bi].count++
    }
    return { added, removed, changed, deltas: deltas.slice(0, 20), histogram: bins }
  })()

  const cpLabel = id => {
    const cp = checkpoints.find(c => c.id === id)
    return cp ? `Ep ${cp.episodeNum.toLocaleString()} (ε=${cp.epsilon.toFixed(3)})` : id
  }

  return (
    <div className="space-y-4">
      <Card>
        <SectionLabel>Select Versions to Compare</SectionLabel>
        <div className="mt-3 grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-secondary)' }}>Version A</label>
            <select value={versionA} onChange={e => setVersionA(e.target.value)}
              className="w-full text-sm rounded-lg border px-3 py-1.5 outline-none"
              style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
              <option value="current">Current model (live Q-table)</option>
              {checkpoints.map(cp => <option key={cp.id} value={cp.id}>{cpLabel(cp.id)}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-secondary)' }}>Version B</label>
            <select value={versionB || ''} onChange={e => setVersionB(e.target.value)}
              className="w-full text-sm rounded-lg border px-3 py-1.5 outline-none"
              style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
              {checkpoints.map(cp => <option key={cp.id} value={cp.id}>{cpLabel(cp.id)}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-3">
          <Btn onClick={runDiff} disabled={loading || !versionB || versionA === versionB}>
            {loading ? 'Computing…' : 'Compare'}
          </Btn>
        </div>
        {checkpoints.length === 0 && <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>No checkpoints yet — train the model to generate checkpoints.</p>}
      </Card>

      {diff && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-3">
            <MiniStat label="States added" value={diff.added.toLocaleString()} color="var(--color-teal-600)" />
            <MiniStat label="States removed" value={diff.removed.toLocaleString()} color="var(--color-red-600)" />
            <MiniStat label="States changed" value={diff.changed.toLocaleString()} color="var(--color-blue-600)" />
          </div>

          {/* Delta histogram */}
          <ChartPanel label="Q-value Delta Distribution">
            <BarChart data={diff.histogram}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
              <XAxis dataKey="range" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="count" fill="var(--color-blue-500)" name="States" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartPanel>

          {/* Top changed states */}
          {diff.deltas.length > 0 && (
            <Card>
              <SectionLabel>Top {diff.deltas.length} Most Changed States</SectionLabel>
              <p className="text-xs mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>
                States with the largest max Q-value change between versions.
              </p>
              <div className="space-y-4">
                {diff.deltas.map(({ key, a, b, maxDelta }) => {
                  const board = key.split('').map(c => c === 'X' ? 'X' : c === 'O' ? 'O' : null)
                  return (
                    <div key={key} className="rounded-lg border p-3" style={{ borderColor: 'var(--border-default)' }}>
                      <div className="flex items-center justify-between mb-2">
                        <code className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{key}</code>
                        <span className="text-xs font-semibold" style={{ color: 'var(--color-amber-600)' }}>Δmax={maxDelta.toFixed(4)}</span>
                      </div>
                      <div className="flex gap-6 flex-wrap">
                        <div>
                          <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Version A</p>
                          <QValueHeatmap board={board} qValues={a.map((v, i) => board[i] !== null ? null : v)} />
                        </div>
                        <div>
                          <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Version B</p>
                          <QValueHeatmap board={board} qValues={b.map((v, i) => board[i] !== null ? null : v)} />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function OpeningResponseGrid({ responses }) {
  const [hovered, setHovered] = useState(null)
  const active = hovered !== null ? responses[hovered] : null

  return (
    <div className="flex gap-6 flex-wrap items-start">
      {/* Opponent move selector — 3×3 grid */}
      <div>
        <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>Opponent plays:</p>
        <div className="grid grid-cols-3 gap-1.5 w-[140px]">
          {Array.from({ length: 9 }).map((_, i) => (
            <button key={i} type="button"
              onMouseEnter={() => setHovered(i)} onFocus={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)} onBlur={() => setHovered(null)}
              className="aspect-square flex items-center justify-center rounded-lg border-2 text-sm font-bold transition-all"
              style={{
                minHeight: 40,
                backgroundColor: hovered === i ? 'var(--color-teal-100)' : 'var(--bg-base)',
                borderColor: hovered === i ? 'var(--color-teal-600)' : 'var(--border-default)',
                color: 'var(--color-teal-600)',
              }}>
              O
            </button>
          ))}
        </div>
      </div>

      {/* Agent's response heatmap */}
      <div>
        <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
          {active ? `Agent's response (opponent played cell ${active.opponentCell + 1}):` : 'Hover a cell to see response'}
        </p>
        {active ? (
          <QValueHeatmap
            board={Array(9).fill(null).map((_, i) => i === active.opponentCell ? 'O' : null)}
            qValues={active.qvals.map((v, i) => i === active.opponentCell ? null : v)}
            highlight={active.qvals.reduce((best, v, i) => i !== active.opponentCell && (best === -1 || v > active.qvals[best]) ? i : best, -1)}
          />
        ) : (
          <div className="w-[220px] h-[160px] rounded-xl border flex items-center justify-center"
            style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Checkpoints Tab ──────────────────────────────────────────────────────────

function CheckpointsTab({ model, onRestore }) {
  const [checkpoints, setCheckpoints] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.ml.getCheckpoints(model.id).then(r => setCheckpoints(r.checkpoints))
  }, [model.id])

  async function handleSave() {
    setSaving(true)
    try {
      const token = await window.Clerk?.session?.getToken()
      const { checkpoint } = await api.ml.saveCheckpoint(model.id, token)
      setCheckpoints(prev => [checkpoint, ...prev])
    } finally {
      setSaving(false)
    }
  }

  async function handleRestore(cpId) {
    if (!confirm('Restore this checkpoint? Current Q-table will be replaced.')) return
    const token = await window.Clerk?.session?.getToken()
    await api.ml.restoreCheckpoint(model.id, cpId, token)
    onRestore()
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <SectionLabel>Checkpoints</SectionLabel>
        <Btn onClick={handleSave} disabled={saving} variant="ghost">
          {saving ? 'Saving…' : '+ Save now'}
        </Btn>
      </div>
      <p className="text-xs mt-1 mb-3" style={{ color: 'var(--text-muted)' }}>
        Auto-saved every 1,000 episodes. Restore any checkpoint to roll back the model.
      </p>
      {checkpoints.length === 0 ? (
        <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>No checkpoints yet.</p>
      ) : (
        <div className="space-y-2">
          {checkpoints.map(cp => (
            <div key={cp.id} className="flex items-center justify-between rounded-lg border px-4 py-3"
              style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}>
              <div>
                <p className="text-sm font-semibold">Episode {cp.episodeNum.toLocaleString()}</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  ε={cp.epsilon.toFixed(4)} · ELO {Math.round(cp.eloRating)} · {new Date(cp.createdAt).toLocaleString()}
                </p>
              </div>
              <Btn onClick={() => handleRestore(cp.id)} variant="ghost">Restore</Btn>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ─── Export Tab ───────────────────────────────────────────────────────────────

function ExportTab({ model }) {
  const [sessions, setSessions]   = useState([])
  const [selSession, setSelSession] = useState(null)

  useEffect(() => {
    api.ml.getSessions(model.id).then(r => {
      setSessions(r.sessions)
      if (r.sessions.length > 0) setSelSession(r.sessions[0].id)
    })
  }, [model.id])

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

// ─── Clone Model Modal ────────────────────────────────────────────────────────

function CloneModelModal({ src, onClose, onCreate }) {
  const [name, setName]     = useState(`${src.name} (copy)`)
  const [desc, setDesc]     = useState(src.description || '')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      const token = await window.Clerk?.session?.getToken()
      const { model } = await api.ml.cloneModel(src.id, { name: name.trim(), description: desc.trim() || undefined }, token)
      onCreate(model)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="w-full max-w-md rounded-2xl border p-6 space-y-4"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}>
        <h2 className="text-xl font-bold">Clone "{src.name}"</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-sm font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Name *</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:border-[var(--color-blue-600)] transition-colors"
              style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Description</label>
            <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Optional"
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:border-[var(--color-blue-600)] transition-colors"
              style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
          </div>
          {error && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{error}</p>}
          <div className="flex gap-2 justify-end pt-1">
            <Btn type="button" onClick={onClose} variant="ghost">Cancel</Btn>
            <Btn type="submit" disabled={saving || !name.trim()}>{saving ? 'Cloning…' : 'Clone'}</Btn>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Import Model Modal ───────────────────────────────────────────────────────

function ImportModelModal({ onClose, onCreate }) {
  const [error, setError]   = useState(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef(null)

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setSaving(true)
    setError(null)
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const token = await window.Clerk?.session?.getToken()
      const { model } = await api.ml.importModel(data, token)
      onCreate(model)
    } catch (err) {
      setError(err.message || 'Invalid model file')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="w-full max-w-md rounded-2xl border p-6 space-y-4"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}>
        <h2 className="text-xl font-bold">Import Model</h2>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Select a <code className="font-mono text-xs">.ml.json</code> file exported from this dashboard.
        </p>
        <div
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors hover:border-[var(--color-blue-600)]"
          style={{ borderColor: 'var(--border-default)' }}>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {saving ? 'Importing…' : 'Click to select file'}
          </p>
          <input ref={fileRef} type="file" accept=".json,.ml.json" className="hidden" onChange={handleFile} disabled={saving} />
        </div>
        {error && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{error}</p>}
        <div className="flex justify-end">
          <Btn type="button" onClick={onClose} variant="ghost">Cancel</Btn>
        </div>
      </div>
    </div>
  )
}

// ─── Create Model Modal ───────────────────────────────────────────────────────

function CreateModelModal({ onClose, onCreate }) {
  const [name, setName]         = useState('')
  const [desc, setDesc]         = useState('')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      const token = await window.Clerk?.session?.getToken()
      const { model } = await api.ml.createModel({ name: name.trim(), description: desc.trim() || undefined }, token)
      onCreate(model)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="w-full max-w-md rounded-2xl border p-6 space-y-4"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}>
        <h2 className="text-xl font-bold">New ML Model</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-sm font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Alpha v1"
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:border-[var(--color-blue-600)] transition-colors"
              style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Description</label>
            <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Optional description"
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:border-[var(--color-blue-600)] transition-colors"
              style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
          </div>
          {error && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{error}</p>}
          <div className="flex gap-2 justify-end pt-1">
            <Btn type="button" onClick={onClose} variant="ghost">Cancel</Btn>
            <Btn type="submit" disabled={saving || !name.trim()}>{saving ? 'Creating…' : 'Create'}</Btn>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Evaluation Tab ───────────────────────────────────────────────────────────

function EvaluationTab({ model, models }) {
  const [section, setSection] = useState('benchmark') // 'benchmark' | 'elo' | 'versus' | 'tournament'

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {[['benchmark', 'Benchmark'], ['elo', 'ELO History'], ['versus', 'Head-to-Head'], ['tournament', 'Tournament']].map(([s, label]) => (
          <button key={s} onClick={() => setSection(s)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${section === s ? 'bg-[var(--color-blue-600)] text-white' : ''}`}
            style={{ backgroundColor: section === s ? undefined : 'var(--bg-surface-hover)', color: section === s ? undefined : 'var(--text-secondary)' }}>
            {label}
          </button>
        ))}
      </div>
      {section === 'benchmark'  && <BenchmarkPanel model={model} />}
      {section === 'elo'        && <EloPanel model={model} />}
      {section === 'versus'     && <VersusPanel model={model} models={models} />}
      {section === 'tournament' && <TournamentPanel models={models} />}
    </div>
  )
}

function BenchmarkPanel({ model }) {
  const [benchmarks, setBenchmarks] = useState([])
  const [running, setRunning] = useState(false)
  const [activeBid, setActiveBid] = useState(null)
  const socketRef = useRef(null)

  useEffect(() => {
    api.ml.listBenchmarks(model.id).then(r => setBenchmarks(r.benchmarks))
  }, [model.id])

  async function handleRun() {
    const token = await window.Clerk?.session?.getToken()
    const { benchmark } = await api.ml.startBenchmark(model.id, token)
    setRunning(true)
    setActiveBid(benchmark.id)
    setBenchmarks(prev => [{ ...benchmark, summary: { status: 'RUNNING' } }, ...prev])

    // Poll for result
    let attempts = 0
    const poll = async () => {
      attempts++
      try {
        const r = await api.ml.getBenchmark(benchmark.id)
        if (r.benchmark?.summary?.status === 'COMPLETED' || r.benchmark?.summary?.status === 'FAILED') {
          setRunning(false)
          setBenchmarks(prev => prev.map(b => b.id === benchmark.id ? r.benchmark : b))
          return
        }
      } catch (_) {}
      if (attempts < 30) setTimeout(poll, 1000)
      else setRunning(false)
    }
    setTimeout(poll, 1000)
  }

  const latest = benchmarks.find(b => b.summary?.status === 'COMPLETED')

  const OPPONENTS = [
    { key: 'vsRandom', label: 'vs Random' },
    { key: 'vsEasy',   label: 'vs Easy AI' },
    { key: 'vsMedium', label: 'vs Medium AI' },
    { key: 'vsHard',   label: 'vs Hard AI' },
  ]

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between">
          <SectionLabel>Benchmark</SectionLabel>
          <div className="flex items-center gap-3">
            {latest && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Last run: {new Date(latest.runAt).toLocaleDateString()}</span>}
            <Btn onClick={handleRun} disabled={running || model.status === 'TRAINING'}>
              {running ? 'Running…' : 'Run Benchmark'}
            </Btn>
          </div>
        </div>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          1,000 games vs each opponent using pure exploitation (ε=0).
        </p>

        {running && (
          <div className="flex items-center gap-3 mt-4 p-3 rounded-lg" style={{ backgroundColor: 'var(--bg-base)' }}>
            <Spinner />
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Running 4,000 benchmark games…</span>
          </div>
        )}

        {latest && !running && (
          <div className="mt-4 space-y-3">
            {OPPONENTS.map(({ key, label }) => {
              const r = latest[key]
              if (!r || !r.total) return null
              const pct = Math.round(r.winRate * 100)
              const sig = r.pValue !== undefined && r.pValue <= 0.05
              return (
                <div key={key}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono tabular-nums" style={{ color: 'var(--text-muted)' }}>
                        {r.wins}W / {r.draws}D / {r.losses}L
                      </span>
                      <span className="text-sm font-bold" style={{ color: pct >= 60 ? 'var(--color-teal-600)' : pct >= 40 ? 'var(--color-amber-600)' : 'var(--color-red-600)' }}>
                        {pct}%
                      </span>
                      {r.pValue !== undefined && (
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${sig ? 'bg-[var(--color-teal-100)] text-[var(--color-teal-700)]' : 'bg-[var(--color-amber-100)] text-[var(--color-amber-700)]'}`}>
                          {sig ? `p=${r.pValue}` : `p=${r.pValue} ns`}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-gray-200)' }}>
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: pct >= 60 ? 'var(--color-teal-500)' : pct >= 40 ? 'var(--color-amber-500)' : 'var(--color-red-500)' }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {!latest && !running && (
          <p className="text-sm text-center py-6" style={{ color: 'var(--text-muted)' }}>No benchmark results yet.</p>
        )}
      </Card>

      {/* Benchmark history */}
      {benchmarks.length > 1 && (
        <Card>
          <SectionLabel>History ({benchmarks.length} runs)</SectionLabel>
          <div className="mt-2 space-y-2">
            {benchmarks.filter(b => b.summary?.status === 'COMPLETED').slice(0, 5).map(b => (
              <div key={b.id} className="flex items-center justify-between text-xs py-1.5 border-b last:border-0"
                style={{ borderColor: 'var(--border-default)' }}>
                <span style={{ color: 'var(--text-muted)' }}>{new Date(b.runAt).toLocaleDateString()}</span>
                <span style={{ color: 'var(--text-secondary)' }}>Avg {Math.round((b.summary?.avgWinRate ?? 0) * 100)}% win rate</span>
                {b.vsHard?.winRate !== undefined && (
                  <span style={{ color: 'var(--color-blue-600)' }}>Hard: {Math.round(b.vsHard.winRate * 100)}%</span>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

function EloPanel({ model }) {
  const [history, setHistory] = useState([])

  useEffect(() => {
    api.ml.getEloHistory(model.id).then(r => setHistory(r.history))
  }, [model.id])

  const chartData = history.map((h, i) => ({ i: i + 1, elo: Math.round(h.eloRating), delta: h.delta }))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <MiniStat label="Current ELO" value={Math.round(model.eloRating)} color="var(--color-blue-600)" />
        <MiniStat label="Peak ELO" value={history.length > 0 ? Math.round(Math.max(...history.map(h => h.eloRating))) : '—'} color="var(--color-teal-600)" />
        <MiniStat label="Games" value={history.length.toLocaleString()} />
      </div>

      {chartData.length > 1 ? (
        <ChartPanel label="ELO Rating over Time">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
            <XAxis dataKey="i" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} domain={['auto', 'auto']} />
            <Tooltip contentStyle={tooltipStyle} formatter={v => [v, 'ELO']} />
            <Line type="monotone" dataKey="elo" stroke="var(--color-blue-600)" dot={false} strokeWidth={2} />
          </LineChart>
        </ChartPanel>
      ) : (
        <Card>
          <p className="text-sm text-center py-6" style={{ color: 'var(--text-muted)' }}>
            No ELO history yet. Run head-to-head or tournament to generate ELO data.
          </p>
        </Card>
      )}
    </div>
  )
}

function VersusPanel({ model, models }) {
  const [opponent, setOpponent] = useState(null)
  const [games, setGames] = useState(100)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)

  const others = models.filter(m => m.id !== model.id)

  useEffect(() => {
    if (others.length > 0 && !opponent) setOpponent(others[0].id)
  }, [others.length])

  async function handleRun() {
    if (!opponent) return
    setRunning(true)
    setResult(null)
    try {
      const token = await window.Clerk?.session?.getToken()
      const data = await api.ml.runVersus(model.id, opponent, games, token)
      setResult(data)
    } catch (err) {
      alert(err.message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <Card>
      <SectionLabel>Head-to-Head</SectionLabel>
      <p className="text-xs mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>
        Pit two models against each other. ELO is updated based on the aggregate result.
      </p>

      {others.length === 0 ? (
        <p className="text-sm py-4" style={{ color: 'var(--text-muted)' }}>Need at least two models to run head-to-head.</p>
      ) : (
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-secondary)' }}>Opponent</label>
              <select value={opponent || ''} onChange={e => setOpponent(e.target.value)}
                className="w-full text-sm rounded-lg border px-3 py-1.5 outline-none"
                style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
                {others.map(m => <option key={m.id} value={m.id}>{m.name} (ELO {Math.round(m.eloRating)})</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Games: <b>{games}</b>
              </label>
              <input type="range" min="10" max="1000" step="10" value={games}
                onChange={e => setGames(Number(e.target.value))}
                className="w-full accent-[var(--color-blue-600)]" />
            </div>
          </div>

          <Btn onClick={handleRun} disabled={running || !opponent}>
            {running ? 'Running…' : `Run ${games} games`}
          </Btn>

          {running && (
            <div className="flex items-center gap-3">
              <Spinner />
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Playing {games} games…</span>
            </div>
          )}

          {result && (
            <div className="mt-2 space-y-3 p-4 rounded-lg" style={{ backgroundColor: 'var(--bg-base)' }}>
              <div className="grid grid-cols-3 gap-3">
                <MiniStat label={`${model.name} wins`} value={result.winsA} color="var(--color-teal-600)" />
                <MiniStat label="Draws" value={result.draws} />
                <MiniStat label={`${models.find(m => m.id === result.modelBId)?.name || 'Opponent'} wins`} value={result.winsB} color="var(--color-red-600)" />
              </div>
              <div className="flex items-center justify-between text-xs">
                <span style={{ color: 'var(--text-secondary)' }}>
                  {model.name} win rate: <b style={{ color: 'var(--color-blue-600)' }}>{Math.round(result.winRateA * 100)}%</b>
                </span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${result.pValue <= 0.05 ? 'bg-[var(--color-teal-100)] text-[var(--color-teal-700)]' : 'bg-[var(--color-amber-100)] text-[var(--color-amber-700)]'}`}>
                  {result.pValue <= 0.05 ? `Significant (p=${result.pValue})` : `Not significant (p=${result.pValue})`}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function TournamentPanel({ models }) {
  const [selected, setSelected] = useState([])
  const [gamesPerPair, setGamesPerPair] = useState(50)
  const [running, setRunning] = useState(false)
  const [tournament, setTournament] = useState(null)
  const [history, setHistory] = useState([])
  const socketRef = useRef(null)

  useEffect(() => {
    api.ml.listTournaments().then(r => setHistory(r.tournaments))
  }, [])

  function toggleModel(id) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function handleRun() {
    if (selected.length < 2) return
    setRunning(true)
    const token = await window.Clerk?.session?.getToken()
    try {
      const { tournament: t } = await api.ml.startTournament({ modelIds: selected, gamesPerPair }, token)
      setTournament({ ...t, status: 'RUNNING' })

      const socket = getSocket()
      if (!socket.connected) socket.connect()
      socketRef.current = socket
      socket.on('ml:tournament_complete', (data) => {
        if (data.tournamentId !== t.id) return
        api.ml.getTournament(t.id).then(r => {
          setTournament(r.tournament)
          setRunning(false)
          setHistory(prev => [r.tournament, ...prev.filter(x => x.id !== r.tournament.id)])
        })
        socket.off('ml:tournament_complete')
      })
    } catch (err) {
      alert(err.message)
      setRunning(false)
    }
  }

  const latest = tournament?.status === 'COMPLETED' ? tournament : history.find(t => t.status === 'COMPLETED')
  const standings = latest?.results?.standings ?? []

  return (
    <div className="space-y-4">
      <Card>
        <SectionLabel>New Tournament</SectionLabel>
        <p className="text-xs mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>
          Round-robin: every pair plays {gamesPerPair} games. ELO updated after each matchup.
        </p>
        <div className="flex flex-wrap gap-2 mb-4">
          {models.map(m => (
            <button key={m.id} onClick={() => toggleModel(m.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${selected.includes(m.id) ? 'border-[var(--color-blue-600)] bg-[var(--color-blue-50)] text-[var(--color-blue-700)]' : ''}`}
              style={{ borderColor: selected.includes(m.id) ? undefined : 'var(--border-default)', backgroundColor: selected.includes(m.id) ? undefined : 'var(--bg-base)', color: selected.includes(m.id) ? undefined : 'var(--text-secondary)' }}>
              {m.name}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4 mb-4">
          <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>Games/pair: <b>{gamesPerPair}</b></label>
          <input type="range" min="10" max="200" step="10" value={gamesPerPair}
            onChange={e => setGamesPerPair(Number(e.target.value))}
            className="w-32 accent-[var(--color-blue-600)]" />
        </div>
        <Btn onClick={handleRun} disabled={running || selected.length < 2}>
          {running ? 'Tournament running…' : `Start (${selected.length} models)`}
        </Btn>
      </Card>

      {standings.length > 0 && (
        <Card>
          <SectionLabel>Tournament Results</SectionLabel>
          {latest?.completedAt && <p className="text-xs mt-0.5 mb-3" style={{ color: 'var(--text-muted)' }}>Completed {new Date(latest.completedAt).toLocaleString()}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-left" style={{ color: 'var(--text-muted)' }}>
                  <th className="pb-2 pr-4">#</th>
                  <th className="pb-2 pr-4">Model</th>
                  <th className="pb-2 pr-4">Pts</th>
                  <th className="pb-2 pr-4">W</th>
                  <th className="pb-2 pr-4">D</th>
                  <th className="pb-2">L</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((s, i) => (
                  <tr key={s.modelId} className="border-t" style={{ borderColor: 'var(--border-default)' }}>
                    <td className="py-2 pr-4 font-bold" style={{ color: i === 0 ? 'var(--color-amber-600)' : 'var(--text-muted)' }}>{i + 1}</td>
                    <td className="py-2 pr-4 font-medium">{s.name}</td>
                    <td className="py-2 pr-4 font-bold" style={{ color: 'var(--color-blue-600)' }}>{s.points}</td>
                    <td className="py-2 pr-4" style={{ color: 'var(--color-teal-600)' }}>{s.wins}</td>
                    <td className="py-2 pr-4" style={{ color: 'var(--color-amber-600)' }}>{s.draws}</td>
                    <td className="py-2" style={{ color: 'var(--color-red-600)' }}>{s.losses}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Card({ children }) {
  return (
    <div className="rounded-xl border p-5 space-y-1"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}>
      {children}
    </div>
  )
}

function SectionLabel({ children }) {
  return <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{children}</h3>
}

function MiniStat({ label, value, color }) {
  return (
    <div className="rounded-lg border p-3" style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)' }}>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-lg font-bold tabular-nums" style={{ fontFamily: 'var(--font-display)', color: color || 'var(--text-primary)' }}>{value}</p>
    </div>
  )
}

function ChartPanel({ label, children }) {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}>
      <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <ResponsiveContainer width="100%" height={200}>
        {children}
      </ResponsiveContainer>
    </div>
  )
}

function StatusBadge({ status, tiny }) {
  const colors = { IDLE: ['var(--color-teal-100)', 'var(--color-teal-700)'], TRAINING: ['var(--color-blue-100)', 'var(--color-blue-700)'], COMPLETED: ['var(--color-teal-100)', 'var(--color-teal-700)'], FAILED: ['var(--color-red-100)', 'var(--color-red-700)'], CANCELLED: ['var(--color-amber-100)', 'var(--color-amber-700)'], PENDING: ['var(--color-gray-100)', 'var(--color-gray-600)'], RUNNING: ['var(--color-blue-100)', 'var(--color-blue-700)'] }
  const [bg, text] = colors[status] || colors.PENDING
  return (
    <span className={`font-semibold rounded-full ${tiny ? 'text-[9px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5'}`}
      style={{ backgroundColor: bg, color: text }}>
      {status}
    </span>
  )
}

function Btn({ children, onClick, variant = 'primary', disabled, type = 'button' }) {
  const styles = {
    primary: { backgroundColor: 'var(--color-blue-600)', color: 'white' },
    ghost:   { backgroundColor: 'var(--bg-surface-hover)', color: 'var(--text-secondary)' },
    danger:  { backgroundColor: 'var(--color-red-50)', color: 'var(--color-red-600)' },
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all hover:brightness-105 disabled:opacity-50 disabled:cursor-not-allowed"
      style={styles[variant]}>
      {children}
    </button>
  )
}

function Spinner() {
  return <div className="w-6 h-6 border-4 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
}

const tooltipStyle = { backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 12 }

function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click(); URL.revokeObjectURL(url)
}

function downloadCSV(rows, keys, filename) {
  const header = keys.join(',')
  const lines  = rows.map(r => keys.map(k => r[k] ?? '').join(','))
  const blob   = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' })
  const url    = URL.createObjectURL(blob)
  const a      = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click(); URL.revokeObjectURL(url)
}
