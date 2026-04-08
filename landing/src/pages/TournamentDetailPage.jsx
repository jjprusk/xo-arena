import React from 'react'
import { useParams, Link } from 'react-router-dom'

// TODO: migrate full TournamentDetailPage from xo.aiarena frontend
export default function TournamentDetailPage() {
  const { id } = useParams()
  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      <Link to="/tournaments" className="text-sm no-underline hover:underline" style={{ color: 'var(--color-slate-500)' }}>
        ← Tournaments
      </Link>
      <p className="mt-4 text-sm" style={{ color: 'var(--text-muted)' }}>
        Tournament detail page coming soon. (id: {id})
      </p>
    </div>
  )
}
