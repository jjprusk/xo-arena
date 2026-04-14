// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useState, useEffect } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import { api } from '../../lib/api.js'
import { getToken } from '../../lib/getToken.js'
import QValueHeatmap from '../ml/QValueHeatmap.jsx'
import {
  Card, SectionLabel, Btn, Spinner, MiniStat, ChartPanel, tooltipStyle, playerLabel,
} from './gymShared.jsx'

const EMPTY_BOARD = Array(9).fill(null)

// ─── Opening Response Grid ────────────────────────────────────────────────────

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

// ─── Hyperparameter Search Panel ──────────────────────────────────────────────

function linspace(min, max, n) {
  if (n <= 1) return [min]
  const step = (max - min) / (n - 1)
  return Array.from({ length: n }, (_, i) => parseFloat((min + step * i).toFixed(6)))
}

function RangeInputPair({ label, min, max, setMin, setMax, step }) {
  return (
    <div>
      <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>{label}</label>
      <div className="flex items-center gap-2">
        <input type="number" step={step} value={min} onChange={e => setMin(Number(e.target.value))}
          className="w-20 text-xs rounded-lg border px-2 py-1 outline-none"
          style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>–</span>
        <input type="number" step={step} value={max} onChange={e => setMax(Number(e.target.value))}
          className="w-20 text-xs rounded-lg border px-2 py-1 outline-none"
          style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
      </div>
    </div>
  )
}

