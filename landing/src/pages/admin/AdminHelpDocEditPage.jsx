// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * /admin/help/:id  — edit existing HelpDoc
 * /admin/help/new  — create a new HelpDoc
 *
 * The same component handles both. The mode is determined by route param.
 * Optimistic-lock 409s on save show an inline banner with a Reload button.
 */

import React, { useEffect, useState } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { api } from '../../lib/api.js'
import { getToken } from '../../lib/getToken.js'

const STATUS_OPTIONS = ['DRAFT', 'PUBLISHED', 'ARCHIVED']

export default function AdminHelpDocEditPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  // The /admin/help/new route doesn't declare :id, so useParams().id is
  // undefined there. Detect new mode from the pathname instead.
  const isNew = location.pathname.endsWith('/admin/help/new') || id === 'new'

  const [form, setForm] = useState({
    slug: '', title: '', body: '', category: '', tagsText: '', status: 'PUBLISHED',
  })
  const [version, setVersion] = useState(null)   // null when isNew
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState(null)
  const [conflict, setConflict] = useState(null)

  useEffect(() => {
    if (isNew) return
    async function load() {
      setLoading(true)
      try {
        const token = await getToken()
        const { doc } = await api.admin.help.getDoc(id, token)
        setForm({
          slug: doc.slug, title: doc.title, body: doc.body, category: doc.category,
          tagsText: (doc.tags ?? []).join(', '), status: doc.status,
        })
        setVersion(doc.version)
      } catch (e) {
        setError('Failed to load doc.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id, isNew])

  function setField(key) {
    return (e) => setForm(f => ({ ...f, [key]: e.target.value }))
  }

  async function handleSave(e) {
    e?.preventDefault?.()
    setSaving(true)
    setSaved(false)
    setError(null)
    setConflict(null)
    try {
      const token = await getToken()
      const tags = form.tagsText.split(',').map(t => t.trim()).filter(Boolean)
      const payload = {
        title: form.title, body: form.body, category: form.category,
        tags, status: form.status,
      }
      if (isNew) {
        const { doc } = await api.admin.help.createDoc(
          { slug: form.slug, ...payload }, token
        )
        navigate(`/admin/help/${doc.id}`, { replace: true })
        return
      }
      const res = await fetch(`/api/v1/admin/help/docs/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...payload, version }),
      })
      if (res.status === 409) {
        const body = await res.json().catch(() => ({}))
        setConflict({ current: body.current })
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { doc } = await res.json()
      setVersion(doc.version)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e?.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  function reloadFromConflict() {
    if (!conflict?.current) return
    const d = conflict.current
    setForm({
      slug: d.slug, title: d.title, body: d.body, category: d.category,
      tagsText: (d.tags ?? []).join(', '), status: d.status,
    })
    setVersion(d.version)
    setConflict(null)
  }

  async function handleArchive() {
    if (!window.confirm('Archive this doc? It will be hidden from public help but kept in DB.')) return
    try {
      const token = await getToken()
      await api.admin.help.archiveDoc(id, token)
      navigate('/admin/help', { replace: true })
    } catch (e) {
      setError(e?.message || 'Archive failed.')
    }
  }

  if (loading) return <Spinner />

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <div className="flex items-end justify-between pb-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
            {isNew ? 'New help doc' : 'Edit help doc'}
          </h1>
          {!isNew && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              v{version} · {form.slug}
            </p>
          )}
        </div>
        <Link
          to="/admin/help"
          className="text-sm underline"
          style={{ color: 'var(--text-secondary)' }}
        >
          ← Back to list
        </Link>
      </div>

      {conflict && (
        <div
          className="rounded-lg border p-3 flex items-center justify-between"
          style={{ backgroundColor: 'var(--color-amber-50)', borderColor: 'var(--color-amber-300)' }}
          data-testid="conflict-banner"
        >
          <div className="text-sm" style={{ color: 'var(--color-amber-700)' }}>
            Someone else edited this doc (now v{conflict.current?.version}). Reload to see their changes, then re-apply yours.
          </div>
          <button
            onClick={reloadFromConflict}
            className="px-3 py-1 rounded-md text-xs font-medium"
            style={{ backgroundColor: 'var(--color-amber-600)', color: 'white' }}
            data-testid="conflict-reload"
          >
            Reload
          </button>
        </div>
      )}

      {error && <p className="text-sm" style={{ color: 'var(--color-red-600)' }}>{error}</p>}

      <form onSubmit={handleSave} className="space-y-3">
        <Field label="Slug" disabled={!isNew}>
          <input
            value={form.slug}
            onChange={setField('slug')}
            data-testid="field-slug"
            disabled={!isNew}
            className="w-full px-3 py-1.5 rounded-lg border text-sm font-mono disabled:opacity-60"
            style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
          />
        </Field>

        <Field label="Title">
          <input
            value={form.title}
            onChange={setField('title')}
            data-testid="field-title"
            className="w-full px-3 py-1.5 rounded-lg border text-sm"
            style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Category">
            <input
              value={form.category}
              onChange={setField('category')}
              data-testid="field-category"
              className="w-full px-3 py-1.5 rounded-lg border text-sm"
              style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
            />
          </Field>
          <Field label="Tags (comma-separated)">
            <input
              value={form.tagsText}
              onChange={setField('tagsText')}
              data-testid="field-tags"
              className="w-full px-3 py-1.5 rounded-lg border text-sm"
              style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
            />
          </Field>
          <Field label="Status">
            <select
              value={form.status}
              onChange={setField('status')}
              data-testid="field-status"
              className="w-full px-3 py-1.5 rounded-lg border text-sm"
              style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
            >
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Body (markdown)">
          <textarea
            value={form.body}
            onChange={setField('body')}
            data-testid="field-body"
            rows={28}
            className="w-full px-3 py-2 rounded-lg border font-mono text-xs"
            style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
          />
        </Field>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            data-testid="save-button"
            className="px-4 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
          >
            {saving ? 'Saving…' : (isNew ? 'Create doc' : 'Save changes')}
          </button>
          {saved && <span className="text-xs font-semibold" style={{ color: 'var(--color-teal-600)' }}>✓ Saved</span>}
          {!isNew && (
            <button
              type="button"
              onClick={handleArchive}
              data-testid="archive-button"
              className="ml-auto px-3 py-1 rounded-md text-xs font-medium border"
              style={{
                borderColor: 'var(--color-red-300)',
                color:       'var(--color-red-600)',
                backgroundColor: 'transparent',
              }}
            >
              Archive
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

function Field({ label, children, disabled }) {
  return (
    <label className="space-y-1 block">
      <span className="text-xs font-medium" style={{ color: disabled ? 'var(--text-muted)' : 'var(--text-secondary)' }}>
        {label}
      </span>
      {children}
    </label>
  )
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-4 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
