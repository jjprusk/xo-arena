// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * MatchCompletePanel — final screen for a ranked best-of-N match.
 *
 * Replaces (on top of) the per-game finished overlay once `matchState.complete`
 * is true. Shows the final match score, who won, and a "Play again" CTA that
 * starts a fresh ranked match.
 *
 * Note: per-game ELO is not updated for ranked matches; ELO moves once per
 * match via `updateBothElosAfterMatch`. The numeric delta is not currently
 * surfaced on the wire — a future enhancement can fold it into the
 * `match.completed` SSE payload.
 */
import { Link } from 'react-router-dom'

export default function MatchCompletePanel({ matchState, currentUserId, leaveHref }) {
  if (!matchState?.complete) return null

  const youWon  = matchState.winnerId && currentUserId && matchState.winnerId === currentUserId
  const drawn   = !matchState.winnerId
  const youWins  = matchState.p1Wins   ?? 0
  const themWins = matchState.p2Wins   ?? 0
  const draws    = matchState.drawGames ?? 0

  const headline = drawn ? 'Match drawn' : youWon ? 'You won the match' : 'Bot won the match'
  const icon     = drawn ? '🤝' : youWon ? '🏆' : '🤖'

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 px-3 sm:px-4 pb-4 pointer-events-none"
    >
      <div
        className="pointer-events-auto mx-auto max-w-sm flex flex-col items-center gap-3 px-4 py-4 rounded-2xl shadow-2xl"
        style={{
          backgroundColor: 'var(--bg-surface)',
          border:          '2px solid var(--color-primary)',
        }}
        data-testid="match-complete-panel"
      >
        <div className="text-4xl" aria-hidden="true">{icon}</div>
        <p
          className="text-lg font-bold text-center"
          style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
        >
          {headline}
        </p>
        <p
          className="font-mono tabular-nums text-sm"
          style={{ color: 'var(--text-secondary)' }}
        >
          You {youWins} – {themWins} Bot{draws ? ` · ${draws}D` : ''}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <Link to="/play?action=ranked-bot" className="btn btn-primary btn-sm">
            Play again
          </Link>
          <Link to={leaveHref ?? '/'} className="btn btn-secondary btn-sm">
            Done
          </Link>
        </div>
      </div>
    </div>
  )
}
