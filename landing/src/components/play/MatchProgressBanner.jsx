// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * MatchProgressBanner — thin banner that hangs above the board during a
 * ranked best-of-N match. Shows "Best of N · Game M of N", the running
 * W/D/L score, and (on game 2+) a swap notice so the player knows their
 * mark has flipped from the previous game.
 *
 * Driven entirely by `matchState` from useGameSDK. When matchState is
 * null (casual play, PvP, tournament) the banner renders nothing.
 */

const FORMAT_LABELS = {
  RANKED_BO2: { label: 'Best of 2', total: 2 },
  TOURNAMENT_BO3: { label: 'Best of 3', total: 3 },
}

export default function MatchProgressBanner({ matchState, myMark }) {
  if (!matchState || matchState.complete) return null

  const fmt = FORMAT_LABELS[matchState.format] ?? { label: 'Best of N', total: null }
  const sequence = matchState.sequence ?? 1
  const showSwap = sequence >= 2
  const showTiebreaker = !!matchState.tiebreaker

  // Score from the *current user's* perspective. matchState carries raw
  // p1/p2 counts; the human is always p1 for HvB ranked play (the server
  // mints the Match with the human as player1Id). For other formats we'd
  // fall back to "you – them" by mark, but BO2 is the only shipping ranked
  // format right now.
  const youWins  = matchState.p1Wins  ?? 0
  const themWins = matchState.p2Wins  ?? 0
  const draws    = matchState.drawGames ?? 0

  return (
    <div
      className="mx-auto max-w-md px-3 py-2 mb-2 rounded-lg flex items-center justify-between gap-3 text-xs sm:text-sm"
      style={{
        backgroundColor: 'var(--bg-surface)',
        border:          '1px solid var(--border-subtle)',
        color:           'var(--text-primary)',
      }}
      data-testid="match-progress-banner"
    >
      <span className="font-semibold whitespace-nowrap">
        {showTiebreaker ? 'Tiebreaker' : fmt.label}
        {fmt.total ? ` · Game ${sequence} of ${fmt.total}` : ` · Game ${sequence}`}
      </span>
      <span
        className="font-mono tabular-nums"
        style={{ color: 'var(--text-secondary)' }}
        aria-label={`Score: you ${youWins}, bot ${themWins}${draws ? `, draws ${draws}` : ''}`}
      >
        You {youWins} – {themWins} Bot{draws ? ` · ${draws}D` : ''}
      </span>
      {showSwap && myMark && (
        <span
          className="hidden sm:inline whitespace-nowrap"
          style={{ color: 'var(--text-secondary)' }}
        >
          You're now <strong style={{ color: 'var(--text-primary)' }}>{myMark}</strong>
        </span>
      )}
    </div>
  )
}
