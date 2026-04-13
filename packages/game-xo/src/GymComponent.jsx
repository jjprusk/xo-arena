// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useState, useEffect, useRef } from 'react'

const ALGORITHM_LABELS = {
  qlearning:      'Q-Learning',
  sarsa:          'SARSA',
  dqn:            'Deep Q-Network',
  montecarlo:     'Monte Carlo',
  policygradient: 'Policy Gradient',
  alphazero:      'AlphaZero',
}

/**
 * XO Gym — training UI rendered in the platform shell Gym tab.
 * Props match the GymProps interface from @callidity/sdk.
 */
export function GymComponent({ botId, gameId, currentWeights, onTrainingComplete, onProgress }) {
  const [config, setConfig]         = useState(null)
  const [episodes, setEpisodes]     = useState(5000)
  const [algorithm, setAlgorithm]   = useState('qlearning')
  const [params, setParams]         = useState({})
  const [isTraining, setIsTraining] = useState(false)
  const [progressLog, setProgressLog] = useState([])
  const [error, setError]           = useState(null)
  const progressRef = useRef([])

  useEffect(() => {
    import('./botInterface.js').then(m => {
      const cfg = m.botInterface.getTrainingConfig()
      setConfig(cfg)
      // Initialise params from defaults
      const defaults = {}
      Object.entries(cfg.hyperparameters).forEach(([key, def]) => {
        if (key !== 'algorithm') defaults[key] = def.default
      })
      setParams(defaults)
      setAlgorithm(cfg.algorithm)
      setEpisodes(cfg.defaultEpisodes)
    })
  }, [])

  async function handleTrain() {
    if (isTraining) return
    setIsTraining(true)
    setError(null)
    progressRef.current = []
    setProgressLog([])

    try {
      const { botInterface } = await import('./botInterface.js')
      const run = { algorithm, episodes, params: { ...params, algorithm } }

      const result = await botInterface.train(run, currentWeights, (progress) => {
        onProgress?.(progress)
        if (progressRef.current.length === 0 || progress.episode === progress.totalEpisodes ||
            progress.episode % Math.floor(progress.totalEpisodes / 20) === 0) {
          progressRef.current = [...progressRef.current, progress]
          setProgressLog([...progressRef.current])
        }
      })

      onTrainingComplete(result)
    } catch (err) {
      setError(err.message ?? 'Training failed')
    } finally {
      setIsTraining(false)
    }
  }

  if (!config) return <div className="p-4 text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>

  const lastProgress = progressLog[progressLog.length - 1]
  const pct = lastProgress ? Math.round((lastProgress.episode / lastProgress.totalEpisodes) * 100) : 0

  return (
    <div className="flex flex-col gap-6 p-4 max-w-lg">
      <div>
        <h2 className="text-lg font-bold mb-1" style={{ fontFamily: 'var(--font-display)' }}>
          Train Bot Skill
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {currentWeights ? 'Continue training from existing weights.' : 'Start fresh — no prior training.'}
        </p>
      </div>

      {/* Algorithm picker */}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium">Algorithm</label>
        <select
          value={algorithm}
          onChange={e => setAlgorithm(e.target.value)}
          disabled={isTraining}
          className="rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--border-default)', background: 'var(--bg-surface)' }}
        >
          {Object.entries(ALGORITHM_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {/* Episodes */}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium">
          Episodes
          <span className="ml-2 font-normal" style={{ color: 'var(--text-muted)' }}>
            {episodes.toLocaleString()}
          </span>
        </label>
        <input
          type="range"
          min={500}
          max={50000}
          step={500}
          value={episodes}
          onChange={e => setEpisodes(Number(e.target.value))}
          disabled={isTraining}
          className="w-full"
        />
        <div className="flex justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
          <span>500</span><span>50,000</span>
        </div>
      </div>

      {/* Hyperparameters (excluding algorithm — handled above) */}
      <div className="grid grid-cols-2 gap-3">
        {Object.entries(config.hyperparameters)
          .filter(([key]) => key !== 'algorithm')
          .map(([key, def]) => (
            <div key={key} className="flex flex-col gap-1">
              <label className="text-xs font-medium" title={def.description}>{def.label}</label>
              {def.type === 'select' ? (
                <select
                  value={params[key] ?? def.default}
                  onChange={e => setParams(p => ({ ...p, [key]: e.target.value }))}
                  disabled={isTraining}
                  className="rounded border px-2 py-1 text-xs"
                  style={{ borderColor: 'var(--border-default)', background: 'var(--bg-surface)' }}
                >
                  {def.options.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="number"
                  value={params[key] ?? def.default}
                  min={def.min}
                  max={def.max}
                  step={def.step}
                  onChange={e => setParams(p => ({ ...p, [key]: Number(e.target.value) }))}
                  disabled={isTraining}
                  className="rounded border px-2 py-1 text-xs w-full"
                  style={{ borderColor: 'var(--border-default)', background: 'var(--bg-surface)' }}
                />
              )}
            </div>
          ))
        }
      </div>

      {/* Train button */}
      <button
        onClick={handleTrain}
        disabled={isTraining}
        className="btn btn-primary py-3 rounded-xl font-semibold disabled:opacity-50"
      >
        {isTraining ? 'Training…' : 'Start Training'}
      </button>

      {/* Progress */}
      {isTraining && (
        <div className="flex flex-col gap-2">
          <div className="flex justify-between text-sm">
            <span style={{ color: 'var(--text-secondary)' }}>Progress</span>
            <span className="font-medium">{pct}%</span>
          </div>
          <div className="w-full rounded-full h-2" style={{ background: 'var(--bg-surface-hover)' }}>
            <div
              className="h-2 rounded-full transition-all"
              style={{ width: `${pct}%`, background: 'var(--color-primary)' }}
            />
          </div>
          {lastProgress && (
            <div className="text-xs flex gap-4" style={{ color: 'var(--text-muted)' }}>
              <span>ε {lastProgress.epsilon?.toFixed(3) ?? '—'}</span>
              <span>ΔQ {lastProgress.avgQDelta?.toFixed(4) ?? '—'}</span>
              <span>{lastProgress.outcome}</span>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-sm px-3 py-2 rounded-lg" style={{ background: 'var(--color-red-50)', color: 'var(--color-red-600)' }}>
          {error}
        </p>
      )}

      {/* Results summary (after training) */}
      {!isTraining && progressLog.length > 0 && (() => {
        const last = progressLog[progressLog.length - 1]
        if (last.episode < last.totalEpisodes) return null
        return (
          <div className="rounded-xl p-4 flex flex-col gap-2" style={{ background: 'var(--bg-surface-hover)' }}>
            <p className="text-sm font-semibold">Training complete</p>
            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <div><div className="font-bold" style={{ color: 'var(--color-teal-600)' }}>{Math.round((progressLog.reduce((s, p) => s + (p.outcome === 'WIN' ? 1 : 0), 0) / progressLog.length) * 100)}%</div><div style={{ color: 'var(--text-muted)' }}>Win rate</div></div>
              <div><div className="font-bold" style={{ color: 'var(--color-amber-600)' }}>{Math.round((progressLog.reduce((s, p) => s + (p.outcome === 'DRAW' ? 1 : 0), 0) / progressLog.length) * 100)}%</div><div style={{ color: 'var(--text-muted)' }}>Draw rate</div></div>
              <div><div className="font-bold" style={{ color: 'var(--color-red-600)' }}>{Math.round((progressLog.reduce((s, p) => s + (p.outcome === 'LOSS' ? 1 : 0), 0) / progressLog.length) * 100)}%</div><div style={{ color: 'var(--text-muted)' }}>Loss rate</div></div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
