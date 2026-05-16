// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * SessionNotesDrawer — Sprint 1 of the User Research Log
 * (doc/Research_Log_Plan.md §3 Sprint 1, UI bullet 6).
 *
 * Mounted under the selected-session detail panel in `SessionsTab.jsx`.
 * Lists existing notes (newest first by default) and offers an inline
 * `+ Add note` form. Edit / delete are inline per row. Optimistic UI with
 * rollback on error — the route is fast enough that a spinner would feel
 * worse than a brief revert.
 *
 * Sprint 2 will add a `Publish` button next to each note row.
 */

import React, { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api.js'
import { getToken } from '../../lib/getToken.js'

const OUTCOMES = ['SUCCESS', 'PLATEAU', 'REGRESSION', 'INCONCLUSIVE']

const OUTCOME_LABEL = {
  SUCCESS:      'Success',
  PLATEAU:      'Plateau',
  REGRESSION:   'Regression',
  INCONCLUSIVE: 'Inconclusive',
}

function parseTags(raw) {
  return (raw || '')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)
}

function NoteRow({ note, onEdit, onDelete, busy }) {
  const [editing, setEditing]   = useState(false)
  const [body,    setBody]      = useState(note.body)
  const [outcome, setOutcome]   = useState(note.outcome)
  const [tags,    setTags]      = useState((note.tags || []).join(', '))

  function reset() {
    setBody(note.body)
    setOutcome(note.outcome)
    setTags((note.tags || []).join(', '))
    setEditing(false)
  }

  async function save() {
    await onEdit(note.id, { body, outcome, tags: parseTags(tags) })
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="rounded-lg border px-3 py-3 space-y-2"
        style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={3}
          className="w-full rounded border px-2 py-1 text-sm"
          style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
          maxLength={2048}
        />
        <div className="flex gap-2">
          <select
            value={outcome}
            onChange={e => setOutcome(e.target.value)}
            className="rounded border px-2 py-1 text-sm"
            style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
          >
            {OUTCOMES.map(o => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
          </select>
          <input
            type="text"
            value={tags}
            onChange={e => setTags(e.target.value)}
            placeholder="tags, comma separated"
            className="flex-1 rounded border px-2 py-1 text-sm"
            style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
          />
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={reset}  disabled={busy} className="btn btn-secondary btn-sm">Cancel</button>
          <button onClick={save}   disabled={busy || !body.trim()} className="btn btn-primary btn-sm">Save</button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border px-3 py-2 flex items-start gap-2"
      style={{ borderColor: 'var(--border-default)' }}>
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="badge badge-draft text-[10px]">{OUTCOME_LABEL[note.outcome]}</span>
          {(note.tags || []).map(t => (
            <span key={t} className="text-[10px] px-1.5 py-0.5 rounded"
              style={{ backgroundColor: 'var(--bg-base)', color: 'var(--text-secondary)' }}>
              {t}
            </span>
          ))}
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {new Date(note.createdAt).toLocaleString()}
          </span>
        </div>
        <p className="text-sm whitespace-pre-wrap">{note.body}</p>
      </div>
      <div className="flex flex-col gap-1">
        <button onClick={() => setEditing(true)} disabled={busy} className="btn btn-secondary btn-xs">Edit</button>
        <button onClick={() => onDelete(note.id)} disabled={busy} className="btn btn-danger btn-xs">Delete</button>
      </div>
    </div>
  )
}

function AddNoteForm({ onAdd, busy }) {
  const [body,    setBody]    = useState('')
  const [outcome, setOutcome] = useState('SUCCESS')
  const [tags,    setTags]    = useState('')

  async function submit() {
    const text = body.trim()
    if (!text) return
    await onAdd({ body: text, outcome, tags: parseTags(tags) })
    setBody('')
    setOutcome('SUCCESS')
    setTags('')
  }

  return (
    <div className="rounded-lg border px-3 py-3 space-y-2"
      style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}>
      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        rows={3}
        placeholder="What happened this session? Outcome reasoning, hyperparameter intuition, surprises…"
        className="w-full rounded border px-2 py-1 text-sm"
        style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
        maxLength={2048}
      />
      <div className="flex gap-2">
        <select
          value={outcome}
          onChange={e => setOutcome(e.target.value)}
          className="rounded border px-2 py-1 text-sm"
          style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
        >
          {OUTCOMES.map(o => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
        </select>
        <input
          type="text"
          value={tags}
          onChange={e => setTags(e.target.value)}
          placeholder="tags, comma separated"
          className="flex-1 rounded border px-2 py-1 text-sm"
          style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
        />
        <button onClick={submit} disabled={busy || !body.trim()} className="btn btn-primary btn-sm">
          + Add note
        </button>
      </div>
    </div>
  )
}

export default function SessionNotesDrawer({ sessionId }) {
  const [notes, setNotes] = useState([])
  const [open,  setOpen]  = useState(false)
  const [busy,  setBusy]  = useState(false)
  const [err,   setErr]   = useState(null)
  const [order, setOrder] = useState('desc') // 'desc' newest-first by default

  const load = useCallback(async () => {
    if (!sessionId) return
    setErr(null)
    try {
      const token = await getToken()
      const r = await api.research.listNotes({}, token)
      // The list route returns all of the caller's notes — filter to this session.
      setNotes((r.notes || []).filter(n => n.sessionId === sessionId))
    } catch (e) {
      setErr(e.message || 'Failed to load notes')
    }
  }, [sessionId])

  useEffect(() => { if (open) load() }, [open, load])

  const sorted = React.useMemo(() => {
    const copy = [...notes]
    copy.sort((a, b) => {
      const ta = new Date(a.createdAt).getTime()
      const tb = new Date(b.createdAt).getTime()
      return order === 'desc' ? tb - ta : ta - tb
    })
    return copy
  }, [notes, order])

  async function addNote(input) {
    setBusy(true); setErr(null)
    // Optimistic: insert a placeholder; on success replace, on failure roll back.
    const tempId = `tmp_${Date.now()}`
    const placeholder = {
      id: tempId,
      userId: 'me',
      sessionId,
      body: input.body,
      outcome: input.outcome,
      tags: input.tags || [],
      createdAt: new Date().toISOString(),
    }
    setNotes(prev => [placeholder, ...prev])
    try {
      const token = await getToken()
      const r = await api.research.createNote(sessionId, input, token)
      setNotes(prev => [r.note, ...prev.filter(n => n.id !== tempId)])
    } catch (e) {
      setNotes(prev => prev.filter(n => n.id !== tempId))
      setErr(e.message || 'Failed to save note')
    } finally {
      setBusy(false)
    }
  }

  async function editNote(noteId, input) {
    setBusy(true); setErr(null)
    const prev = notes
    setNotes(curr => curr.map(n => n.id === noteId ? { ...n, ...input } : n))
    try {
      const token = await getToken()
      const r = await api.research.updateNote(noteId, input, token)
      setNotes(curr => curr.map(n => n.id === noteId ? r.note : n))
    } catch (e) {
      setNotes(prev)
      setErr(e.message || 'Failed to update note')
    } finally {
      setBusy(false)
    }
  }

  async function deleteNote(noteId) {
    setBusy(true); setErr(null)
    const prev = notes
    setNotes(curr => curr.filter(n => n.id !== noteId))
    try {
      const token = await getToken()
      await api.research.deleteNote(noteId, token)
    } catch (e) {
      setNotes(prev)
      setErr(e.message || 'Failed to delete note')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border px-3 py-2"
      style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-between w-full text-sm font-semibold"
      >
        <span>📔 Research notes {notes.length > 0 && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>({notes.length})</span>}</span>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {err && <p className="text-xs text-red-500">{err}</p>}

          {notes.length > 0 && (
            <div className="flex justify-end">
              <button
                onClick={() => setOrder(o => o === 'desc' ? 'asc' : 'desc')}
                className="btn btn-secondary btn-xs"
                title={order === 'desc' ? 'Showing newest first' : 'Showing oldest first'}
              >
                {order === 'desc' ? 'Newest first ↓' : 'Oldest first ↑'}
              </button>
            </div>
          )}

          <div className="space-y-2">
            {sorted.map(n => (
              <NoteRow
                key={n.id}
                note={n}
                onEdit={editNote}
                onDelete={deleteNote}
                busy={busy}
              />
            ))}
            {sorted.length === 0 && (
              <p className="text-xs text-center py-2" style={{ color: 'var(--text-muted)' }}>
                No notes yet. Capture what you tried and why.
              </p>
            )}
          </div>

          <AddNoteForm onAdd={addNote} busy={busy} />
        </div>
      )}
    </div>
  )
}
