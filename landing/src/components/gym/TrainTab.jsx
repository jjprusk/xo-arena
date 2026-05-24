// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useState, useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import {
  LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts'
import { api } from '../../lib/api.js'
import { getToken } from '../../lib/getToken.js'
import { useEventStream } from '../../lib/useEventStream.js'
import { useOptimisticSession } from '../../lib/useOptimisticSession.js'
import { useFeatures } from '../../lib/useFeatures.js'
import { runTrainingSession } from '../../services/trainingService.js'
import { useGymStore } from '../../store/gymStore.js'
import {
  MODES, DIFFICULTIES, ALGORITHMS, normalizeAlgorithm,
  Card, SectionLabel, Btn, StatusBadge, Spinner, MiniStat, ChartPanel, tooltipStyle,
} from './gymShared.jsx'
import StackedCurvesChart from './StackedCurvesChart.jsx'

const ITERATIONS_MIN = 100
const ITERATIONS_MAX = 100_000
const ITERATIONS_STEP = 100

export default function TrainTab({ model, sessions, onSessionsChange, onComplete }) {
  const [mode, setMode]                     = useState('SELF_PLAY')
  const [iterations, setIterations]         = useState(1000)
  const [difficulty, setDifficulty]         = useState('intermediate')
  const [mlMark, setMlMark]                 = useState('alternating')
  const algorithm = normalizeAlgorithm(model.algorithm)
  const [curriculum, setCurriculum]         = useState(false)
  const [earlyStopEnabled, setEarlyStop]    = useState(false)
  const [patience, setPatience]             = useState(200)
  const [minDelta, setMinDelta]             = useState(0.01)
  // Epsilon config (all models except AlphaZero)
  const [epsilonDecay, setEpsilonDecay]           = useState(0.995)
  const [epsilonMin, setEpsilonMin]               = useState(0.05)
  const [decayMethod, setDecayMethod]             = useState('exponential')
  const [resetEpsilon, setResetEpsilon]           = useState(true)
  // DQN-specific config
  const [dqnBatchSize, setDqnBatchSize]           = useState(32)
  const [dqnReplayBuffer, setDqnReplayBuffer]     = useState(10000)
  const [dqnTargetUpdate, setDqnTargetUpdate]     = useState(100)
  const [dqnLayers, setDqnLayers]                 = useState(() => model.config?.networkShape ?? [32])
  const [dqnGamma, setDqnGamma]                   = useState(0.9)
  // AlphaZero-specific config
  const [azSimulations, setAzSimulations]   = useState(50)
  const [azCPuct, setAzCPuct]               = useState(1.5)
  const [azTemperature, setAzTemperature]   = useState(1.0)
  const [running, setRunning]               = useState(false)
  const setTraining = useGymStore(s => s.setTraining)
  // Keep gymStore in sync so the global idle-logout timer suppresses during training
  function startRunning()  { setRunning(true);  setTraining(true)  }
  function stopRunning()   { setRunning(false); setTraining(false) }
  const [sessionId, setSessionId]           = useState(null)
  const [progress, setProgress]             = useState(null)
  const [chartData, setChartData]           = useState([])
  const [curriculumDifficulty, setCurriculumDifficulty] = useState(null)
  // A3b.10 — true when the runtime resolver routes this (game, algo) to
  // 'worker' or 'backend-in-process'. We show a "Training in background —
  // you can close this tab" affordance because the loop is no longer
  // bound to this browser session (worker survives tab close, in-process
  // backend survives navigation as long as the backend stays up).
  const [backgroundMode, setBackgroundMode] = useState(false)
  // A3b.8 — no-knobs disclosure. Default v1 surface is presets-only
  // (Quick / Standard / Deep); the full knob set is hidden behind an
  // Advanced gate visible only to admins or to users whose env has
  // `features.trainingAdvancedKnobs` flipped on in SystemConfig.
  const { data: session }       = useOptimisticSession()
  const { features }            = useFeatures()
  const isAdmin                 = session?.user?.role === 'admin'
  const showAdvanced            = isAdmin || !!features.trainingAdvancedKnobs
  const [preset, setPreset]     = useState('quick')
  const [presetOptions, setPresetOptions] = useState([])
  // Fetch the preset table for this (game, algorithm). The endpoint
  // returns { name, iterations, expectedDurationMs } per preset; we
  // use it to seed both the picker labels and the default iterations.
  useEffect(() => {
    let cancelled = false
    api.ml.getPresets(model.gameId, algorithm)
      .then(r => {
        if (cancelled) return
        const opts = r?.presets ?? []
        setPresetOptions(opts)
        // Seed iterations from the selected preset on first load so the
        // hidden slider has a sensible value when advanced is closed.
        const match = opts.find(p => p.name === preset) ?? opts[0]
        if (match) {
          setIterations(match.iterations)
          if (!opts.find(p => p.name === preset)) setPreset(match.name)
        }
      })
      .catch(() => { /* preset endpoint failure → keep default iterations */ })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.gameId, algorithm])
  const cleanupRef   = useRef(null)
  const cancelRef    = useRef(false)
  // Set by the resume-watch effect when a backend-driven session is running.
  // The hook below subscribes to its progress channel.
  const handlersRef  = useRef(null)
  const [watchedSessionId, setWatchedSessionId] = useState(null)

  useEventStream({
    channels:   watchedSessionId ? [`training:${watchedSessionId}:`] : [],
    eventTypes: watchedSessionId
      ? [
          `training:${watchedSessionId}:progress`,
          `training:${watchedSessionId}:curriculum_advance`,
          `training:${watchedSessionId}:complete`,
          `training:${watchedSessionId}:cancelled`,
          `training:${watchedSessionId}:error`,
        ]
      : [],
    enabled: !!watchedSessionId,
    onEvent: (channel, payload) => {
      const h = handlersRef.current
      if (!h) return
      if (channel.endsWith(':progress'))            h.onProgress(payload)
      else if (channel.endsWith(':curriculum_advance')) h.onCurriculumAdvance(payload)
      else if (channel.endsWith(':complete'))       h.onComplete()
      else if (channel.endsWith(':cancelled'))      h.onCancelled()
      else if (channel.endsWith(':error'))          h.onError(payload)
    },
  })

  useEffect(() => {
    return () => {
      cleanupRef.current?.()
      cancelRef.current = true
    }
  }, [])

  // Re-attach to in-progress training when navigating back to the page.
  // Frontend sessions can't resume after navigation — auto-cancel them.
  useEffect(() => {
    if (model.status !== 'TRAINING' || running) return
    let cancelled = false

    api.ml.getSessions(model.id).then(async r => {
      if (cancelled) return
      const runningSession = r.sessions.find(s => s.status === 'RUNNING')
      if (!runningSession) return

      onSessionsChange(r.sessions)

      // Frontend session left running after navigation — clean it up
      if (runningSession.config?.frontend) {
        const tok = await getToken().catch(() => null)
        if (tok) api.ml.cancelSession(runningSession.id, tok).catch(() => {})
        return
      }

      setSessionId(runningSession.id)
      setIterations(runningSession.iterations)
      startRunning()
      setProgress(null)
      setChartData([])
      setCurriculumDifficulty(runningSession.config?.difficulty ?? null)

      const onProgress = (data) => {
        if (data.sessionId !== runningSession.id) return
        setProgress(data)
        setChartData(prev => [...prev, {
          ep: data.episode,
          winRate:  Math.round(data.winRate  * 100),
          lossRate: Math.round(data.lossRate * 100),
          drawRate: Math.round(data.drawRate * 100),
          epsilon: parseFloat((data.epsilon * 100).toFixed(1)),
          qDelta: data.avgQDelta,
        }])
      }
      const onCurriculumAdvance = (data) => {
        if (data.sessionId !== runningSession.id) return
        setCurriculumDifficulty(data.difficulty)
      }
      const onComplete_  = () => { stopRunning(); cleanupRef.current?.(); onComplete() }
      const onCancelled  = () => { stopRunning(); cleanupRef.current?.(); onComplete() }
      const onError      = (d) => { stopRunning(); alert(`Training failed: ${d?.error}`); cleanupRef.current?.() }

      // Stash for the SSE useEventStream subscription above to invoke.
      handlersRef.current = { onProgress, onCurriculumAdvance, onComplete: onComplete_, onCancelled, onError }

      setWatchedSessionId(runningSession.id)
      cleanupRef.current = () => {
        setWatchedSessionId(null)
        handlersRef.current = null
        cleanupRef.current = null
      }
    }).catch(() => {})

    return () => { cancelled = true }
  }, [model.id, model.status, running, onComplete])

  async function handleStart() {
    cleanupRef.current?.()
    cleanupRef.current = null
    cancelRef.current = false

    // Show the progress panel immediately before the API call
    flushSync(() => {
      startRunning()
      setProgress(null)
      setChartData([])
      setCurriculumDifficulty(null)
      setBackgroundMode(false)
    })

    // A3b.10 — consult the runtime matrix BEFORE deciding the request
    // shape. TTT q-learning/sarsa/monte_carlo stays in the browser
    // (fastest path, no server cycles). DQN/AlphaZero and all Connect 4
    // algorithms get pushed to the worker so the loop survives tab close.
    // Lookup failures fall back to the legacy frontend path so a
    // backend hiccup never blocks the user from training.
    let runtime = 'frontend'
    try {
      const r = await api.ml.getRuntime(model.gameId, algorithm)
      if (r?.runtime === 'worker' || r?.runtime === 'backend-in-process') runtime = r.runtime
      else if (r?.runtime === 'frontend') runtime = 'frontend'
    } catch {
      // Resolver unreachable — fall through to frontend. Better to train
      // in the browser than to refuse with a confusing error.
    }

    const token = await getToken()
    const cfg = {
      ...(mode === 'VS_MINIMAX' ? { difficulty: curriculum ? 'novice' : difficulty, mlMark: mlMark === 'alternating' ? undefined : mlMark } : {}),
      algorithm,
      ...(curriculum ? { curriculum: true } : {}),
      ...(earlyStopEnabled ? { earlyStop: { patience, minDelta } } : {}),
      ...(algorithm !== 'ALPHA_ZERO' ? { epsilonDecay, epsilonMin, decayMethod, ...(resetEpsilon ? { currentEpsilon: 1.0 } : {}) } : {}),
      ...(algorithm === 'DQN' ? { batchSize: dqnBatchSize, replayBufferSize: dqnReplayBuffer, targetUpdateFreq: dqnTargetUpdate, networkShape: dqnLayers, gamma: dqnGamma } : {}),
      ...(algorithm === 'ALPHA_ZERO' ? { numSimulations: azSimulations, cPuct: azCPuct, temperature: azTemperature } : {}),
    }
    try {
      // A3b.10 — backend-driven runtimes ('worker' / 'backend-in-process')
      // mint the session on the server and skip the local episode loop
      // entirely. The existing SSE subscription (watchedSessionId) picks
      // up progress events the backend / worker publishes to
      // training:<sessionId>:progress.
      if (runtime !== 'frontend') {
        const { session } = await api.ml.train(model.id, { mode, iterations, config: cfg }, token)
        flushSync(() => {
          onSessionsChange(prev => [session, ...prev])
          setSessionId(session.id)
          setWatchedSessionId(session.id)
          setBackgroundMode(true)
          if (curriculum && mode === 'VS_MINIMAX') setCurriculumDifficulty('novice')
        })
        // Hook up SSE callbacks. The watcher consumes the same progress
        // payload shape as the frontend loop's onProgress, so we just
        // mirror that branch's transform here.
        handlersRef.current = {
          onProgress: (data) => {
            flushSync(() => {
              setProgress({ ...data, sessionId: session.id })
              setChartData(prev => [...prev, {
                ep: data.episode,
                winRate:  Math.round(data.winRate  * 100),
                lossRate: Math.round(data.lossRate * 100),
                drawRate: Math.round(data.drawRate * 100),
                recentWinRate:  Math.round((data.recentWinRate  ?? data.winRate)  * 100),
                recentLossRate: Math.round((data.recentLossRate ?? data.lossRate) * 100),
                recentDrawRate: Math.round((data.recentDrawRate ?? data.drawRate) * 100),
                epsilon: parseFloat((data.epsilon * 100).toFixed(1)),
                qDelta: data.avgQDelta,
              }])
            })
          },
          onCurriculumAdvance: ({ difficulty: newDiff }) => setCurriculumDifficulty(newDiff),
          onComplete:  () => { stopRunning(); setWatchedSessionId(null); onComplete() },
          onCancelled: () => { stopRunning(); setWatchedSessionId(null); onComplete() },
          onError:     (payload) => { stopRunning(); setWatchedSessionId(null); alert(payload?.message ?? 'Training failed') },
        }
        return
      }

      // Frontend runtime — existing in-browser loop. Create the session
      // (frontend:true), fetch current weights, run episodes locally,
      // then post the final weights via finishSession.
      const { session, model: modelState } = await api.ml.train(model.id, { mode, iterations, config: cfg, frontend: true }, token)

      flushSync(() => {
        onSessionsChange(prev => [session, ...prev])
        setSessionId(session.id)
        if (curriculum && mode === 'VS_MINIMAX') setCurriculumDifficulty('novice')
      })

      // Run all episodes locally in the browser
      const result = await runTrainingSession({
        model: modelState,
        session: { ...session, config: cfg },
        cancelRef,
        onProgress: (data) => {
          flushSync(() => {
            setProgress({ ...data, sessionId: session.id })
            setChartData(prev => [...prev, {
              ep: data.episode,
              winRate:  Math.round(data.winRate  * 100),
              lossRate: Math.round(data.lossRate * 100),
              drawRate: Math.round(data.drawRate * 100),
              recentWinRate:  Math.round((data.recentWinRate  ?? data.winRate)  * 100),
              recentLossRate: Math.round((data.recentLossRate ?? data.lossRate) * 100),
              recentDrawRate: Math.round((data.recentDrawRate ?? data.drawRate) * 100),
              epsilon: parseFloat((data.epsilon * 100).toFixed(1)),
              qDelta: data.avgQDelta,
            }])
          })
        },
        onCurriculumAdvance: ({ difficulty: newDiff }) => setCurriculumDifficulty(newDiff),
      })

      // Show 100% while finishSession uploads weights (covers early-stop and normal completion)
      flushSync(() => {
        setProgress(prev => prev ? { ...prev, episode: prev.totalEpisodes } : prev)
      })

      // Persist weights + stats to backend; it handles ELO calibration async.
      // Re-fetch the token here — training can take longer than the JWT TTL (BA default: 15 min),
      // so the token captured at training start may be expired by the time we finish.
      const finishToken = await getToken()
      await api.ml.finishSession(session.id, {
        weights:    result.weights,
        stats:      result.stats,
        iterations: result.iterations,
        status:     result.status,
        samples:    result.samples,
      }, finishToken)

      stopRunning()
      onComplete()
    } catch (err) {
      stopRunning()
      alert(err.message)
    }
  }

  // A3b.8 — preset selection writes through to iterations so the kickoff
  // sends the right episode count whether the advanced slider is visible
  // or hidden.
  function selectPreset(name) {
    setPreset(name)
    const opt = presetOptions.find(p => p.name === name)
    if (opt) setIterations(opt.iterations)
  }

  async function handleCancel() {
    // A3b.10 — backend-driven sessions can't be cancelled by flipping a
    // local ref (the loop runs in another process). Issue an explicit
    // cancel request; the SSE 'cancelled' event will tear down state.
    if (backgroundMode && sessionId) {
      try { await api.ml.cancelSession(sessionId, await getToken()) } catch {}
      return
    }
    // Frontend path — signal the local loop to stop; handleStart's
    // runTrainingSession reads cancelRef on each episode and bails out,
    // then calls finishSession with CANCELLED.
    cancelRef.current = true
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
              <select
                value={mode}
                onChange={e => { setMode(e.target.value); setCurriculum(false) }}
                className="form-select"
              >
                {MODES.map(m => <option key={m.value} value={m.value}>{m.label} — {m.desc}</option>)}
              </select>
            </div>

            {/* VS_MINIMAX options: difficulty + play as. Behind the A3b.8
                advanced gate — v1 presets-only surface hides these. */}
            {showAdvanced && mode === 'VS_MINIMAX' && (
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="text-sm font-medium block mb-2" style={{ color: 'var(--text-secondary)' }}>
                    {curriculum ? 'Starting difficulty' : 'Difficulty'}
                    {curriculum && <span className="ml-1 text-xs font-normal" style={{ color: 'var(--text-muted)' }}>(locked to Easy — curriculum advances automatically)</span>}
                  </label>
                  <select
                    value={curriculum ? 'novice' : difficulty}
                    onChange={e => setDifficulty(e.target.value)}
                    disabled={curriculum}
                    className="form-select"
                  >
                    {DIFFICULTIES.map(d => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium block mb-2" style={{ color: 'var(--text-secondary)' }}>Play as</label>
                  <div className="flex gap-2">
                    {[{ v: 'X', label: 'X' }, { v: 'O', label: 'O' }, { v: 'alternating', label: '±' }].map(({ v, label }) => (
                      <button key={v} onClick={() => setMlMark(v)}
                        title={v === 'alternating' ? 'Alternate X/O each episode' : `Always play as ${v}`}
                        className={`w-10 py-2 rounded-lg text-sm font-bold border-2 transition-colors ${mlMark === v ? 'border-[var(--color-blue-600)] bg-[var(--color-blue-50)] text-[var(--color-blue-600)]' : 'border-[var(--border-default)]'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Algorithm — fixed at model creation, read-only here */}
            <div>
              <label className="text-sm font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Algorithm</label>
              {(() => { const a = ALGORITHMS.find(x => x.value === algorithm); return (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg border" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}>
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{a?.label}</span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{a?.desc}</span>
                  <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>Set at creation</span>
                </div>
              )})()}</div>

            {/* A3b.8 — preset picker. Default v1 surface — always visible.
                Picking a preset writes through to iterations so the
                kickoff sends the right episode count whether the
                advanced slider is rendered or not. */}
            {presetOptions.length > 0 && (
              <div data-testid="train-preset-picker">
                <label className="text-sm font-medium block mb-2" style={{ color: 'var(--text-secondary)' }}>Preset</label>
                <div className="flex gap-2 flex-wrap">
                  {presetOptions.map(p => {
                    const minutes = Math.round((p.expectedDurationMs ?? 0) / 60000)
                    const eta = minutes < 1
                      ? '<1 min'
                      : minutes < 60
                        ? `~${minutes} min`
                        : `~${Math.round(minutes / 60)} hr`
                    return (
                      <button
                        key={p.name}
                        type="button"
                        data-testid={`train-preset-${p.name}`}
                        onClick={() => selectPreset(p.name)}
                        className={`flex-1 min-w-[120px] py-3 rounded-lg text-sm font-semibold border-2 transition-colors ${preset === p.name ? 'border-[var(--color-blue-600)] bg-[var(--color-blue-50)] text-[var(--color-blue-600)]' : 'border-[var(--border-default)]'}`}
                      >
                        <div className="capitalize">{p.name}</div>
                        <div className="text-xs font-normal opacity-70 tabular-nums">{p.iterations.toLocaleString()} eps · {eta}</div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* A3b.8 — Advanced disclosure. v1 hides the full knob set
                from regular users; only admins or users in an env with
                `features.trainingAdvancedKnobs` see the rest of the
                config (DQN/AlphaZero/epsilon/curriculum/iterations/
                early-stop). Rendered as a single block-level gate so
                the train button stays anchored at the bottom of the
                card regardless. */}
            {showAdvanced && (
              <div
                data-testid="train-advanced-section"
                className="pt-3 border-t"
                style={{ borderColor: 'var(--border-default)' }}
              >
                <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
                  Advanced{!isAdmin && ' (flagged)'}
                </p>
              </div>
            )}

            {/* DQN config fields */}
            {showAdvanced && algorithm === 'DQN' && (() => {
              const storedShape = model.config?.networkShape ?? [32]
              const archChanged = JSON.stringify(dqnLayers) !== JSON.stringify(storedShape)
              const LAYER_SIZES = [8, 16, 32, 64, 128]
              return (
                <div className="space-y-3 p-3 rounded-lg border" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}>
                  <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>DQN Configuration</p>

                  {/* Numeric controls row */}
                  <div className="flex flex-wrap gap-4">
                    <div>
                      <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Batch</label>
                      <input type="number" min="8" max="256" step="8" value={dqnBatchSize}
                        onChange={e => setDqnBatchSize(Number(e.target.value))}
                        className="w-24 text-sm rounded-lg border px-2 py-1 outline-none"
                        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
                    </div>
                    <div>
                      <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Replay buffer</label>
                      <input type="number" min="1000" max="100000" step="1000" value={dqnReplayBuffer}
                        onChange={e => setDqnReplayBuffer(Number(e.target.value))}
                        className="w-28 text-sm rounded-lg border px-2 py-1 outline-none"
                        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
                    </div>
                    <div>
                      <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Target update</label>
                      <input type="number" min="10" max="1000" step="10" value={dqnTargetUpdate}
                        onChange={e => setDqnTargetUpdate(Number(e.target.value))}
                        className="w-24 text-sm rounded-lg border px-2 py-1 outline-none"
                        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
                    </div>
                    <div>
                      <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>
                        Gamma (γ)
                        <span className="ml-1 font-normal" style={{ color: 'var(--text-muted)' }}>(discount)</span>
                      </label>
                      <select value={dqnGamma} onChange={e => setDqnGamma(Number(e.target.value))}
                        className="text-sm rounded-lg border px-2 py-1 outline-none"
                        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
                        <option value={0.85}>0.85</option>
                        <option value={0.90}>0.90 — default</option>
                        <option value={0.95}>0.95 — recommended</option>
                        <option value={0.99}>0.99</option>
                      </select>
                    </div>
                  </div>

                  {/* Network architecture layer builder */}
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                        Network architecture
                        <span className="ml-1 font-normal" style={{ color: 'var(--text-muted)' }}>(input:9 → hidden → output:9)</span>
                      </label>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {dqnLayers.map((size, i) => (
                        <div key={i} className="flex items-center gap-1">
                          <select value={size}
                            onChange={e => setDqnLayers(prev => prev.map((v, j) => j === i ? Number(e.target.value) : v))}
                            className="text-sm rounded-lg border px-2 py-1 outline-none"
                            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
                            {LAYER_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
                          </select>
                          {dqnLayers.length > 1 && (
                            <button onClick={() => setDqnLayers(prev => prev.filter((_, j) => j !== i))}
                              className="text-xs px-1.5 py-1 rounded border"
                              style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}
                              title="Remove layer">×</button>
                          )}
                          {i < dqnLayers.length - 1 && (
                            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>→</span>
                          )}
                        </div>
                      ))}
                      {dqnLayers.length < 3 && (
                        <button onClick={() => setDqnLayers(prev => [...prev, 32])}
                          className="text-xs px-2 py-1 rounded border font-medium"
                          style={{ borderColor: 'var(--color-blue-600)', color: 'var(--color-blue-600)' }}>
                          + Add layer
                        </button>
                      )}
                    </div>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                      Current: [9 → {dqnLayers.join(' → ')} → 9]
                    </p>
                  </div>

                  {/* Architecture changed warning */}
                  {archChanged && (
                    <div className="text-xs px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--color-amber-50)', color: 'var(--color-amber-700)', border: '1px solid var(--color-amber-300)' }}>
                      Architecture changed from [{storedShape.join(', ')}] → [{dqnLayers.join(', ')}] — existing weights will be reset and training starts fresh.
                    </div>
                  )}
                </div>
              )
            })()}

            {/* AlphaZero config fields — advanced */}
            {showAdvanced && algorithm === 'ALPHA_ZERO' && (
              <div className="space-y-3 p-3 rounded-lg border" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}>
                <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>AlphaZero Configuration</p>
                <div className="flex flex-wrap gap-4">
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Simulations</label>
                    <input type="number" min="10" max="500" step="10" value={azSimulations}
                      onChange={e => setAzSimulations(Number(e.target.value))}
                      className="w-24 text-sm rounded-lg border px-2 py-1 outline-none"
                      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
                  </div>
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>PUCT</label>
                    <input type="number" min="0.1" max="5" step="0.1" value={azCPuct}
                      onChange={e => setAzCPuct(Number(e.target.value))}
                      className="w-20 text-sm rounded-lg border px-2 py-1 outline-none"
                      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
                  </div>
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Temperature</label>
                    <input type="number" min="0.1" max="2.0" step="0.1" value={azTemperature}
                      onChange={e => setAzTemperature(Number(e.target.value))}
                      className="w-20 text-sm rounded-lg border px-2 py-1 outline-none"
                      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
                  </div>
                </div>
              </div>
            )}


            {/* Epsilon config (all models except AlphaZero) — advanced */}
            {showAdvanced && algorithm !== 'ALPHA_ZERO' && (
              <div className="space-y-3 p-3 rounded-lg border" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}>
                <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Exploration</p>

                {/* Decay method */}
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Decay schedule</label>
                  <div className="flex gap-2">
                    {[
                      { v: 'exponential', label: 'Exponential', hint: 'ε × rate each step' },
                      { v: 'linear',      label: 'Linear',      hint: 'straight line to min' },
                      { v: 'cosine',      label: 'Cosine',      hint: 'smooth S-curve to min' },
                    ].map(({ v, label, hint }) => (
                      <button key={v} onClick={() => setDecayMethod(v)}
                        title={hint}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border-2 transition-colors ${decayMethod === v ? 'border-[var(--color-blue-600)] bg-[var(--color-blue-50)] text-[var(--color-blue-600)]' : 'border-[var(--border-default)]'}`}
                        style={{ color: decayMethod === v ? undefined : 'var(--text-secondary)' }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap gap-4">
                  {/* Rate multiplier — only meaningful for exponential */}
                  {decayMethod === 'exponential' && (
                    <div>
                      <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>
                        Rate
                        <span className="ml-1 font-normal" style={{ color: 'var(--text-muted)' }}>(0.99–0.9999)</span>
                      </label>
                      <input type="number" min="0.99" max="0.9999" step="0.0001" value={epsilonDecay}
                        onChange={e => setEpsilonDecay(Number(e.target.value))}
                        className="w-28 text-sm rounded-lg border px-2 py-1 outline-none"
                        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
                    </div>
                  )}
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>
                      Epsilon min
                      <span className="ml-1 font-normal" style={{ color: 'var(--text-muted)' }}>(floor)</span>
                    </label>
                    <input type="number" min="0.01" max="0.5" step="0.01" value={epsilonMin}
                      onChange={e => setEpsilonMin(Number(e.target.value))}
                      className="w-24 text-sm rounded-lg border px-2 py-1 outline-none"
                      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
                  </div>
                </div>

                {/* Reset epsilon checkbox */}
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="resetEps" checked={resetEpsilon} onChange={e => setResetEpsilon(e.target.checked)}
                    className="accent-[var(--color-blue-600)]" />
                  <label htmlFor="resetEps" className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    Reset ε to 1.0 at start
                    <span className="ml-1" style={{ color: 'var(--text-muted)' }}>(recommended — otherwise continues from saved ε)</span>
                  </label>
                </div>

                {/* Schedule hint */}
                {decayMethod === 'exponential' && (() => {
                  const epsAtMin = Math.ceil(Math.log(epsilonMin) / Math.log(epsilonDecay))
                  const pct = Math.min(100, Math.round((epsAtMin / iterations) * 100))
                  return (
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      Reaches min after ~<span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>
                        {epsAtMin.toLocaleString()}
                      </span> episodes ({pct}% of your {iterations.toLocaleString()} iterations)
                    </p>
                  )
                })()}
                {decayMethod === 'linear' && (
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Decreases at a constant rate, reaching min at exactly {iterations.toLocaleString()} episodes
                  </p>
                )}
                {decayMethod === 'cosine' && (
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Starts slow, accelerates in the middle, slows again — reaches min at {iterations.toLocaleString()} episodes
                  </p>
                )}
              </div>
            )}

            {/* Curriculum learning (VS_MINIMAX only — advances Easy→Medium→Hard) — advanced */}
            {showAdvanced && mode === 'VS_MINIMAX' && (
              <div className="flex items-center gap-3">
                <input type="checkbox" id="curriculum" checked={curriculum} onChange={e => setCurriculum(e.target.checked)}
                  className="accent-[var(--color-blue-600)]" />
                <label htmlFor="curriculum" className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Curriculum learning — auto-advance Easy → Medium → Hard when win rate &gt; 65%
                </label>
              </div>
            )}

            {/* Iterations slider — advanced; the preset picker above
                writes through to the same state so users get the right
                episode count without seeing the slider. */}
            {showAdvanced && (() => {
              const remaining = model.maxEpisodes > 0 ? model.maxEpisodes - model.totalEpisodes : Infinity
              const atLimit = remaining <= 0
              const sliderMax = remaining === Infinity ? ITERATIONS_MAX : Math.max(ITERATIONS_MIN, Math.min(ITERATIONS_MAX, remaining))
              const displayIterations = Math.min(iterations, sliderMax)
              return (
                <div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2">
                    <label className="text-sm font-medium flex-1" style={{ color: 'var(--text-secondary)' }}>Iterations</label>
                    <div className="flex items-center gap-2">
                      {model.maxEpisodes > 0 && (
                        <span className="text-xs tabular-nums" style={{ color: atLimit ? 'var(--color-red-600)' : remaining < 10_000 ? 'var(--color-amber-600)' : 'var(--text-muted)' }}>
                          {atLimit ? 'Limit reached' : `${remaining.toLocaleString()} left`}
                        </span>
                      )}
                      <input
                        type="number"
                        min={ITERATIONS_MIN} max={sliderMax} step={ITERATIONS_STEP}
                        value={displayIterations}
                        disabled={atLimit}
                        onChange={e => {
                          const v = Number(e.target.value)
                          if (!isNaN(v)) setIterations(Math.max(ITERATIONS_MIN, Math.min(sliderMax, v)))
                        }}
                        className="w-24 px-2 py-0.5 rounded text-sm font-bold tabular-nums text-right disabled:opacity-40"
                        style={{ color: 'var(--text-primary)', backgroundColor: 'var(--bg-surface-hover)', border: '1px solid var(--border-default)' }}
                      />
                    </div>
                  </div>
                  <input type="range" min={ITERATIONS_MIN} max={sliderMax} step={ITERATIONS_STEP} value={displayIterations}
                    onChange={e => setIterations(Number(e.target.value))}
                    disabled={atLimit}
                    className="w-full accent-[var(--color-blue-600)] disabled:opacity-40" />
                  <div className="flex justify-between text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    <span>{ITERATIONS_MIN.toLocaleString()}</span><span>{sliderMax.toLocaleString()}</span>
                  </div>
                </div>
              )
            })()}

            {/* Early stopping — advanced */}
            {showAdvanced && (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <input type="checkbox" id="earlyStop" checked={earlyStopEnabled} onChange={e => setEarlyStop(e.target.checked)}
                  className="accent-[var(--color-blue-600)]" />
                <label htmlFor="earlyStop" className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Early stopping
                </label>
              </div>
              {earlyStopEnabled && (
                <div className="ml-6 flex flex-wrap gap-4">
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Patience (episodes)</label>
                    <input type="number" min="50" max="10000" step="50" value={patience}
                      onChange={e => setPatience(Number(e.target.value))}
                      className="w-24 text-sm rounded-lg border px-2 py-1 outline-none"
                      style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
                  </div>
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-secondary)' }}>Min delta</label>
                    <input type="number" min="0.001" max="0.1" step="0.001" value={minDelta}
                      onChange={e => setMinDelta(Number(e.target.value))}
                      className="w-24 text-sm rounded-lg border px-2 py-1 outline-none"
                      style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
                  </div>
                </div>
              )}
            </div>
            )}

            <Btn onClick={handleStart} disabled={running || (model.maxEpisodes > 0 && model.totalEpisodes >= model.maxEpisodes)}>
              {model.maxEpisodes > 0 && model.totalEpisodes >= model.maxEpisodes ? 'Episode limit reached' : 'Start Training'}
            </Btn>
          </div>
        </Card>
      )}

      {/* Live progress */}
      {running && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <SectionLabel>{sessionId ? 'Training in Progress' : 'Starting…'}</SectionLabel>
              {curriculumDifficulty && (
                <span className={`badge capitalize ${{novice:'badge-bot',intermediate:'badge-closed',advanced:'badge-cancelled'}[curriculumDifficulty] || 'badge-cancelled'}`}>
                  {curriculumDifficulty}
                </span>
              )}
            </div>
            <Btn onClick={handleCancel} variant="ghost">Cancel</Btn>
          </div>

          {/* A3b.10 — background-mode affordance. Shown when the runtime
              resolver routes this (game, algo) to worker or in-process,
              meaning the loop is decoupled from this tab. */}
          {backgroundMode && (
            <div
              role="status"
              data-testid="train-background-banner"
              className="mb-4 px-3 py-2 rounded-lg text-xs flex items-start gap-2"
              style={{ backgroundColor: 'var(--bg-base)', borderLeft: '3px solid var(--color-blue-600)' }}
            >
              <span aria-hidden="true">⚡</span>
              <div>
                <strong style={{ color: 'var(--text-primary)' }}>Training in background.</strong>{' '}
                <span style={{ color: 'var(--text-secondary)' }}>
                  You can close this tab — progress streams from the server and the
                  run continues. Come back anytime to see results.
                </span>
              </div>
            </div>
          )}

          {/* Progress bar */}
          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-gray-200)' }}>
              <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: 'var(--color-blue-600)' }} />
            </div>
            <span className="text-xs font-mono font-semibold tabular-nums w-9 text-right" style={{ color: 'var(--text-secondary)' }}>{pct}%</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <MiniStat label="Episode" value={progress ? `${progress.episode.toLocaleString()} / ${progress.totalEpisodes.toLocaleString()}` : `0 / ${iterations.toLocaleString()}`} />
            <MiniStat label="Win Rate" value={progress ? `${Math.round(progress.winRate * 100)}%` : '—'} color="var(--color-teal-600)" />
            <MiniStat label="Epsilon ε" value={progress ? progress.epsilon.toFixed(4) : '1.0000'} color="var(--color-amber-600)" />
            <MiniStat label="Avg ΔQ" value={progress ? (progress.avgQDelta === 0 ? '0 ✓' : progress.avgQDelta < 0.0001 ? progress.avgQDelta.toExponential(2) : progress.avgQDelta.toFixed(5)) : '—'} />
            <MiniStat label="Avg game" value={progress?.avgGameMs != null ? `${progress.avgGameMs.toFixed(1)}ms` : '—'} />
          </div>
          <div className="flex gap-4 text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
            <span>Wins (X): <b style={{ color: 'var(--color-teal-600)' }}>{(progress?.outcomes.wins ?? 0).toLocaleString()}</b></span>
            <span>Losses (O wins): <b style={{ color: 'var(--color-red-600)' }}>{(progress?.outcomes.losses ?? 0).toLocaleString()}</b></span>
            <span>Draws: <b style={{ color: 'var(--color-amber-600)' }}>{(progress?.outcomes.draws ?? 0).toLocaleString()}</b></span>
          </div>
          {mode === 'SELF_PLAY' && (
            <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
              Self-play goal: Draw rate → 100% (both sides approaching perfect play). Win rate should <em>decrease</em> as draws increase.
            </p>
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
                  <Line isAnimationActive={false} type="monotone" dataKey="recentWinRate"  stroke="var(--color-teal-600)"  dot={false} name="Win % (recent)"  strokeWidth={2} />
                  <Line isAnimationActive={false} type="monotone" dataKey="recentDrawRate" stroke="var(--color-amber-600)" dot={false} name="Draw % (recent)" strokeWidth={2} />
                  <Line isAnimationActive={false} type="monotone" dataKey="recentLossRate" stroke="var(--color-red-500)"   dot={false} name="Loss % (recent)" strokeWidth={2} />
                  <Line isAnimationActive={false} type="monotone" dataKey="winRate"  stroke="var(--color-teal-600)"  dot={false} name="Win % (avg)"  strokeWidth={1} strokeDasharray="4 2" strokeOpacity={0.45} />
                  <Line isAnimationActive={false} type="monotone" dataKey="drawRate" stroke="var(--color-amber-600)" dot={false} name="Draw % (avg)" strokeWidth={1} strokeDasharray="4 2" strokeOpacity={0.45} />
                  <Line isAnimationActive={false} type="monotone" dataKey="lossRate" stroke="var(--color-red-500)"   dot={false} name="Loss % (avg)" strokeWidth={1} strokeDasharray="4 2" strokeOpacity={0.45} />
                </LineChart>
              </ChartPanel>
              <ChartPanel label="Exploration Rate (ε) Decay">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
                  <XAxis dataKey="ep" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} unit="%" />
                  <Tooltip contentStyle={tooltipStyle} formatter={v => [`${v}%`]} />
                  <Line isAnimationActive={false} type="monotone" dataKey="epsilon" stroke="var(--color-blue-600)" dot={false} name="ε %" strokeWidth={2} />
                </LineChart>
              </ChartPanel>
              {/* A3b.7 — multi-curve eval breakdown. Polls every 5s
                  during live training so curves fill in as eval points
                  land; the component itself renders nothing when no
                  multi-curve data exists (legacy single-opponent
                  sessions). */}
              {sessionId && (
                <StackedCurvesChart sessionId={sessionId} refreshMs={5_000} />
              )}
            </div>
          )}
        </Card>
      )}

      {/* Queued sessions */}
      {sessions.some(s => s.status === 'PENDING') && (
        <Card>
          <SectionLabel>Queued Sessions</SectionLabel>
          <div className="mt-2 space-y-1">
            {sessions.filter(s => s.status === 'PENDING').map(s => (
              <div key={s.id} className="flex items-center justify-between text-xs py-1.5 px-2 rounded-lg"
                style={{ backgroundColor: 'var(--bg-base)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{s.mode.replace('_', ' ')} · {s.iterations.toLocaleString()} eps</span>
                <StatusBadge status="QUEUED" tiny />
              </div>
            ))}
          </div>
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
                <Line type="monotone" dataKey="winRate"  stroke="var(--color-teal-600)"  dot={false} name="Win %"  strokeWidth={2} />
                <Line type="monotone" dataKey="lossRate" stroke="var(--color-blue-500)"   dot={false} name="Loss %" strokeWidth={1} strokeDasharray="4 2" />
                <Line type="monotone" dataKey="drawRate" stroke="var(--color-amber-600)" dot={false} name="Draw %" strokeWidth={1} strokeDasharray="2 3" />
              </LineChart>
            </ChartPanel>
            <ChartPanel label="Q-delta Convergence (→ 0 = converged)">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
                <XAxis dataKey="ep" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="qDelta" stroke="var(--color-blue-600)" dot={false} name="Avg ΔQ" strokeWidth={2} />
              </LineChart>
            </ChartPanel>
            {/* A3b.7 — post-session stacked W/D/L per opponent curve.
                No polling here — the session is done, eval points are
                immutable. Renders nothing when the session has no
                multi-curve metrics (single-opponent legacy sessions). */}
            {sessionId && <StackedCurvesChart sessionId={sessionId} />}
          </div>
        </Card>
      )}
    </div>
  )
}
