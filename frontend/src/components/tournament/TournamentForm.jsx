// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useState, useEffect } from 'react'

const FIELD_STYLE = {
  backgroundColor: 'var(--bg-base)',
  borderColor: 'var(--border-default)',
  color: 'var(--text-primary)',
}

function Field({ label, hint, children, required }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
        {label}
        {required && <span className="ml-0.5" style={{ color: 'var(--color-red-500)' }}>*</span>}
      </span>
      {children}
      {hint && (
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{hint}</span>
      )}
    </label>
  )
}

const INPUT_CLASS = 'w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-blue-300)] transition-colors'
const SELECT_CLASS = INPUT_CLASS

/**
 * Separate date + time inputs that combine into a YYYY-MM-DDTHH:mm value.
 * Avoids Safari's broken datetime-local behavior.
 */
function DateTimePicker({ value, onChange }) {
  const datePart = value ? value.slice(0, 10) : ''
  const timePart = value ? value.slice(11, 16) : ''

  function handleDate(e) {
    const d = e.target.value
    if (!d) { onChange(''); return }
    onChange(`${d}T${timePart || '00:00'}`)
  }

  function handleTime(e) {
    const t = e.target.value
    if (datePart) onChange(`${datePart}T${t || '00:00'}`)
  }

  return (
    <div className="flex gap-2">
      <input
        type="date"
        value={datePart}
        onChange={handleDate}
        className={INPUT_CLASS}
        style={FIELD_STYLE}
      />
      <input
        type="time"
        value={timePart}
        onChange={handleTime}
        className="px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-blue-300)] transition-colors w-32 shrink-0"
        style={FIELD_STYLE}
      />
    </div>
  )
}

// Convert a Date or ISO string to a value usable in datetime-local inputs
function toLocalDatetimeValue(val) {
  if (!val) return ''
  try {
    const d = new Date(val)
    // Format: YYYY-MM-DDTHH:mm
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return ''
  }
}

const DEFAULT_FORM = {
  name: '',
  description: '',
  game: 'xo',
  mode: 'HVH',
  format: 'PLANNED',
  bracketType: 'SINGLE_ELIM',
  bestOfN: 3,
  minParticipants: 2,
  maxParticipants: '',
  startTime: '',
  registrationOpenAt: '',
  registrationCloseAt: '',
  allowSpectators: true,
  botMinGamesPlayed: '',
  allowNonCompetitiveBots: false,
  paceMs: '',
  noticePeriodMinutes: '',
  durationMinutes: '',
  isRecurring: false,
  recurrenceInterval: 'WEEKLY',
  recurrenceEndDate: '',
  autoOptOutAfterMissed: '',
}

/**
 * TournamentForm — create or edit a tournament.
 *
 * Props:
 *   initialValues  — pre-populate for edit mode
 *   onSubmit(data) — async callback; receives form data shaped for the API
 *   onCancel()     — cancel / close handler
 *   submitLabel    — button text (default "Create Tournament")
 */
