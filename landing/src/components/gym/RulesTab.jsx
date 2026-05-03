// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useState, useEffect } from 'react'
import { api } from '../../lib/api.js'
import { getToken } from '../../lib/getToken.js'
import { Card, SectionLabel } from './gymShared.jsx'

const RULE_META_FRONTEND = {
  win:             { label: 'Win',             desc: 'Complete a two-in-a-row to win immediately' },
  block:           { label: 'Block',           desc: "Stop the opponent's two-in-a-row threat" },
  fork:            { label: 'Fork',            desc: 'Create two simultaneous winning threats' },
  block_fork:      { label: 'Block fork',      desc: 'Deny the opponent a fork opportunity' },
  center:          { label: 'Center',          desc: 'Take the center square for maximum control' },
  opposite_corner: { label: 'Opposite corner', desc: "Play opposite the opponent's corner to neutralise it" },
  corner:          { label: 'Corner',          desc: 'Claim an empty corner' },
  side:            { label: 'Side',            desc: 'Play an empty side square' },
}

export default function RulesTab({ model, models }) {
  const [sourceModels, setSourceModels] = useState([{ modelId: model.id, weight: 1.0 }])
  const [rules, setRules] = useState(null)
  const [analyzed, setAnalyzed] = useState(null)
  const [extracting, setExtracting] = useState(false)
  const [ruleSetName, setRuleSetName] = useState(`${model.name} Rules`)
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState(null)
  const [existingSets, setExistingSets] = useState([])

  useEffect(() => {
    api.ml.listRuleSets().then(r => setExistingSets(r.ruleSets || [])).catch(() => {})
  }, [])

  async function handleExtract() {
    setExtracting(true)
    setRules(null)
    setSavedId(null)
    try {
      const token = await getToken()
      // Create a temporary rule set to trigger extraction, then read the result
      const res = await api.ml.createRuleSet({
        name: '__preview__',
        sourceModels,
      }, token)
      setRules(res.ruleSet.rules)
      setAnalyzed(res.ruleSet)
      // Clean up the temp rule set
      await api.ml.deleteRuleSet(res.ruleSet.id, token)
    } catch (e) {
      alert('Extraction failed: ' + e.message)
    } finally {
      setExtracting(false)
    }
  }

  async function handleSave() {
    if (!rules || !ruleSetName.trim()) return
    setSaving(true)
    try {
      const token = await getToken()
      const res = await api.ml.createRuleSet({ name: ruleSetName, sourceModels, rules }, token)
      setSavedId(res.ruleSet.id)
      setExistingSets(prev => [res.ruleSet, ...prev])
    } catch (e) {
      alert('Save failed: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleReExtract(rs) {
    try {
      const token = await getToken()
      const res = await api.ml.extractRules(rs.id, { sourceModels }, token)
      setExistingSets(prev => prev.map(s => s.id === rs.id ? res.ruleSet : s))
    } catch (e) {
      alert('Re-extraction failed: ' + e.message)
    }
  }

  async function handleDeleteSet(id) {
    if (!confirm('Delete this rule set?')) return
    const token = await getToken()
    await api.ml.deleteRuleSet(id, token)
    setExistingSets(prev => prev.filter(s => s.id !== id))
  }

  async function handleToggleRule(ruleId) {
    setRules(prev => prev.map(r => r.id === ruleId ? { ...r, enabled: !r.enabled } : r))
  }

  function handleMovePriority(ruleId, dir) {
    setRules(prev => {
      const idx = prev.findIndex(r => r.id === ruleId)
      if (idx < 0) return prev
      const next = [...prev]
      const swap = idx + dir
      if (swap < 0 || swap >= next.length) return prev
      ;[next[idx], next[swap]] = [next[swap], next[idx]]
      return next.map((r, i) => ({ ...r, priority: i + 1 }))
    })
  }

  function handleWeightChange(modelId, weight) {
    setSourceModels(prev => prev.map(m => m.modelId === modelId ? { ...m, weight } : m))
  }

  function handleAddModel(modelId) {
    if (sourceModels.find(m => m.modelId === modelId)) return
    setSourceModels(prev => [...prev, { modelId, weight: 1.0 }])
  }

  function handleRemoveModel(modelId) {
    if (sourceModels.length <= 1) return
    setSourceModels(prev => prev.filter(m => m.modelId !== modelId))
  }

  const otherModels = models.filter(m => !sourceModels.find(s => s.modelId === m.id))

  return (
    <div className="space-y-6">

      {/* Source Models */}
      <Card>
        <SectionLabel>Source Models</SectionLabel>
        <p className="text-xs mt-1 mb-3" style={{ color: 'var(--text-muted)' }}>
          Rules are extracted by analysing how each model plays. Add multiple models to create an ensemble.
        </p>
        <div className="space-y-2">
          {sourceModels.map(({ modelId, weight }) => {
            const m = models.find(x => x.id === modelId)
            return (
              <div key={modelId} className="flex items-center gap-3 p-2 rounded-lg border"
                style={{ borderColor: 'var(--border-default)' }}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{m?.name ?? modelId}</div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {m?.algorithm?.toUpperCase()}
                  </div>
                </div>
                {sourceModels.length > 1 && (
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Weight</span>
                    <input
                      type="number" min="0.1" max="10" step="0.1"
                      value={weight}
                      onChange={e => handleWeightChange(modelId, parseFloat(e.target.value) || 1)}
                      className="w-16 px-2 py-1 text-xs rounded border outline-none"
                      style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}
                    />
                  </div>
                )}
                <button
                  onClick={() => handleRemoveModel(modelId)}
                  disabled={sourceModels.length <= 1}
                  className="text-xs px-2 py-1 rounded border transition-colors disabled:opacity-30"
                  style={{ borderColor: 'var(--border-default)', color: 'var(--color-red-600)' }}
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>
        {otherModels.length > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Add model:</span>
            <select
              onChange={e => { if (e.target.value) { handleAddModel(e.target.value); e.target.value = '' } }}
              className="text-xs px-2 py-1 rounded border outline-none flex-1"
              style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}
            >
              <option value="">— select —</option>
              {otherModels.map(m => (
                <option key={m.id} value={m.id}>{m.name} ({m.algorithm?.replace(/_/g, '-')})</option>
              ))}
            </select>
          </div>
        )}
        <button
          onClick={handleExtract}
          disabled={extracting}
          className="mt-3 w-full py-2 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
        >
          {extracting ? 'Extracting…' : rules ? 'Re-extract' : 'Extract Rules'}
        </button>
      </Card>

      {/* Extracted Rules */}
      {rules && (
        <Card>
          <SectionLabel>Extracted Rules</SectionLabel>
          <p className="text-xs mt-1 mb-3" style={{ color: 'var(--text-muted)' }}>
            Rules are listed in priority order. Toggle, reorder, then save as a Rule Set.
          </p>
          <div className="space-y-1">
            {rules.map((rule, idx) => (
              <div
                key={rule.id}
                className="flex items-center gap-2 p-2 rounded-lg border transition-colors"
                style={{
                  borderColor: 'var(--border-default)',
                  backgroundColor: rule.enabled ? 'var(--bg-surface)' : 'var(--bg-page)',
                  opacity: rule.enabled ? 1 : 0.5,
                }}
              >
                {/* Priority badge */}
                <span
                  className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{
                    backgroundColor: rule.enabled ? 'var(--color-blue-600)' : 'var(--color-gray-300)',
                    color: rule.enabled ? 'white' : 'var(--text-muted)',
                  }}
                >
                  {idx + 1}
                </span>

                {/* Label + confidence bar */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {RULE_META_FRONTEND[rule.id]?.label ?? rule.id}
                    </span>
                    <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>
                      {Math.round(rule.confidence * 100)}% · {rule.coverage} states
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-gray-200)' }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.round(rule.confidence * 100)}%`,
                        backgroundColor: rule.confidence > 0.8
                          ? 'var(--color-teal-500)'
                          : rule.confidence > 0.5
                            ? 'var(--color-amber-500)'
                            : 'var(--color-red-400)',
                      }}
                    />
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {RULE_META_FRONTEND[rule.id]?.desc}
                  </div>
                </div>

                {/* Controls */}
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button onClick={() => handleMovePriority(rule.id, -1)} disabled={idx === 0}
                    className="text-xs leading-none px-1 py-0.5 rounded disabled:opacity-30"
                    style={{ color: 'var(--text-muted)' }}>▲</button>
                  <button onClick={() => handleMovePriority(rule.id, 1)} disabled={idx === rules.length - 1}
                    className="text-xs leading-none px-1 py-0.5 rounded disabled:opacity-30"
                    style={{ color: 'var(--text-muted)' }}>▼</button>
                </div>
                <button
                  onClick={() => handleToggleRule(rule.id)}
                  className="shrink-0 text-xs px-2 py-1 rounded border transition-colors"
                  style={{
                    borderColor: rule.enabled ? 'var(--color-teal-600)' : 'var(--border-default)',
                    color: rule.enabled ? 'var(--color-teal-600)' : 'var(--text-muted)',
                  }}
                >
                  {rule.enabled ? 'On' : 'Off'}
                </button>
              </div>
            ))}
          </div>

          {/* Save */}
          <div className="mt-4 flex gap-2">
            <input
              type="text"
              value={ruleSetName}
              onChange={e => setRuleSetName(e.target.value)}
              placeholder="Rule set name…"
              className="flex-1 px-3 py-2 text-sm rounded-lg border outline-none"
              style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}
            />
            <button
              onClick={handleSave}
              disabled={saving || !ruleSetName.trim()}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, var(--color-teal-500), var(--color-teal-700))' }}
            >
              {saving ? 'Saving…' : savedId ? '✓ Saved' : 'Save Rule Set'}
            </button>
          </div>
        </Card>
      )}

      {/* Existing Rule Sets */}
      {existingSets.length > 0 && (
        <Card>
          <SectionLabel>Saved Rule Sets</SectionLabel>
          <div className="mt-3 space-y-2">
            {existingSets.map(rs => (
              <div key={rs.id} className="rounded-lg border p-3"
                style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{rs.name}</div>
                    {rs.description && (
                      <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{rs.description}</div>
                    )}
                    <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                      {Array.isArray(rs.sourceModels) ? rs.sourceModels.length : 0} source model{rs.sourceModels?.length !== 1 ? 's' : ''}
                      {' · '}{Array.isArray(rs.rules) ? rs.rules.filter(r => r.enabled !== false).length : 0} active rules
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => handleReExtract(rs)}
                      className="text-xs px-2 py-1 rounded border transition-colors"
                      style={{ borderColor: 'var(--border-default)', color: 'var(--color-blue-600)' }}
                    >
                      Re-extract
                    </button>
                    <button
                      onClick={() => handleDeleteSet(rs.id)}
                      className="text-xs px-2 py-1 rounded border transition-colors"
                      style={{ borderColor: 'var(--border-default)', color: 'var(--color-red-600)' }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {/* Rules mini-list */}
                {Array.isArray(rs.rules) && rs.rules.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {rs.rules.filter(r => r.enabled !== false).map(r => (
                      <span key={r.id}
                        className="text-xs px-1.5 py-0.5 rounded-full"
                        style={{ backgroundColor: 'var(--color-blue-50)', color: 'var(--color-blue-700)' }}
                      >
                        {r.priority}. {RULE_META_FRONTEND[r.id]?.label ?? r.id}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
