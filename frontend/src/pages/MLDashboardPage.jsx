import React, { useEffect, useState, useCallback, useRef } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from 'recharts'
import { api } from '../lib/api.js'
import { getSocket } from '../lib/socket.js'

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

  const selected = models.find(m => m.id === selectedId)

  const loadModels = useCallback(async () => {
    const { models: ms } = await api.ml.listModels()
    setModels(ms)
  }, [])

  useEffect(() => { loadModels() }, [loadModels])

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

  async function handleClone(id) {
    const token = await window.Clerk?.session?.getToken()
    const src = models.find(m => m.id === id)
    const { model } = await api.ml.cloneModel(id, { name: `${src.name} (copy)` }, token)
    setModels(ms => [model, ...ms])
    setSelectedId(model.id)
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="pb-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-default)' }}>
        <h1 className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>ML Dashboard</h1>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full"
            style={{ backgroundColor: 'var(--color-amber-100)', color: 'var(--color-amber-700)' }}>Admin</span>
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
                <StatusBadge status={m.status} />
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
                <div className="flex gap-2">
                  <Btn onClick={() => handleClone(selected.id)} variant="ghost">Clone</Btn>
                  <Btn onClick={() => handleReset(selected.id)} variant="ghost">Reset</Btn>
                  <Btn onClick={() => handleDelete(selected.id)} variant="danger">Delete</Btn>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex gap-1 border-b" style={{ borderColor: 'var(--border-default)' }}>
                {['train', 'analytics', 'checkpoints', 'export'].map(tab => (
                  <button key={tab} onClick={() => setActiveTab(tab)}
                    className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${activeTab === tab ? 'border-[var(--color-blue-600)] text-[var(--color-blue-600)]' : 'border-transparent'}`}
                    style={{ color: activeTab === tab ? undefined : 'var(--text-secondary)' }}>
                    {tab}
                  </button>
                ))}
              </div>

              {activeTab === 'train'       && <TrainTab model={selected} onComplete={() => { refreshModel(selected.id) }} />}
              {activeTab === 'analytics'   && <AnalyticsTab model={selected} />}
              {activeTab === 'checkpoints' && <CheckpointsTab model={selected} onRestore={() => refreshModel(selected.id)} />}
              {activeTab === 'export'      && <ExportTab model={selected} />}
            </div>
          )}
        </div>
      </div>

      {showCreate && <CreateModelModal onClose={() => setShowCreate(false)} onCreate={m => { setModels(ms => [m, ...ms]); setSelectedId(m.id); setShowCreate(false) }} />}
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

function AnalyticsTab({ model }) {
  const [sessions, setSessions]     = useState([])
  const [selSession, setSelSession] = useState(null)
  const [episodes, setEpisodes]     = useState([])
  const [loading, setLoading]       = useState(false)

  useEffect(() => {
    api.ml.getSessions(model.id).then(r => {
      setSessions(r.sessions)
      if (r.sessions.length > 0) setSelSession(r.sessions[0])
    })
  }, [model.id])

  useEffect(() => {
    if (!selSession) return
    setLoading(true)
    api.ml.getEpisodes(selSession.id, 1).then(r => {
      setEpisodes(r.episodes)
    }).finally(() => setLoading(false))
  }, [selSession])

  // Build chart data (sample to 200 points max)
  const chartData = (() => {
    if (episodes.length === 0) return []
    const step = Math.max(1, Math.floor(episodes.length / 200))
    return episodes.filter((_, i) => i % step === 0).map(e => ({
      ep: e.episodeNum,
      win:  e.outcome === 'WIN'  ? 1 : 0,
      loss: e.outcome === 'LOSS' ? 1 : 0,
      draw: e.outcome === 'DRAW' ? 1 : 0,
      qDelta: parseFloat(e.avgQDelta.toFixed(5)),
      epsilon: parseFloat((e.epsilon * 100).toFixed(1)),
    }))
  })()

  // Rolling win rate (window=50)
  const rollingData = (() => {
    if (episodes.length === 0) return []
    const W = 50
    const step = Math.max(1, Math.floor(episodes.length / 200))
    return episodes.filter((_, i) => i % step === 0).map((_, idx, arr) => {
      const realIdx = idx * step
      const slice = episodes.slice(Math.max(0, realIdx - W), realIdx + 1)
      const wins = slice.filter(e => e.outcome === 'WIN').length
      return { ep: episodes[realIdx].episodeNum, winRate: Math.round((wins / slice.length) * 100) }
    })
  })()

  if (sessions.length === 0) {
    return <Card><p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>No training sessions yet. Train this model first.</p></Card>
  }

  return (
    <div className="space-y-4">
      {/* Session selector */}
      <Card>
        <SectionLabel>Session</SectionLabel>
        <div className="mt-2 flex flex-wrap gap-2">
          {sessions.map(s => (
            <button key={s.id} onClick={() => setSelSession(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${selSession?.id === s.id ? 'bg-[var(--color-blue-600)] text-white' : ''}`}
              style={{ backgroundColor: selSession?.id === s.id ? undefined : 'var(--bg-surface-hover)', color: selSession?.id === s.id ? undefined : 'var(--text-secondary)' }}>
              {s.mode.replace('_', ' ')} · {s.iterations.toLocaleString()} eps
              <span className="ml-1.5">
                <StatusBadge status={s.status} tiny />
              </span>
            </button>
          ))}
        </div>
        {selSession?.summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
            <MiniStat label="Win Rate" value={`${Math.round((selSession.summary.winRate ?? 0) * 100)}%`} color="var(--color-teal-600)" />
            <MiniStat label="Final ε" value={(selSession.summary.finalEpsilon ?? 0).toFixed(4)} />
            <MiniStat label="Avg ΔQ" value={(selSession.summary.avgQDelta ?? 0).toFixed(5)} />
            <MiniStat label="States" value={(selSession.summary.stateCount ?? 0).toLocaleString()} />
          </div>
        )}
      </Card>

      {loading && <div className="flex justify-center py-8"><Spinner /></div>}

      {!loading && rollingData.length > 1 && (
        <>
          <ChartPanel label="Rolling Win Rate (50-episode window)">
            <LineChart data={rollingData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
              <XAxis dataKey="ep" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} unit="%" />
              <Tooltip contentStyle={tooltipStyle} formatter={v => [`${v}%`, 'Win Rate']} />
              <Line type="monotone" dataKey="winRate" stroke="var(--color-teal-600)" dot={false} strokeWidth={2} />
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

// ─── Checkpoints Tab ──────────────────────────────────────────────────────────

function CheckpointsTab({ model, onRestore }) {
  const [checkpoints, setCheckpoints] = useState([])

  useEffect(() => {
    api.ml.getCheckpoints(model.id).then(r => setCheckpoints(r.checkpoints))
  }, [model.id])

  async function handleRestore(cpId) {
    if (!confirm('Restore this checkpoint? Current Q-table will be replaced.')) return
    const token = await window.Clerk?.session?.getToken()
    await api.ml.restoreCheckpoint(model.id, cpId, token)
    onRestore()
  }

  return (
    <Card>
      <SectionLabel>Checkpoints</SectionLabel>
      <p className="text-xs mt-1 mb-3" style={{ color: 'var(--text-muted)' }}>
        Saved every 1,000 episodes during training. Restore any checkpoint to roll back the model.
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