export default function TournamentForm({ initialValues, onSubmit, onCancel, submitLabel = 'Create Tournament' }) {
  const [form, setForm] = useState(() => {
    if (!initialValues) return DEFAULT_FORM
    return {
      name:                initialValues.name ?? '',
      description:         initialValues.description ?? '',
      game:                initialValues.game ?? 'xo',
      mode:                initialValues.mode ?? 'HVH',
      format:              initialValues.format ?? 'PLANNED',
      bracketType:         initialValues.bracketType ?? 'SINGLE_ELIM',
      bestOfN:             initialValues.bestOfN ?? 3,
      minParticipants:     initialValues.minParticipants ?? 2,
      maxParticipants:     initialValues.maxParticipants ?? '',
      startTime:           toLocalDatetimeValue(initialValues.startTime),
      registrationOpenAt:  toLocalDatetimeValue(initialValues.registrationOpenAt),
      registrationCloseAt: toLocalDatetimeValue(initialValues.registrationCloseAt),
      allowSpectators:     initialValues.allowSpectators ?? true,
      botMinGamesPlayed:   initialValues.botMinGamesPlayed != null ? String(initialValues.botMinGamesPlayed) : '',
      allowNonCompetitiveBots: initialValues.allowNonCompetitiveBots ?? false,
      paceMs:              initialValues.paceMs != null ? String(initialValues.paceMs) : '',
      noticePeriodMinutes: initialValues.noticePeriodMinutes != null ? String(initialValues.noticePeriodMinutes) : '',
      durationMinutes:     initialValues.durationMinutes != null ? String(initialValues.durationMinutes) : '',
      isRecurring:         initialValues.isRecurring ?? false,
      recurrenceInterval:  initialValues.recurrenceInterval ?? 'WEEKLY',
      recurrenceEndDate:   initialValues.recurrenceEndDate ? initialValues.recurrenceEndDate.slice(0, 10) : '',
      autoOptOutAfterMissed: initialValues.autoOptOutAfterMissed != null ? String(initialValues.autoOptOutAfterMissed) : '',
    }
  })
  const [errors, setErrors]   = useState({})
  const [busy, setBusy]       = useState(false)
  const [apiErr, setApiErr]   = useState(null)

  function set(key, val) {
    setForm(f => ({ ...f, [key]: val }))
    setErrors(e => ({ ...e, [key]: undefined }))
  }

  function validate() {
    const errs = {}
    if (!form.name.trim()) errs.name = 'Name is required.'
    if (form.registrationOpenAt && form.registrationCloseAt) {
      if (new Date(form.registrationOpenAt) >= new Date(form.registrationCloseAt)) {
        errs.registrationCloseAt = 'Registration close must be after open.'
      }
    }
    if (form.registrationCloseAt && form.startTime) {
      if (new Date(form.registrationCloseAt) > new Date(form.startTime)) {
        errs.startTime = 'Start time must be at or after registration close.'
      }
    }
    if (form.maxParticipants && Number(form.maxParticipants) < Number(form.minParticipants)) {
      errs.maxParticipants = 'Max must be ≥ min participants.'
    }
    return errs
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length > 0) { setErrors(errs); return }

    setBusy(true)
    setApiErr(null)
    try {
      const payload = {
        name:        form.name.trim(),
        game:        form.game,
        mode:        form.mode,
        format:      form.format,
        bracketType: form.bracketType,
        bestOfN:     Number(form.bestOfN),
        minParticipants: Number(form.minParticipants),
        allowSpectators: form.allowSpectators,
      }
      if (form.description.trim())    payload.description         = form.description.trim()
      if (form.maxParticipants)       payload.maxParticipants     = Number(form.maxParticipants)
      if (form.startTime)             payload.startTime           = new Date(form.startTime).toISOString()
      if (form.registrationOpenAt)    payload.registrationOpenAt  = new Date(form.registrationOpenAt).toISOString()
      if (form.registrationCloseAt)   payload.registrationCloseAt = new Date(form.registrationCloseAt).toISOString()
      if (form.mode === 'BOT_VS_BOT') {
        payload.allowNonCompetitiveBots = form.allowNonCompetitiveBots
        payload.botMinGamesPlayed = form.botMinGamesPlayed !== '' ? parseInt(form.botMinGamesPlayed, 10) : null
        payload.paceMs            = form.paceMs !== '' ? parseInt(form.paceMs, 10) : null
      }
      if (form.format === 'FLASH') {
        payload.noticePeriodMinutes = form.noticePeriodMinutes !== '' ? parseInt(form.noticePeriodMinutes, 10) : null
        payload.durationMinutes     = form.durationMinutes !== '' ? parseInt(form.durationMinutes, 10) : null
      }
      payload.isRecurring = form.isRecurring
      if (form.isRecurring) {
        payload.recurrenceInterval    = form.recurrenceInterval
        payload.recurrenceEndDate     = form.recurrenceEndDate || null
        payload.autoOptOutAfterMissed = form.autoOptOutAfterMissed !== '' ? parseInt(form.autoOptOutAfterMissed, 10) : null
      }

      await onSubmit(payload)
    } catch (err) {
      setApiErr(err.message || 'Submit failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {/* Name */}
      <Field label="Name" required>
        <input
          type="text"
          value={form.name}
          onChange={e => set('name', e.target.value)}
          placeholder="Summer Championship 2026"
          className={INPUT_CLASS}
          style={FIELD_STYLE}
          maxLength={120}
        />
        {errors.name && <span className="text-[10px]" style={{ color: 'var(--color-red-600)' }}>{errors.name}</span>}
      </Field>

      {/* Description */}
      <Field label="Description">
        <textarea
          value={form.description}
          onChange={e => set('description', e.target.value)}
          placeholder="Optional description…"
          rows={3}
          className={INPUT_CLASS + ' resize-y'}
          style={FIELD_STYLE}
          maxLength={1000}
        />
      </Field>

      {/* Game / Mode / Format / Bracket */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Game" required>
          <select
            value={form.game}
            onChange={e => set('game', e.target.value)}
            className={SELECT_CLASS}
            style={FIELD_STYLE}
          >
            <option value="xo">XO (Tic-Tac-Toe)</option>
          </select>
        </Field>

        <Field label="Mode" required>
          <select
            value={form.mode}
            onChange={e => set('mode', e.target.value)}
            className={SELECT_CLASS}
            style={FIELD_STYLE}
          >
            <option value="HVH">HvH (Human vs Human)</option>
            <option value="BOT_VS_BOT">Bot vs Bot</option>
            <option value="MIXED">Mixed</option>
          </select>
        </Field>

        <Field label="Format" required>
          <select
            value={form.format}
            onChange={e => set('format', e.target.value)}
            className={SELECT_CLASS}
            style={FIELD_STYLE}
          >
            <option value="PLANNED">Planned</option>
            <option value="OPEN">Open</option>
            <option value="FLASH">Flash</option>
          </select>
        </Field>

        <Field label="Bracket Type" required>
          <select
            value={form.bracketType}
            onChange={e => set('bracketType', e.target.value)}
            className={SELECT_CLASS}
            style={FIELD_STYLE}
          >
            <option value="SINGLE_ELIM">Single Elimination</option>
            <option value="ROUND_ROBIN">Round Robin</option>
          </select>
        </Field>
      </div>

      {/* Format-specific fields */}
      {form.format === 'FLASH' && (
        <div className="flex flex-col gap-3 p-3 rounded-lg border" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}>
          <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Flash Tournament Settings</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Notice Period (minutes)" hint="Time before tournament starts (minutes)">
              <input
                type="number"
                min="0"
                value={form.noticePeriodMinutes}
                onChange={e => set('noticePeriodMinutes', e.target.value)}
                placeholder="e.g. 15"
                className={INPUT_CLASS}
                style={FIELD_STYLE}
              />
            </Field>
            <Field label="Duration (minutes)" hint="How long the tournament runs (minutes)">
              <input
                type="number"
                min="1"
                value={form.durationMinutes}
                onChange={e => set('durationMinutes', e.target.value)}
                placeholder="e.g. 60"
                className={INPUT_CLASS}
                style={FIELD_STYLE}
              />
            </Field>
          </div>
        </div>
      )}

      {form.format === 'OPEN' && (
        <div className="px-3 py-2 rounded-lg border" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Open format: registration stays open until the tournament starts. No registration close date needed.
          </p>
        </div>
      )}

      {/* Bot Settings (BOT_VS_BOT only) */}
      {form.mode === 'BOT_VS_BOT' && (
        <div className="flex flex-col gap-3 p-3 rounded-lg border" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}>
          <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Bot Settings</p>

          <Field label="Min Games Played" hint="Bot must have played at least this many games (leave blank for system default)">
            <input type="number" min="0" className={INPUT_CLASS} style={FIELD_STYLE}
              value={form.botMinGamesPlayed}
              onChange={e => setForm(f => ({ ...f, botMinGamesPlayed: e.target.value }))}
              placeholder="System default"
            />
          </Field>

          <Field label="Pace (ms between dispatches)" hint="Delay between job dispatches for this tournament (leave blank for system default)">
            <input type="number" min="0" className={INPUT_CLASS} style={FIELD_STYLE}
              value={form.paceMs}
              onChange={e => setForm(f => ({ ...f, paceMs: e.target.value }))}
              placeholder="System default"
            />
          </Field>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.allowNonCompetitiveBots}
              onChange={e => setForm(f => ({ ...f, allowNonCompetitiveBots: e.target.checked }))}
              className="w-4 h-4 rounded"
            />
            <span className="text-sm" style={{ color: 'var(--text-primary)' }}>Allow non-competitive bots</span>
          </label>
        </div>
      )}

      {/* Recurring Tournament */}
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={form.isRecurring}
          onChange={e => set('isRecurring', e.target.checked)}
          className="w-4 h-4 rounded accent-[var(--color-blue-600)]"
        />
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Recurring Tournament</span>
      </label>

      {form.isRecurring && (
        <div className="flex flex-col gap-3 p-3 rounded-lg border" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}>
          <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Recurring Settings</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Recurrence Interval" required>
              <select
                value={form.recurrenceInterval}
                onChange={e => set('recurrenceInterval', e.target.value)}
                className={SELECT_CLASS}
                style={FIELD_STYLE}
              >
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
                <option value="CUSTOM">Custom</option>
              </select>
            </Field>
            <Field label="Recurrence End Date" hint="Optional — leave blank to recur indefinitely">
              <input
                type="date"
                value={form.recurrenceEndDate}
                onChange={e => set('recurrenceEndDate', e.target.value)}
                className={INPUT_CLASS}
                style={FIELD_STYLE}
              />
            </Field>
          </div>
          <Field label="Auto-opt-out after missed occurrences" hint="Auto-withdraw after N consecutive missed occurrences (0 = never)">
            <input
              type="number"
              min="0"
              value={form.autoOptOutAfterMissed}
              onChange={e => set('autoOptOutAfterMissed', e.target.value)}
              placeholder="0"
              className={INPUT_CLASS}
              style={FIELD_STYLE}
            />
          </Field>
        </div>
      )}

      {/* Best of N / Min / Max participants */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Best of N" hint="Games per match" required>
          <select
            value={form.bestOfN}
            onChange={e => set('bestOfN', e.target.value)}
            className={SELECT_CLASS}
            style={FIELD_STYLE}
          >
            {[1, 3, 5, 7].map(n => (
              <option key={n} value={n}>Best of {n}</option>
            ))}
          </select>
        </Field>

        <Field label="Min Participants" required>
          <input
            type="number"
            min={2}
            max={256}
            value={form.minParticipants}
            onChange={e => set('minParticipants', e.target.value)}
            className={INPUT_CLASS}
            style={FIELD_STYLE}
          />
        </Field>

        <Field label="Max Participants" hint="Leave blank for no limit">
          <input
            type="number"
            min={2}
            max={256}
            value={form.maxParticipants}
            onChange={e => set('maxParticipants', e.target.value)}
            placeholder="—"
            className={INPUT_CLASS}
            style={FIELD_STYLE}
          />
          {errors.maxParticipants && (
            <span className="text-[10px]" style={{ color: 'var(--color-red-600)' }}>{errors.maxParticipants}</span>
          )}
        </Field>
      </div>

      {/* Dates */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Start Time" hint="Required before publishing">
          {form.startTime ? (
            <div className="flex flex-col gap-1">
              <DateTimePicker value={form.startTime} onChange={v => set('startTime', v)} />
              <button type="button" onClick={() => set('startTime', '')}
                className="text-[10px] text-left hover:opacity-70 w-fit"
                style={{ color: 'var(--text-muted)' }}>Clear</button>
            </div>
          ) : (
            <button type="button" onClick={() => set('startTime', toLocalDatetimeValue(new Date()))}
              className="text-sm px-3 py-2 rounded-lg border w-full text-left transition-colors hover:bg-[var(--bg-surface-hover)]"
              style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)', ...FIELD_STYLE }}>
              — not set —
            </button>
          )}
          {errors.startTime && (
            <span className="text-[10px]" style={{ color: 'var(--color-red-600)' }}>{errors.startTime}</span>
          )}
        </Field>

        <Field label="Registration Opens At" hint="Optional">
          {form.registrationOpenAt ? (
            <div className="flex flex-col gap-1">
              <DateTimePicker value={form.registrationOpenAt} onChange={v => set('registrationOpenAt', v)} />
              <button type="button" onClick={() => set('registrationOpenAt', '')}
                className="text-[10px] text-left hover:opacity-70 w-fit"
                style={{ color: 'var(--text-muted)' }}>Clear</button>
            </div>
          ) : (
            <button type="button" onClick={() => set('registrationOpenAt', toLocalDatetimeValue(new Date()))}
              className="text-sm px-3 py-2 rounded-lg border w-full text-left transition-colors hover:bg-[var(--bg-surface-hover)]"
              style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)', ...FIELD_STYLE }}>
              — not set —
            </button>
          )}
        </Field>

        <Field label="Registration Closes At" hint="Optional">
          {form.registrationCloseAt ? (
            <div className="flex flex-col gap-1">
              <DateTimePicker value={form.registrationCloseAt} onChange={v => set('registrationCloseAt', v)} />
              <button type="button" onClick={() => set('registrationCloseAt', '')}
                className="text-[10px] text-left hover:opacity-70 w-fit"
                style={{ color: 'var(--text-muted)' }}>Clear</button>
            </div>
          ) : (
            <button type="button" onClick={() => set('registrationCloseAt', toLocalDatetimeValue(new Date()))}
              className="text-sm px-3 py-2 rounded-lg border w-full text-left transition-colors hover:bg-[var(--bg-surface-hover)]"
              style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)', ...FIELD_STYLE }}>
              — not set —
            </button>
          )}
          {errors.registrationCloseAt && (
            <span className="text-[10px]" style={{ color: 'var(--color-red-600)' }}>{errors.registrationCloseAt}</span>
          )}
        </Field>
      </div>

      {/* Allow Spectators */}
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={form.allowSpectators}
          onChange={e => set('allowSpectators', e.target.checked)}
          className="w-4 h-4 rounded accent-[var(--color-blue-600)]"
        />
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Allow spectators</span>
      </label>

      {/* API error */}
      {apiErr && (
        <p className="text-sm" style={{ color: 'var(--color-red-600)' }}>{apiErr}</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={busy}
          className="px-5 py-2 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
        >
          {busy ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm border transition-colors hover:bg-[var(--bg-surface-hover)]"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
