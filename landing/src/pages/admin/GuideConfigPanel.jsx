// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Sprint 6 — Intelligent Guide v1 SystemConfig editor.
 *
 * Mirrors the existing IdleConfig / SessionIdle / ReplayConfig panels: load
 * → form → save → "✓ Saved". Backed by GET/PATCH /api/v1/admin/guide-config
 * which validates types per a server-side spec table.
 *
 * Per Sprint6_Kickoff §3.4 a few keys need extra UX:
 *   - guide.v1.enabled is the release gate; flipping it off silently drops
 *     all journey credits & discovery rewards. Confirm before submitting.
 *   - guide.cup.sizeEntrants ships in v1 but the cup spawn logic hardcodes
 *     the slot mix; render disabled with a v1.1 hint.
 *   - metrics.internalEmailDomains is a string-array; render as a
 *     comma-separated input.
 */
import React, { useEffect, useState } from 'react'
import { api } from '../../lib/api.js'
import { getToken } from '../../lib/getToken.js'

const TIER_OPTIONS = ['novice', 'intermediate', 'advanced', 'master']

const REWARD_FIELDS = [
  { key: 'guide.rewards.hookComplete',                       label: 'Hook complete (TC)',          hint: 'Granted at end-of-Hook (step 2)'   },
  { key: 'guide.rewards.curriculumComplete',                 label: 'Curriculum complete (TC)',    hint: 'Granted at end-of-Curriculum (step 7)' },
  { key: 'guide.rewards.discovery.firstSpecializeAction',    label: 'Discovery — first Specialize action (TC)',    hint: 'One-shot. v1: surface exists, no caller wired yet.' },
  { key: 'guide.rewards.discovery.firstRealTournamentWin',   label: 'Discovery — first real tournament win (TC)',  hint: 'One-shot. Excludes Curriculum Cup.' },
  { key: 'guide.rewards.discovery.firstNonDefaultAlgorithm', label: 'Discovery — first non-default algorithm (TC)', hint: 'One-shot. Triggered when a user trains a bot with qLearning/dqn etc.' },
  { key: 'guide.rewards.discovery.firstTemplateClone',       label: 'Discovery — first template clone (TC)',        hint: 'One-shot. v1: surface exists, no caller wired yet.' },
]

const NUMERIC_OPS_FIELDS = [
  { key: 'guide.cup.retentionDays', label: 'Cup retention (days)',  min: 1, max: 365,  hint: 'Old curriculum cups (default 30)' },
  { key: 'guide.demo.ttlMinutes',   label: 'Demo TTL (minutes)',    min: 5, max: 1440, hint: 'Idle demo tables get reaped after this (default 60)' },
]

function fieldStyle() {
  return { backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }
}

