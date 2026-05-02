// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useState, useEffect, useRef } from 'react'
import {
  LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import { api } from '../../lib/api.js'
import { getToken } from '../../lib/getToken.js'
import { useEventStream } from '../../lib/useEventStream.js'
import {
  Card, SectionLabel, MiniStat, ChartPanel, Btn, Spinner, tooltipStyle, playerLabel,
} from './gymShared.jsx'

// ─── Benchmark Panel ──────────────────────────────────────────────────────────

function BenchmarkPanel({ model }) {
  const [benchmarks, setBenchmarks] = useState([])
  const [running, setRunning] = useState(false)
  const [activeBid, setActiveBid] = useState(null)

  useEffect(() => {
    api.ml.listBenchmarks(model.id).then(r => setBenchmarks(r.benchmarks))
  }, [model.id])

  async function handleRun() {
    const token = await getToken()
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
    { key: 'vsTough',  label: 'vs Tough AI' },
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
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Running 5,000 benchmark games…</span>
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
                        <span className={`badge ${sig ? 'badge-open' : 'badge-closed'}`}>
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

// ─── ELO Panel ────────────────────────────────────────────────────────────────

function EloPanel({ model }) {
  const [history, setHistory] = useState([])

  useEffect(() => {
    api.ml.getEloHistory(model.id).then(r => setHistory(r.history))
  }, [model.id])

  const chartData = history.map((h, i) => ({ i: i + 1, elo: Math.round(h.eloRating), delta: h.delta }))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <MiniStat label="Current ELO" value={history.length > 0 ? Math.round(history[history.length - 1].eloRating) : '—'} color="var(--color-blue-600)" />
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

// ─── Versus Panel ─────────────────────────────────────────────────────────────

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
      const token = await getToken()
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
                <span className={`badge ${result.pValue <= 0.05 ? 'badge-open' : 'badge-closed'}`}>
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

// ─── Tournament Panel ─────────────────────────────────────────────────────────

function TournamentPanel({ models }) {
  const [selected, setSelected] = useState([])
  const [gamesPerPair, setGamesPerPair] = useState(50)
  const [running, setRunning] = useState(false)
  const [tournament, setTournament] = useState(null)
  const [history, setHistory] = useState([])
  const tournamentIdRef = useRef(null)

  useEffect(() => {
    api.ml.listTournaments().then(r => setHistory(r.tournaments))
  }, [])

  function toggleModel(id) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function handleTournamentComplete(tournamentId) {
    if (tournamentId !== tournamentIdRef.current) return
    api.ml.getTournament(tournamentId).then(r => {
      setTournament(r.tournament)
      setRunning(false)
      setHistory(prev => [r.tournament, ...prev.filter(x => x.id !== r.tournament.id)])
    })
  }

  useEventStream({
    channels:   ['ml:tournament:'],
    eventTypes: ['ml:tournament:tournament_complete'],
    enabled:    running,
    onEvent: (channel, payload) => {
      if (channel === 'ml:tournament:tournament_complete') handleTournamentComplete(payload?.tournamentId)
    },
  })

  async function handleRun() {
    if (selected.length < 2) return
    setRunning(true)
    const token = await getToken()
    try {
      const { tournament: t } = await api.ml.startTournament({ modelIds: selected, gamesPerPair }, token)
      tournamentIdRef.current = t.id
      setTournament({ ...t, status: 'RUNNING' })
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

// ─── Player Profiles Panel ────────────────────────────────────────────────────

function MiniBoard({ counts }) {
  const values = Array.from({ length: 9 }, (_, i) => Number(counts[i] || 0))
  const maxVal = Math.max(...values, 1)
  return (
    <div className="grid grid-cols-3 gap-0.5 w-[90px]">
      {values.map((v, i) => {
        const intensity = v / maxVal
        const alpha = 0.1 + intensity * 0.9
        return (
          <div
            key={i}
            title={`Cell ${i + 1}: ${v} times`}
            className="rounded"
            style={{
              width: 28,
              height: 28,
              backgroundColor: `rgba(37, 99, 235, ${alpha.toFixed(2)})`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 9,
              color: intensity > 0.5 ? 'white' : 'var(--text-muted)',
              fontWeight: 600,
            }}
          >
            {v > 0 ? v : ''}
          </div>
        )
      })}
    </div>
  )
}

function TendencyBar({ label, value }) {
  const pct = Math.round((value || 0) * 100)
  return (
    <div>
      <div className="flex justify-between text-xs mb-0.5" style={{ color: 'var(--text-secondary)' }}>
        <span>{label}</span>
        <span className="font-mono font-semibold">{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-gray-200)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: 'var(--color-blue-500)' }} />
      </div>
    </div>
  )
}

function PlayerProfilesPanel({ model, domainUserId, currentUserName }) {
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(null)

  useEffect(() => {
    setLoading(true)
    api.ml.getPlayerProfiles(model.id)
      .then(r => setProfiles(r.profiles))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [model.id])

  function toggleRow(id) {
    setExpanded(prev => prev === id ? null : id)
  }

  return (
    <Card>
      <SectionLabel>Player Profiles</SectionLabel>
      <p className="text-xs mt-1 mb-3" style={{ color: 'var(--text-muted)' }}>
        Move pattern profiles recorded from human players who played this model. Profiles adapt the AI's responses per player.
      </p>

      {loading && <div className="flex justify-center py-6"><Spinner /></div>}

      {!loading && profiles.length === 0 && (
        <p className="text-sm py-6 text-center" style={{ color: 'var(--text-muted)' }}>
          No player profiles yet. Play a game against this ML model while signed in to start building profiles.
        </p>
      )}

      {!loading && profiles.length > 0 && (
        <div className="space-y-2">
          {/* Header row */}
          <div className="grid gap-3 text-xs font-semibold uppercase tracking-wide px-3 py-1"
            style={{ color: 'var(--text-muted)', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr' }}>
            <span>Player</span>
            <span>Games</span>
            <span>Center %</span>
            <span>Corner %</span>
            <span>Since</span>
          </div>

          {profiles.map(p => {
            const tendencies = p.tendencies || {}
            const isExpanded = expanded === p.id
            return (
              <div key={p.id} className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border-default)' }}>
                {/* Summary row */}
                <button
                  onClick={() => toggleRow(p.id)}
                  className="w-full grid gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-[var(--bg-surface-hover)]"
                  style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', backgroundColor: 'var(--bg-base)' }}
                >
                  <span className="text-xs truncate font-medium" style={{ color: 'var(--text-secondary)' }} title={playerLabel(p, domainUserId, currentUserName)}>
                    {playerLabel(p, domainUserId, currentUserName)}
                  </span>
                  <span className="font-bold" style={{ color: 'var(--color-blue-600)' }}>{p.gamesRecorded}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{Math.round((tendencies.centerRate || 0) * 100)}%</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{Math.round((tendencies.cornerRate || 0) * 100)}%</span>
                  <span style={{ color: 'var(--text-muted)' }}>{new Date(p.createdAt).toLocaleDateString()}</span>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-4 py-4 border-t space-y-4" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}>
                    <div className="flex flex-wrap gap-8 items-start">
                      {/* Opening preferences heatmap */}
                      <div>
                        <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>Opening Preferences</p>
                        {Object.keys(p.openingPreferences || {}).length > 0 ? (
                          <MiniBoard counts={p.openingPreferences} />
                        ) : (
                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No opening data yet</p>
                        )}
                      </div>

                      {/* Tendencies bars */}
                      <div className="flex-1 min-w-[180px] space-y-2">
                        <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>Move Tendencies</p>
                        <TendencyBar label="Center rate" value={tendencies.centerRate} />
                        <TendencyBar label="Corner rate" value={tendencies.cornerRate} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// ─── Evaluation Tab ───────────────────────────────────────────────────────────

export default function EvaluationTab({ model, models, domainUserId, currentUserName }) {
  const [section, setSection] = useState('benchmark')

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {[
          ['benchmark', 'Benchmark'],
          ['elo', 'ELO History'],
          ['versus', 'Head-to-Head'],
          ['tournament', 'Tournament'],
          ['profiles', 'Player Profiles'],
        ].map(([s, label]) => (
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
      {section === 'profiles'   && <PlayerProfilesPanel model={model} domainUserId={domainUserId} currentUserName={currentUserName} />}
    </div>
  )
}
