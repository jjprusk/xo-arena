// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * BotDirectoryPage — `/bots`
 *
 * Browse every active bot on the platform. Each card has a one-click
 * <ChallengeButton> action — guests included (per the plan's
 * "guest-friendly by default" decision: signup CTA fires after the
 * first finished game, not before the click).
 *
 * URL params drive filter state for shareable filtered views, e.g.
 *   /bots?owner=community&eloMin=1500&search=copper
 */
import React, { useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useBots, isBotPlayableFor } from '../lib/useBots.js'
import { useOptimisticSession } from '../lib/useOptimisticSession.js'
import { ListTable, ListTh, ListTr, ListTd } from '../components/ui/ListTable.jsx'
import BotFilterBar from '../components/bots/BotFilterBar.jsx'
import ChallengeButton from '../components/bots/ChallengeButton.jsx'
import QuickMatchButton from '../components/bots/QuickMatchButton.jsx'

const DEFAULT_GAME_ID = 'xo'

function paramsToFilters(sp) {
  const owner   = sp.get('owner')
  const eloMin  = sp.get('eloMin')
  const eloMax  = sp.get('eloMax')
  const search  = sp.get('search')
  const game    = sp.get('game')
  const showAll = sp.get('showAll')
  return {
    owner:   owner && ['mine', 'community', 'all'].includes(owner) ? owner : undefined,
    eloMin:  eloMin && !Number.isNaN(Number(eloMin)) ? Number(eloMin) : undefined,
    eloMax:  eloMax && !Number.isNaN(Number(eloMax)) ? Number(eloMax) : undefined,
    search:  search ?? undefined,
    gameId:  game ?? DEFAULT_GAME_ID,
    showAll: showAll === 'true',
  }
}

function filtersToParams(filters) {
  const out = {}
  if (filters.owner)        out.owner = filters.owner
  if (filters.eloMin != null) out.eloMin = String(filters.eloMin)
  if (filters.eloMax != null) out.eloMax = String(filters.eloMax)
  if (filters.search)       out.search = filters.search
  if (filters.gameId && filters.gameId !== DEFAULT_GAME_ID) out.game = filters.gameId
  if (filters.showAll)      out.showAll = 'true'
  return out
}

function ratingFromGameElo(bot) {
  const row = Array.isArray(bot?.gameElo) ? bot.gameElo[0] : null
  return row?.rating != null ? Math.round(row.rating) : null
}

export default function BotDirectoryPage() {
  const navigate = useNavigate()
  const [sp, setSp] = useSearchParams()
  const filters = useMemo(() => paramsToFilters(sp), [sp])

  const { data: session } = useOptimisticSession()
  const userId   = session?.user?.id ?? null
  const isGuest  = !session?.user

  const { bots, allBots, isLoading, error } = useBots(filters, userId)

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
            Bots
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {allBots.length} active · pick any opponent or let us match you.
          </p>
        </div>
        <QuickMatchButton source="directory-quick-match" />
      </header>

      <BotFilterBar
        value={filters}
        onChange={(next) => setSp(filtersToParams(next), { replace: true })}
        ownerToggleAllowsMine={!isGuest}
      />

      {error && (
        <div
          className="rounded-xl border p-4 text-sm"
          style={{ borderColor: 'var(--color-red-300)', backgroundColor: 'var(--color-red-50)', color: 'var(--color-red-700)' }}
          role="alert"
        >
          Couldn't load bots: {error.message ?? String(error)}
        </div>
      )}

      {isLoading && allBots.length === 0 ? (
        <p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }} data-testid="bot-directory-loading">
          Loading bots…
        </p>
      ) : bots.length === 0 ? (
        <p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }} data-testid="bot-directory-empty">
          No bots match these filters.{' '}
          <button
            type="button"
            className="underline"
            style={{ color: 'var(--color-blue-600)' }}
            onClick={() => setSp({}, { replace: true })}
          >
            Reset filters
          </button>
        </p>
      ) : (
        <div data-testid="bot-directory-grid">
          <ListTable maxHeight="clamp(240px, calc(100dvh - 320px), 800px)">
            <thead>
              <tr>
                <ListTh>Bot</ListTh>
                <ListTh className="hidden sm:table-cell">Owner</ListTh>
                <ListTh align="right" className="hidden sm:table-cell">ELO</ListTh>
                <ListTh align="right" className="hidden sm:table-cell">Games</ListTh>
                <ListTh align="right">Play</ListTh>
              </tr>
            </thead>
            <tbody>
              {bots.map((b, i) => {
                const rating      = ratingFromGameElo(b)
                const isCommunity = !b.botOwnerId
                const playable    = isBotPlayableFor(b, filters.gameId)
                return (
                  <ListTr
                    key={b.id}
                    last={i === bots.length - 1}
                    onClick={() => navigate(`/bots/${b.id}`, {
                      state: { from: `/bots${sp.toString() ? `?${sp.toString()}` : ''}` },
                    })}
                  >
                    <ListTd>
                      <span
                        data-testid={`bot-directory-row-${b.id}`}
                        className="flex items-center gap-2.5"
                      >
                        <span
                          className="shrink-0 rounded-full overflow-hidden flex items-center justify-center"
                          style={{ width: '2rem', height: '2rem', backgroundColor: 'var(--color-slate-100)' }}
                          aria-hidden="true"
                        >
                          {b.avatarUrl
                            ? <img src={b.avatarUrl} alt="" className="w-full h-full object-cover" />
                            : <span style={{ fontSize: '0.95rem' }}>🤖</span>}
                        </span>
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5">
                            <span
                              className="text-sm font-semibold truncate max-w-[180px]"
                              style={{ color: 'var(--text-primary)' }}
                              title={b.displayName}
                            >
                              {b.displayName ?? '—'}
                            </span>
                            {b.botProvisional && (
                              <span
                                className="text-[9px] font-bold uppercase tracking-wide px-1 py-0.5 rounded"
                                style={{ backgroundColor: 'var(--color-amber-50)', color: 'var(--color-amber-700)' }}
                                title="Bot has played fewer than the provisional-games threshold"
                              >
                                new
                              </span>
                            )}
                          </span>
                        </span>
                      </span>
                    </ListTd>
                    <ListTd className="hidden sm:table-cell">
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {isCommunity ? 'Community' : 'Player bot'}
                      </span>
                    </ListTd>
                    <ListTd align="right" className="hidden sm:table-cell">
                      <span className="tabular-nums text-sm">{rating ?? '—'}</span>
                    </ListTd>
                    <ListTd align="right" className="hidden sm:table-cell">
                      <span className="tabular-nums text-sm">{b.botGamesPlayed ?? 0}</span>
                    </ListTd>
                    <ListTd align="right">
                      <div className="inline-flex">
                        <ChallengeButton
                          botUserId={b.id}
                          gameId={filters.gameId}
                          disabled={!playable}
                          unavailableReason={!playable ? `No skill for ${filters.gameId.toUpperCase()}` : null}
                          source="directory"
                        />
                      </div>
                    </ListTd>
                  </ListTr>
                )
              })}
            </tbody>
          </ListTable>
        </div>
      )}

      {isGuest && bots.length > 0 && (
        <div
          className="rounded-xl border-dashed border p-3 text-center text-xs"
          style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}
          data-testid="bot-directory-guest-ribbon"
        >
          Playing as a guest — sign in to track wins, train your own bot, and join tournaments.
        </div>
      )}
    </div>
  )
}