export default function GuideConfigPanel() {
  const [config, setConfig] = useState(null)
  const [form,   setForm]   = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [error,  setError]  = useState(null)

  useEffect(() => {
    async function load() {
      try {
        const token = await getToken()
        const { config: c } = await api.admin.getGuideConfig(token)
        setConfig(c)
        setForm(_toForm(c))
      } catch {
        setError('Failed to load guide config.')
      }
    }
    load()
  }, [])

  if (error) {
    return (
      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Intelligent Guide v1</h2>
        <p className="text-sm" style={{ color: 'var(--color-red-600)' }}>{error}</p>
      </section>
    )
  }
  if (!config || !form) return null

  function setFormField(key, value) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function handleSave(e) {
    e.preventDefault()

    // Confirm-before-toggle for the release gate (Sprint6_Kickoff §3.4).
    const flagChanged = form.v1Enabled !== config['guide.v1.enabled']
    if (flagChanged && form.v1Enabled === false) {
      const ok = confirm(
        'Disable Intelligent Guide v1?\n\n' +
        'While disabled, journey credits and discovery rewards are silently dropped. ' +
        'Existing user state is preserved; flipping back on resumes credits for new actions.'
      )
      if (!ok) return
    }

    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const token = await getToken()
      const body = _toPatchBody(form, config)
      const { config: updated } = await api.admin.setGuideConfig(body, token)
      setConfig(updated)
      setForm(_toForm(updated))
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err?.message || 'Failed to save guide config.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Intelligent Guide v1</h2>
      <div
        className="rounded-xl border p-4 space-y-5"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
      >
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Tunables for the v1 onboarding journey. Reward sizes apply to the next user who trips the trigger; the release flag takes effect immediately.
        </p>

        <form onSubmit={handleSave} className="space-y-5">
          {/* Release gate */}
          <div className="pb-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
            <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Release flag</p>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.v1Enabled}
                onChange={e => setFormField('v1Enabled', e.target.checked)}
                className="mt-0.5"
                aria-label="guide.v1.enabled"
              />
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                <strong>guide.v1.enabled</strong>
                <span className="block text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  Master switch. When off, journeyService.completeStep and discoveryRewardsService grants both no-op.
                </span>
              </span>
            </label>
          </div>

          {/* Rewards */}
          <div className="pb-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
            <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Reward sizes (Trainer Credits)</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
              {REWARD_FIELDS.map(({ key, label, hint }) => (
                <label key={key} className="space-y-1">
                  <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</span>
                  <input
                    type="number"
                    min="0"
                    max="1000"
                    value={form[key] ?? ''}
                    onChange={e => setFormField(key, e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border text-sm focus:outline-none"
                    style={fieldStyle()}
                    aria-label={key}
                  />
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{hint}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Quick Bot tiers */}
          <div className="pb-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
            <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Quick Bot tier ladder</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
              {[
                { key: 'guide.quickBot.defaultTier',       label: 'Initial tier',           hint: 'Tier the wizard creates the bot at (default novice)' },
                { key: 'guide.quickBot.firstTrainingTier', label: 'After first training',   hint: 'Tier the bot flips to after Quick Train (default intermediate)' },
              ].map(({ key, label, hint }) => (
                <label key={key} className="space-y-1">
                  <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</span>
                  <select
                    value={form[key] ?? ''}
                    onChange={e => setFormField(key, e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border text-sm focus:outline-none"
                    style={fieldStyle()}
                    aria-label={key}
                  >
                    {TIER_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{hint}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Cup + demo + read-only */}
          <div className="pb-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
            <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Operations</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
              {NUMERIC_OPS_FIELDS.map(({ key, label, min, max, hint }) => (
                <label key={key} className="space-y-1">
                  <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</span>
                  <input
                    type="number"
                    min={min}
                    max={max}
                    value={form[key] ?? ''}
                    onChange={e => setFormField(key, e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border text-sm focus:outline-none"
                    style={fieldStyle()}
                    aria-label={key}
                  />
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{hint}</span>
                </label>
              ))}
              <label className="space-y-1">
                <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Cup entrants <span className="opacity-70">(read-only)</span></span>
                <input
                  type="number"
                  value={config['guide.cup.sizeEntrants'] ?? 4}
                  disabled
                  className="w-full px-3 py-1.5 rounded-lg border text-sm focus:outline-none opacity-60 cursor-not-allowed"
                  style={fieldStyle()}
                  aria-label="guide.cup.sizeEntrants"
                />
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>v1.1 — currently fixed at 4 by curriculum design.</span>
              </label>
            </div>
          </div>

          {/* Internal email domains */}
          <div>
            <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Test-user email domains</p>
            <label className="space-y-1 block">
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>metrics.internalEmailDomains</span>
              <textarea
                rows={2}
                value={form.internalEmailDomains ?? ''}
                onChange={e => setFormField('internalEmailDomains', e.target.value)}
                placeholder="callidity.com, example.com"
                className="w-full px-3 py-1.5 rounded-lg border text-sm focus:outline-none font-mono"
                style={fieldStyle()}
                aria-label="metrics.internalEmailDomains"
              />
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                Comma-separated. Accounts created with one of these domains in their email get isTestUser=true and are excluded from the dashboard.
              </span>
            </label>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saved && <span className="text-xs font-semibold" style={{ color: 'var(--color-teal-600)' }}>✓ Saved</span>}
            {error && <span className="text-xs" style={{ color: 'var(--color-red-600)' }}>{error}</span>}
          </div>
        </form>
      </div>
    </section>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Map the API config to the form state shape. */
function _toForm(c) {
  const f = {
    v1Enabled:            c['guide.v1.enabled'] !== false,
    internalEmailDomains: Array.isArray(c['metrics.internalEmailDomains'])
      ? c['metrics.internalEmailDomains'].join(', ')
      : '',
  }
  for (const { key } of REWARD_FIELDS) f[key] = c[key] ?? ''
  for (const { key } of NUMERIC_OPS_FIELDS) f[key] = c[key] ?? ''
  f['guide.quickBot.defaultTier']       = c['guide.quickBot.defaultTier']       ?? 'novice'
  f['guide.quickBot.firstTrainingTier'] = c['guide.quickBot.firstTrainingTier'] ?? 'intermediate'
  return f
}

/** Build the PATCH body from the form. Only sends keys that changed. */
function _toPatchBody(form, config) {
  const body = {}
  if (form.v1Enabled !== config['guide.v1.enabled']) body['guide.v1.enabled'] = form.v1Enabled
  for (const { key } of REWARD_FIELDS) {
    const n = parseInt(form[key], 10)
    if (Number.isFinite(n) && n !== config[key]) body[key] = n
  }
  for (const { key } of NUMERIC_OPS_FIELDS) {
    const n = parseInt(form[key], 10)
    if (Number.isFinite(n) && n !== config[key]) body[key] = n
  }
  for (const k of ['guide.quickBot.defaultTier', 'guide.quickBot.firstTrainingTier']) {
    if (form[k] && form[k] !== config[k]) body[k] = form[k]
  }
  const domains = String(form.internalEmailDomains ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)
  const current = Array.isArray(config['metrics.internalEmailDomains']) ? config['metrics.internalEmailDomains'] : []
  const sameDomains = domains.length === current.length && domains.every((d, i) => d === current[i])
  if (!sameDomains) body['metrics.internalEmailDomains'] = domains
  return body
}
