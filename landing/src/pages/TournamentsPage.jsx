import React from 'react'

// TODO: migrate full TournamentsPage from xo.aiarena frontend
export default function TournamentsPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-12 space-y-5">
      <div className="pb-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
        <h1 className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
          Tournaments
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
          Compete in structured brackets and climb the ranks.
        </p>
      </div>
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        Tournament browser coming soon — migrating from XO Arena.
      </p>
    </div>
  )
}
