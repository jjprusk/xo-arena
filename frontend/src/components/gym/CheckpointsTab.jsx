// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useState, useEffect } from 'react'
import { api } from '../../lib/api.js'
import { getToken } from '../../lib/getToken.js'
import { Card, SectionLabel, Btn } from './gymShared.jsx'

export default function CheckpointsTab({ model, onRestore }) {
  const [checkpoints, setCheckpoints] = useState([])
  const [selected, setSelected] = useState('')
  const [saving, setSaving] = useState(false)
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    api.ml.getCheckpoints(model.id).then(r => {
      setCheckpoints(r.checkpoints)
      if (r.checkpoints.length > 0) setSelected(r.checkpoints[0].id)
    })
  }, [model.id])

  async function handleSave() {
    setSaving(true)
    try {
      const token = await getToken()
      const { checkpoint } = await api.ml.saveCheckpoint(model.id, token)
      setCheckpoints(prev => [checkpoint, ...prev])
      setSelected(checkpoint.id)
    } finally {
      setSaving(false)
    }
  }

  async function handleRestore() {
    if (!selected) return
    if (!confirm('Restore this checkpoint? Current Q-table will be replaced.')) return
    setRestoring(true)
    try {
      const token = await getToken()
      await api.ml.restoreCheckpoint(model.id, selected, token)
      onRestore()
    } finally {
      setRestoring(false)
    }
  }

  const selectedCp = checkpoints.find(cp => cp.id === selected) ?? null

  return (
    <Card>
      <div className="flex items-center justify-between">
        <SectionLabel>Checkpoints</SectionLabel>
        <Btn onClick={handleSave} disabled={saving} variant="ghost">
          {saving ? 'Saving…' : '+ Save now'}
        </Btn>
      </div>
      <p className="text-xs mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>
        Auto-saved every 1,000 episodes. Restore any checkpoint to roll back the model.
      </p>
      {checkpoints.length === 0 ? (
        <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>No checkpoints yet.</p>
      ) : (
        <div className="space-y-3">
          <select value={selected} onChange={e => setSelected(e.target.value)}
            className="w-full text-sm rounded-lg border px-3 py-2 outline-none"
            style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
            {checkpoints.map(cp => (
              <option key={cp.id} value={cp.id}>
                Episode {cp.episodeNum.toLocaleString()} · ε={cp.epsilon.toFixed(4)} · ELO {Math.round(cp.eloRating)} · {new Date(cp.createdAt).toLocaleDateString()}
              </option>
            ))}
          </select>
          {selectedCp && (
            <div className="rounded-lg border px-4 py-3 flex items-center justify-between"
              style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}>
              <div className="text-xs space-y-0.5" style={{ color: 'var(--text-muted)' }}>
                <p><span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Episode {selectedCp.episodeNum.toLocaleString()}</span></p>
                <p>ε = {selectedCp.epsilon.toFixed(4)} · ELO {Math.round(selectedCp.eloRating)}</p>
                <p>{new Date(selectedCp.createdAt).toLocaleString()}</p>
              </div>
              <Btn onClick={handleRestore} disabled={restoring} variant="ghost">
                {restoring ? 'Restoring…' : 'Restore'}
              </Btn>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
