// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * BotCard — display layout for a single bot. Stateless, action-agnostic.
 *
 * Variants:
 *   'list'    — full card for the directory grid
 *   'select'  — compact tile for the create-table picker (clickable as a whole)
 *   'profile' — header row for the bot profile page
 *
 * Action slot: caller passes `actions` (typically a `<ChallengeButton />`
 * or a select callback) — kept out of this component so the same card
 * can serve "challenge", "select", "view profile", etc. surfaces.
 */
import React from 'react'

const VARIANT_STYLES = {
  list:    { padding: '1rem',     gap: '0.75rem' },
  select:  { padding: '0.625rem', gap: '0.5rem'  },
  profile: { padding: '1.25rem',  gap: '1rem'    },
}

function ratingFromGameElo(bot) {
  const row = Array.isArray(bot?.gameElo) ? bot.gameElo[0] : null
  return row?.rating != null ? Math.round(row.rating) : null
}

// A4.4 — picker disambiguation. When a multi-skill bot is rendered in a
// picker that's already scoped to one game (`pickerGameId`), append the
// game label so the user can tell which skill of "Sterling" they're
// queueing. Single-game bots aren't suffixed — the parenthetical would
// be noise when there's no other option to disambiguate against.
const GAME_LABELS = {
  'tic-tac-toe': 'Tic-tac-toe',
  'connect-four': 'Connect 4',
}
function pickerSuffix(bot, pickerGameId) {
  const playable = Array.isArray(bot?.playableGameIds) ? bot.playableGameIds : []
  if (playable.length < 2 || !pickerGameId) return null
  return GAME_LABELS[pickerGameId] ?? pickerGameId
}

export default function BotCard({
  bot,
  variant = 'list',
  actions = null,
  onSelect = null,
  ownerLabel = null,
  pickerGameId = null,
}) {
  if (!bot) return null
  const style = VARIANT_STYLES[variant] ?? VARIANT_STYLES.list
  const rating = ratingFromGameElo(bot)
  const baseName = bot.displayName ?? '—'
  const suffix = pickerSuffix(bot, pickerGameId)
  const name = suffix ? `${baseName} (${suffix})` : baseName
  const isCommunity = !bot.botOwnerId
  const ownerText = ownerLabel ?? (isCommunity ? 'Community' : 'Player bot')

  const interactive = typeof onSelect === 'function' && variant === 'select'
  const Wrapper = interactive ? 'button' : 'div'

  return (
    <Wrapper
      type={interactive ? 'button' : undefined}
      onClick={interactive ? () => onSelect(bot) : undefined}
      data-testid="bot-card"
      data-variant={variant}
      className={`flex items-center rounded-xl border text-left ${interactive ? 'hover:bg-[var(--bg-surface-hover)] cursor-pointer' : ''}`}
      style={{
        padding:        style.padding,
        gap:            style.gap,
        backgroundColor:'var(--bg-surface)',
        borderColor:    'var(--border-default)',
        boxShadow:      variant === 'list' ? 'var(--shadow-card)' : undefined,
      }}
    >
      {/* Avatar */}
      <div
        className="shrink-0 rounded-full overflow-hidden flex items-center justify-center"
        style={{ width: variant === 'select' ? '2rem' : '2.5rem', height: variant === 'select' ? '2rem' : '2.5rem', backgroundColor: 'var(--color-slate-100)' }}
        aria-hidden="true"
      >
        {bot.avatarUrl
          ? <img src={bot.avatarUrl} alt="" className="w-full h-full object-cover" />
          : <span style={{ fontSize: '1rem' }}>🤖</span>}
      </div>

      {/* Identity column */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className="text-sm font-semibold truncate"
            style={{ color: 'var(--text-primary)' }}
            title={name}
          >
            {name}
          </span>
          {bot.botProvisional && (
            <span
              className="text-[9px] font-bold uppercase tracking-wide px-1 py-0.5 rounded"
              style={{ backgroundColor: 'var(--color-amber-50)', color: 'var(--color-amber-700)' }}
              title="Bot has played fewer than the provisional-games threshold"
            >
              new
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          <span>{ownerText}</span>
          {rating != null && (
            <>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums" data-testid="bot-card-rating">ELO {rating}</span>
            </>
          )}
          {bot.botGamesPlayed != null && (
            <>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{bot.botGamesPlayed} games</span>
            </>
          )}
        </div>
      </div>

      {/* Action slot — only rendered in non-interactive variants. In
          'select' the whole card is the action, so a nested button is
          omitted to avoid double-tap UX. */}
      {!interactive && actions && (
        <div className="shrink-0 flex items-center gap-1.5">{actions}</div>
      )}
    </Wrapper>
  )
}
