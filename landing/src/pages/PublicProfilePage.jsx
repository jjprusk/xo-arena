// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Phase 3.7a.3 — route reservation.
 *
 * This route exists so `/users/:username` is already wired and bookmarkable
 * before the real public-profile feature ships (scheduled for Phase 7 or
 * whenever external-developer onboarding needs shareable profile pages).
 * Reserving the URL now means future shares of `/users/joe` won't require
 * a URL migration post-launch.
 *
 * Replace this stub with the real component when the feature lands.
 */
import React from 'react'
import { useParams, Link } from 'react-router-dom'

export default function PublicProfilePage() {
  const { username } = useParams()
  return (
    <div className="max-w-xl mx-auto px-6 py-16 text-center">
      <p className="text-xs uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
        Public profile
      </p>
      <h1 className="text-2xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
        @{username}
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
        Public profile pages aren't live yet. This link is reserved — bookmark it and it'll start working in a future release.
      </p>
      <div className="flex gap-3 justify-center">
        <Link
          to="/rankings"
          className="text-sm font-semibold underline underline-offset-2"
          style={{ color: 'var(--color-blue-600)' }}
        >
          View rankings →
        </Link>
        <Link
          to="/"
          className="text-sm font-semibold underline underline-offset-2"
          style={{ color: 'var(--color-blue-600)' }}
        >
          Home →
        </Link>
      </div>
    </div>
  )
}
