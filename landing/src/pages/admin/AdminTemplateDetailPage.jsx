// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Phase 3.7a.1 — admin drill-in for a single recurring-tournament
 * template. Three panels:
 *
 *   1. Config (with inline Edit mode; writes directly to
 *      tournament_templates via PATCH).
 *   2. Seed bots (add via username picker / userId; remove per-row).
 *   3. Occurrences (last 50, paginated server-side if ever needed).
 *
 * Edit mode is entered via ?edit=1 (from the list page's "Edit" button)
 * or the inline "Edit" toggle. Seed-bot panel responds to the #seed-bots
 * hash anchor.
 */

import React, { useEffect, useState, useCallback } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { getToken } from '../../lib/getToken.js'
import { tournamentApi } from '../../lib/tournamentApi.js'
import { useOptimisticSession } from '../../lib/useOptimisticSession.js'
import { ListTable, ListTh, ListTr, ListTd } from '../../components/ui/ListTable.jsx'

function Spinner() {
  return <div className="w-6 h-6 border-2 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
}

function Panel({ title, children, action }) {
  return (
    <section className="rounded-xl border p-5"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{children ?? '—'}</p>
    </div>
  )
}

function Input({ value, onChange, type = 'text', ...rest }) {
  return (
    <input
      type={type}
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      className="w-full text-sm rounded-lg border px-3 py-1.5 outline-none"
      style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
      {...rest}
    />
  )
}

function Select({ value, onChange, options }) {
  return (
    <select value={value ?? ''} onChange={e => onChange(e.target.value)}
      className="w-full text-sm rounded-lg border px-3 py-1.5 outline-none"
      style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function toLocalInput(d) {
  if (!d) return ''
  try {
    const dt = new Date(d)
    // datetime-local expects "YYYY-MM-DDTHH:mm" in local time
    const pad = (n) => String(n).padStart(2, '0')
    return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`
  } catch { return '' }
}

function EditForm({ template, onCancel, onSave, busy }) {
  const [form, setForm] = useState({
    name:                template.name,
    description:         template.description ?? '',
    recurrenceInterval:  template.recurrenceInterval,
    recurrenceStart:     toLocalInput(template.recurrenceStart),
    recurrenceEndDate:   template.recurrenceEndDate ? toLocalInput(template.recurrenceEndDate) : '',
    minParticipants:     template.minParticipants,
    maxParticipants:     template.maxParticipants ?? '',
    bestOfN:             template.bestOfN,
    durationMinutes:     template.durationMinutes ?? '',
    noticePeriodMinutes: template.noticePeriodMinutes ?? '',
    isTest:              template.isTest,
  })
  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  function submit(e) {
    e.preventDefault()
    const payload = {
      name:                form.name,
      description:         form.description || null,
      recurrenceInterval:  form.recurrenceInterval,
      recurrenceStart:     new Date(form.recurrenceStart).toISOString(),
      recurrenceEndDate:   form.recurrenceEndDate ? new Date(form.recurrenceEndDate).toISOString() : null,
      minParticipants:     Number(form.minParticipants),
      maxParticipants:     form.maxParticipants === '' ? null : Number(form.maxParticipants),
      bestOfN:             Number(form.bestOfN),
      durationMinutes:     form.durationMinutes === '' ? null : Number(form.durationMinutes),
      noticePeriodMinutes: form.noticePeriodMinutes === '' ? null : Number(form.noticePeriodMinutes),
      isTest:              !!form.isTest,
    }
    onSave(payload)
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Name</p>
          <Input value={form.name} onChange={v => set('name', v)} required />
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Interval</p>
          <Select value={form.recurrenceInterval} onChange={v => set('recurrenceInterval', v)} options={[
            { value: 'DAILY',   label: 'Daily'   },
            { value: 'WEEKLY',  label: 'Weekly'  },
            { value: 'MONTHLY', label: 'Monthly' },
          ]} />
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Next start</p>
          <Input type="datetime-local" value={form.recurrenceStart} onChange={v => set('recurrenceStart', v)} required />
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>End date (optional)</p>
          <Input type="datetime-local" value={form.recurrenceEndDate} onChange={v => set('recurrenceEndDate', v)} />
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Min participants</p>
          <Input type="number" min="2" value={form.minParticipants} onChange={v => set('minParticipants', v)} />
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Max participants (optional)</p>
          <Input type="number" min="2" value={form.maxParticipants} onChange={v => set('maxParticipants', v)} />
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Best of N</p>
          <Input type="number" min="1" step="2" value={form.bestOfN} onChange={v => set('bestOfN', v)} />
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Duration (min)</p>
          <Input type="number" min="1" value={form.durationMinutes} onChange={v => set('durationMinutes', v)} />
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Notice period (min)</p>
          <Input type="number" min="0" value={form.noticePeriodMinutes} onChange={v => set('noticePeriodMinutes', v)} />
        </div>
        <div className="flex items-center gap-2 pt-6">
          <input type="checkbox" checked={!!form.isTest} onChange={e => set('isTest', e.target.checked)} id="isTest" />
          <label htmlFor="isTest" className="text-sm" style={{ color: 'var(--text-primary)' }}>Test-only template (hidden from public list)</label>
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Description</p>
        <textarea value={form.description} onChange={e => set('description', e.target.value)}
          className="w-full text-sm rounded-lg border px-3 py-1.5 outline-none min-h-[60px]"
          style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={busy}
          className="text-sm px-4 py-2 rounded-lg border font-semibold disabled:opacity-50"
          style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
          Cancel
        </button>
        <button type="submit" disabled={busy}
          className="text-sm px-4 py-2 rounded-lg font-semibold text-white disabled:opacity-50"
          style={{ backgroundColor: 'var(--color-blue-600)' }}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  )
}

function SeedBotsPanel({ template, token, onChange }) {
  const [userIdToAdd, setUserIdToAdd] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState(null)

  async function add(e) {
    e.preventDefault()
    if (!userIdToAdd.trim()) return
    setBusy(true); setErr(null)
    try {
      await tournamentApi.addTemplateSeed(template.id, userIdToAdd.trim(), token)
      setUserIdToAdd('')
      onChange()
    } catch (e) {
      setErr(e.message || 'Failed to add seed bot.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(userId) {
    setBusy(true); setErr(null)
    try {
      await tournamentApi.removeTemplateSeed(template.id, userId, token)
      onChange()
    } catch (e) {
      setErr(e.message || 'Failed to remove seed bot.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div id="seed-bots" className="space-y-3">
      {err && (
        <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{err}</p>
      )}
      <form onSubmit={add} className="flex items-center gap-2">
        <Input value={userIdToAdd} onChange={setUserIdToAdd} placeholder="Bot user ID (cuid)…" />
        <button type="submit" disabled={busy || !userIdToAdd.trim()}
          className="text-sm px-3 py-1.5 rounded-lg font-semibold text-white disabled:opacity-50 whitespace-nowrap"
          style={{ backgroundColor: 'var(--color-blue-600)' }}>
          Add seed bot
        </button>
      </form>
      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        Seed bots pre-register on every occurrence spawned by this template.
      </p>

      {template.seedBots?.length > 0 ? (
        <ListTable>
          <thead>
            <tr>
              <ListTh>Display name</ListTh>
              <ListTh>Username</ListTh>
              <ListTh>User ID</ListTh>
              <ListTh align="right">Action</ListTh>
            </tr>
          </thead>
          <tbody>
            {template.seedBots.map((sb, i) => (
              <ListTr key={sb.id} last={i === template.seedBots.length - 1}>
                <ListTd><span className="text-sm" style={{ color: 'var(--text-primary)' }}>{sb.user?.displayName ?? '—'}</span></ListTd>
                <ListTd><span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{sb.user?.username ?? '—'}</span></ListTd>
                <ListTd><span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{sb.userId}</span></ListTd>
                <ListTd align="right">
                  <button onClick={() => remove(sb.userId)} disabled={busy}
                    className="text-xs font-semibold px-2.5 py-1 rounded border"
                    style={{ backgroundColor: 'var(--color-red-50)', color: 'var(--color-red-700)', borderColor: 'var(--color-red-200)' }}>
                    Remove
                  </button>
                </ListTd>
              </ListTr>
            ))}
          </tbody>
        </ListTable>
      ) : (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No seed bots yet.</p>
      )}
    </div>
  )
}

function OccurrencesPanel({ occurrences }) {
  if (!occurrences || occurrences.length === 0) {
    return <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No occurrences spawned yet.</p>
  }
  return (
    <ListTable>
      <thead>
        <tr>
          <ListTh>Status</ListTh>
          <ListTh>Start time</ListTh>
          <ListTh>End time</ListTh>
          <ListTh align="right">Participants</ListTh>
          <ListTh align="right">Link</ListTh>
        </tr>
      </thead>
      <tbody>
        {occurrences.map((occ, i) => (
          <ListTr key={occ.id} last={i === occurrences.length - 1}>
            <ListTd><span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{occ.status}</span></ListTd>
            <ListTd><span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{occ.startTime ? new Date(occ.startTime).toLocaleString() : '—'}</span></ListTd>
            <ListTd><span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{occ.endTime   ? new Date(occ.endTime).toLocaleString()   : '—'}</span></ListTd>
            <ListTd align="right"><span className="text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>{occ._count?.participants ?? 0}</span></ListTd>
            <ListTd align="right">
              <Link to={`/tournaments/${occ.id}`} className="text-xs font-semibold underline underline-offset-2" style={{ color: 'var(--color-blue-600)' }}>View →</Link>
            </ListTd>
          </ListTr>
        ))}
      </tbody>
    </ListTable>
  )
}

export default function AdminTemplateDetailPage() {
  const { id } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: session } = useOptimisticSession()
  const [token, setToken]             = useState(null)
  const [template, setTemplate]       = useState(null)
  const [occurrences, setOccurrences] = useState([])
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState(null)
  const [editMode, setEditMode]       = useState(searchParams.get('edit') === '1')
  const [saving, setSaving]           = useState(false)
  const [saveError, setSaveError]     = useState(null)
  const isAdmin = session?.user?.role === 'admin'

  useEffect(() => { getToken().then(setToken).catch(() => {}) }, [])

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true); setError(null)
    try {
      const data = await tournamentApi.getTemplate(id, token)
      setTemplate(data.template)
      setOccurrences(data.occurrences ?? [])
    } catch (err) {
      setError(err.message || 'Failed to load template.')
    } finally {
      setLoading(false)
    }
  }, [token, id])

  useEffect(() => { if (token) load() }, [token, load])

  async function save(payload) {
    setSaving(true); setSaveError(null)
    try {
      await tournamentApi.updateTemplate(id, payload, token)
      setEditMode(false)
      searchParams.delete('edit')
      setSearchParams(searchParams, { replace: true })
      await load()
    } catch (err) {
      setSaveError(err.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  if (!isAdmin) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Admin access required.</p>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Template</p>
          <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
            {template?.name ?? '…'}
          </h1>
        </div>
        <Link to="/admin/templates"
          className="text-sm font-semibold underline underline-offset-2 shrink-0 mt-2"
          style={{ color: 'var(--color-blue-600)' }}>
          ← All templates
        </Link>
      </div>

      {loading && !template && (
        <div className="flex justify-center py-16"><Spinner /></div>
      )}

      {error && !template && (
        <div className="p-4 rounded-lg border text-center"
          style={{ backgroundColor: 'var(--color-red-50)', borderColor: 'var(--color-red-200)', color: 'var(--color-red-700)' }}>
          <p className="text-sm">{error}</p>
        </div>
      )}

      {template && (
        <>
          <Panel title="Configuration" action={
            !editMode && (
              <button onClick={() => setEditMode(true)}
                className="text-xs font-semibold px-3 py-1.5 rounded border"
                style={{ borderColor: 'var(--border-default)', color: 'var(--color-blue-600)', backgroundColor: 'var(--bg-base)' }}>
                Edit
              </button>
            )
          }>
            {saveError && (
              <p className="text-xs mb-3" style={{ color: 'var(--color-red-600)' }}>{saveError}</p>
            )}
            {editMode ? (
              <EditForm template={template} onCancel={() => { setEditMode(false); setSaveError(null) }} onSave={save} busy={saving} />
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Game">{template.game}</Field>
                <Field label="Mode / Format">{template.mode} · {template.format} · {template.bracketType}</Field>
                <Field label="Interval">{template.recurrenceInterval}</Field>
                <Field label="Next start">{template.recurrenceStart ? new Date(template.recurrenceStart).toLocaleString() : '—'}</Field>
                <Field label="End date">{template.recurrenceEndDate ? new Date(template.recurrenceEndDate).toLocaleString() : 'Never'}</Field>
                <Field label="Participants">
                  {template.minParticipants} – {template.maxParticipants ?? '∞'} · Best of {template.bestOfN}
                </Field>
                <Field label="Notice period">{template.noticePeriodMinutes != null ? `${template.noticePeriodMinutes} min` : '—'}</Field>
                <Field label="Duration">{template.durationMinutes != null ? `${template.durationMinutes} min` : '—'}</Field>
                <Field label="Status">{template.paused ? 'Paused' : 'Active'}{template.isTest ? ' · Test' : ''}</Field>
                <Field label="Occurrences">{occurrences.length}</Field>
              </div>
            )}
          </Panel>

          <Panel title="Seed bots">
            <SeedBotsPanel template={template} token={token} onChange={load} />
          </Panel>

          <Panel title="Occurrences">
            <OccurrencesPanel occurrences={occurrences} />
          </Panel>
        </>
      )}
    </div>
  )
}