function HyperparamSearchPanel({ model }) {
  const [alphaMin,        setAlphaMin]        = useState(0.1)
  const [alphaMax,        setAlphaMax]        = useState(0.5)
  const [gammaMin,        setGammaMin]        = useState(0.8)
  const [gammaMax,        setGammaMax]        = useState(0.95)
  const [epsDecayMin,     setEpsDecayMin]     = useState(0.99)
  const [epsDecayMax,     setEpsDecayMax]     = useState(0.999)
  const [gamesPerConfig,  setGamesPerConfig]  = useState(500)
  const [running,  setRunning]  = useState(false)
  const [results,  setResults]  = useState(null)
  const [error,    setError]    = useState(null)

  async function handleRun() {
    setRunning(true)
    setError(null)
    setResults(null)
    try {
      const token = await getToken()
      const paramGrid = {
        learningRate:  linspace(alphaMin, alphaMax, 3),
        discountFactor: linspace(gammaMin, gammaMax, 2),
        epsilonDecay:  linspace(epsDecayMin, epsDecayMax, 2),
      }
      const data = await api.ml.startHyperparamSearch(model.id, { paramGrid, gamesPerConfig }, token)
      setResults(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setRunning(false)
    }
  }

  async function handleApplyBest() {
    if (!results?.bestConfig) return
    const token = await getToken()
    await api.ml.updateModel(model.id, { config: { ...model.config, ...results.bestConfig } }, token)
  }

  return (
    <Card>
      <SectionLabel>Hyperparameter Search</SectionLabel>
      <p className="text-xs mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>
        Grid search over α, γ, εDecay ranges. Each config trains for {gamesPerConfig} episodes vs Hard then evaluates 50 games.
      </p>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        <RangeInputPair label="Learning rate (α)" min={alphaMin} max={alphaMax} setMin={setAlphaMin} setMax={setAlphaMax} step={0.05} />
        <RangeInputPair label="Discount factor (γ)" min={gammaMin} max={gammaMax} setMin={setGammaMin} setMax={setGammaMax} step={0.05} />
        <RangeInputPair label="Epsilon decay" min={epsDecayMin} max={epsDecayMax} setMin={setEpsDecayMin} setMax={setEpsDecayMax} step={0.001} />
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Games per config</label>
          <input type="number" min="100" max="2000" step="100" value={gamesPerConfig}
            onChange={e => setGamesPerConfig(Number(e.target.value))}
            className="w-24 text-sm rounded-lg border px-2 py-1 outline-none"
            style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <Btn onClick={handleRun} disabled={running}>
          {running ? 'Searching…' : 'Run Search'}
        </Btn>
        {results?.bestConfig && (
          <Btn onClick={handleApplyBest} variant="ghost">Apply best config</Btn>
        )}
      </div>

      {error && <p className="text-xs mb-3" style={{ color: 'var(--color-red-600)' }}>{error}</p>}

      {running && (
        <div className="flex items-center gap-3 py-4">
          <Spinner />
          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Running grid search — this may take a moment…</span>
        </div>
      )}

      {results && (
        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>
            Best: α={results.bestConfig.learningRate} γ={results.bestConfig.discountFactor} εDecay={results.bestConfig.epsilonDecay}
            {' '}— {Math.round((results.results[0]?.winRate ?? 0) * 100)}% win rate
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left" style={{ color: 'var(--text-muted)' }}>
                  <th className="pb-2 pr-3">#</th>
                  <th className="pb-2 pr-3">α</th>
                  <th className="pb-2 pr-3">γ</th>
                  <th className="pb-2 pr-3">εDecay</th>
                  <th className="pb-2 pr-3">Win rate</th>
                  <th className="pb-2">W / Total</th>
                </tr>
              </thead>
              <tbody>
                {results.results.map((r, i) => (
                  <tr key={i} className="border-t" style={{ borderColor: 'var(--border-default)' }}>
                    <td className="py-1.5 pr-3 font-bold" style={{ color: i === 0 ? 'var(--color-teal-600)' : 'var(--text-muted)' }}>{i + 1}</td>
                    <td className="py-1.5 pr-3 font-mono">{r.config.learningRate}</td>
                    <td className="py-1.5 pr-3 font-mono">{r.config.discountFactor}</td>
                    <td className="py-1.5 pr-3 font-mono">{r.config.epsilonDecay}</td>
                    <td className="py-1.5 pr-3 font-bold" style={{ color: r.winRate >= 0.5 ? 'var(--color-teal-600)' : 'var(--color-red-600)' }}>
                      {Math.round(r.winRate * 100)}%
                    </td>
                    <td className="py-1.5" style={{ color: 'var(--text-muted)' }}>{r.wins} / {r.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  )
}

// ─── Opponent Model Panel ─────────────────────────────────────────────────────

function OpponentModelPanel({ model, board, qValues, domainUserId, currentUserName }) {
  const [profiles, setProfiles]         = useState([])
  const [selectedUserId, setSelectedUserId] = useState(null)
  const [profile, setProfile]           = useState(null)
  const [loadingProfiles, setLoadingProfiles] = useState(false)
  const [loadingProfile, setLoadingProfile]   = useState(false)

  const PROFILE_WEIGHT = 0.2

  useEffect(() => {
    setLoadingProfiles(true)
    api.ml.getPlayerProfiles(model.id)
      .then(r => {
        setProfiles(r.profiles)
        if (r.profiles.length > 0) setSelectedUserId(r.profiles[0].userId)
      })
      .catch(() => {})
      .finally(() => setLoadingProfiles(false))
  }, [model.id])

  useEffect(() => {
    if (!selectedUserId) { setProfile(null); return }
    setLoadingProfile(true)
    api.ml.getPlayerProfile(model.id, selectedUserId)
      .then(r => setProfile(r.profile))
      .catch(() => setProfile(null))
      .finally(() => setLoadingProfile(false))
  }, [model.id, selectedUserId])

  // Compute adapted Q-values from profile move patterns for the current board
  const adaptedQValues = (() => {
    if (!qValues || !profile) return null
    const movePatterns = profile.movePatterns || {}
    const stateKey = board.join(',')
    const statePatterns = movePatterns[stateKey] || {}
    const totalMovesFromState = Object.values(statePatterns).reduce((s, c) => s + Number(c), 0)

    return qValues.map((v, i) => {
      if (v === null) return null
      const bias = totalMovesFromState > 0
        ? (Number(statePatterns[i] || 0) / totalMovesFromState)
        : 0
      return v + PROFILE_WEIGHT * bias
    })
  })()

  // Find cells where ranking shifted
  const rankingShifts = (() => {
    if (!qValues || !adaptedQValues) return new Set()
    const baseOrder = qValues
      .map((v, i) => ({ i, v }))
      .filter(x => x.v !== null)
      .sort((a, b) => b.v - a.v)
      .map(x => x.i)
    const adaptOrder = adaptedQValues
      .map((v, i) => ({ i, v }))
      .filter(x => x.v !== null)
      .sort((a, b) => b.v - a.v)
      .map(x => x.i)
    const shifted = new Set()
    baseOrder.forEach((cell, rank) => {
      if (adaptOrder[rank] !== cell) shifted.add(cell)
    })
    return shifted
  })()

  if (loadingProfiles) {
    return <Card><div className="flex justify-center py-8"><Spinner /></div></Card>
  }

  if (profiles.length === 0) {
    return (
      <Card>
        <SectionLabel>Opponent Model</SectionLabel>
        <p className="text-sm py-6 text-center" style={{ color: 'var(--text-muted)' }}>
          No player profiles yet. Play against this ML model while signed in to build opponent models.
        </p>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <SectionLabel>Opponent Model</SectionLabel>
        <p className="text-xs mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>
          Select a player profile to see how their move history influences the AI's Q-values for the current board position.
          Cells highlighted in amber shifted ranking when adaptation is applied.
        </p>

        {/* Profile selector */}
        <div className="mb-4">
          <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-secondary)' }}>Player</label>
          <select
            value={selectedUserId || ''}
            onChange={e => setSelectedUserId(e.target.value)}
            className="w-full sm:w-auto text-sm rounded-lg border px-3 py-1.5 outline-none"
            style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
          >
            {profiles.map(p => (
              <option key={p.userId} value={p.userId}>
                {playerLabel(p, domainUserId, currentUserName)} ({p.gamesRecorded} games)
              </option>
            ))}
          </select>
        </div>

        {loadingProfile && <div className="flex justify-center py-4"><Spinner /></div>}

        {!loadingProfile && profile && adaptedQValues && (
          <div className="grid md:grid-cols-2 gap-6">
            {/* Base Q-values */}
            <div>
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>Base Q-values</p>
              <QValueHeatmap
                board={board}
                qValues={qValues}
                highlight={qValues ? qValues.reduce((b, v, i) => v !== null && (b === -1 || v > qValues[b]) ? i : b, -1) : null}
              />
            </div>

            {/* Adapted Q-values */}
            <div>
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>
                Adapted Q-values <span style={{ color: 'var(--color-amber-600)' }}>(profile weight {PROFILE_WEIGHT})</span>
              </p>
              <QValueHeatmap
                board={board}
                qValues={adaptedQValues}
                highlight={adaptedQValues ? adaptedQValues.reduce((b, v, i) => v !== null && (b === -1 || v > adaptedQValues[b]) ? i : b, -1) : null}
              />
            </div>

            {/* Shift summary */}
            {rankingShifts.size > 0 && (
              <div className="md:col-span-2">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Ranking shifted for cells:{' '}
                  {[...rankingShifts].map(c => (
                    <span key={c} className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold mx-0.5"
                      style={{ backgroundColor: 'var(--color-amber-100)', color: 'var(--color-amber-700)' }}>
                      #{c + 1}
                    </span>
                  ))}
                </p>
              </div>
            )}

            {rankingShifts.size === 0 && (
              <div className="md:col-span-2">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  No ranking changes for this board state — the player has no recorded moves here yet.
                </p>
              </div>
            )}
          </div>
        )}

        {!loadingProfile && !profile && selectedUserId && (
          <p className="text-sm py-4" style={{ color: 'var(--text-muted)' }}>Profile not found.</p>
        )}
      </Card>
    </div>
  )
}

// ─── Network Activations Panel ────────────────────────────────────────────────

function NetworkActivationsPanel({ model }) {
  const [board, setBoard]           = useState([...EMPTY_BOARD])
  const [activations, setActivations] = useState(null)
  const [qValues, setQValues]       = useState(null)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState(null)

  function handleCellClick(i) {
    setBoard(prev => {
      const next = [...prev]
      if (next[i] === null)      next[i] = 'X'
      else if (next[i] === 'X')  next[i] = 'O'
      else                       next[i] = null
      return next
    })
  }

  async function handleInspect() {
    setLoading(true)
    setError(null)
    try {
      const result = await api.ml.explainActivations(model.id, board)
      setActivations(result.activations)
      setQValues(result.qValues)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const MAX_CIRCLES = 64

  return (
    <Card>
      <SectionLabel>Network Activations</SectionLabel>
      <p className="text-xs mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>
        Inspect the internal activations of the neural network for a given board position.
        Each row represents one layer; blue = positive activation, red = negative.
      </p>

      <div className="flex gap-6 flex-wrap items-start mb-4">
        {/* Interactive board */}
        <div>
          <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>Click cells to cycle X → O → empty</p>
          <div className="grid grid-cols-3 gap-1 w-[140px]">
            {board.map((cell, i) => (
              <button key={i} type="button" onClick={() => handleCellClick(i)}
                className="aspect-square flex items-center justify-center rounded-lg border-2 text-sm font-bold transition-all"
                style={{
                  minHeight: 40,
                  backgroundColor: 'var(--bg-base)',
                  borderColor: 'var(--border-default)',
                  color: cell === 'X' ? 'var(--color-blue-600)' : 'var(--color-red-600)',
                }}>
                {cell ?? ''}
              </button>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <Btn onClick={() => setBoard([...EMPTY_BOARD])} variant="ghost">Clear</Btn>
            <Btn onClick={handleInspect} disabled={loading}>
              {loading ? 'Inspecting…' : 'Inspect activations'}
            </Btn>
          </div>
          {error && <p className="text-xs mt-2" style={{ color: 'var(--color-red-600)' }}>{error}</p>}
        </div>

        {/* Q-values summary */}
        {qValues && (
          <div>
            <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>Q-values (legal moves)</p>
            <div className="space-y-1">
              {qValues.map((v, i) => v !== null && (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="w-10" style={{ color: 'var(--text-muted)' }}>Cell {i + 1}</span>
                  <span className="font-mono w-14 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    {typeof v === 'number' ? v.toFixed(4) : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Layer visualizations */}
      {activations && (
        <div className="space-y-4 mt-4">
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            Layer Activations ({activations.length} layers)
          </p>
          {activations.map((layer, li) => {
            const displayed = layer.slice(0, MAX_CIRCLES)
            const maxAbs    = Math.max(...displayed.map(Math.abs), 1e-6)
            return (
              <div key={li}>
                <p className="text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>
                  Layer {li} — {layer.length} {li === 0 ? 'inputs' : li === activations.length - 1 ? 'outputs' : 'neurons'}
                  {layer.length > MAX_CIRCLES && <span> (showing first {MAX_CIRCLES})</span>}
                </p>
                <div className="flex flex-wrap gap-1">
                  {displayed.map((val, ni) => {
                    const intensity = Math.min(1, Math.abs(val) / maxAbs)
                    const alpha     = 0.15 + intensity * 0.85
                    const color     = val >= 0
                      ? `rgba(37, 99, 235, ${alpha.toFixed(2)})`
                      : `rgba(220, 38, 38, ${alpha.toFixed(2)})`
                    return (
                      <div
                        key={ni}
                        title={`Neuron ${ni}: ${val.toFixed(4)}`}
                        className="rounded-full transition-colors"
                        style={{ width: 14, height: 14, backgroundColor: color, flexShrink: 0 }}
                      />
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// ─── Explainability Tab ───────────────────────────────────────────────────────

export default function ExplainabilityTab({ model, domainUserId, currentUserName }) {
  const [board, setBoard]           = useState([...EMPTY_BOARD])
  const [qValues, setQValues]       = useState(null)
  const [bestCell, setBestCell]     = useState(null)
  const [loading, setLoading]       = useState(false)
  const [openingBook, setOpeningBook] = useState(null)
  const [obLoading, setObLoading]   = useState(false)
  const [activeSection, setSection] = useState('position')

  const isNeuralNet = model.algorithm === 'DQN' || model.algorithm === 'ALPHA_ZERO'

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
        {[
          ['position', 'Position Analysis'],
          ['opening', 'Opening Book'],
          ['diff', 'Version Diff'],
          ['hypersearch', 'Hyperparam Search'],
          ['opponent', 'Opponent Model'],
          ...(isNeuralNet ? [['activations', 'Network Activations']] : []),
        ].map(([s, label]) => (
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
      {activeSection === 'hypersearch' && <HyperparamSearchPanel model={model} />}
      {activeSection === 'opponent' && <OpponentModelPanel model={model} board={board} qValues={qValues} domainUserId={domainUserId} currentUserName={currentUserName} />}
      {activeSection === 'activations' && isNeuralNet && <NetworkActivationsPanel model={model} />}
    </div>
  )
}
