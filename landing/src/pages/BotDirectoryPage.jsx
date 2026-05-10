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
import { Link, useSearchParams } from 'react-router-dom'
import { useBots } from '../lib/useBots.js'
import { useOptimisticSession } from '../lib/useOptimisticSession.js'
import BotCard from '../components/bots/BotCard.jsx'
import BotFilterBar from '../components/bots/BotFilterBar.jsx'
import ChallengeButton from '../components/bots/ChallengeButton.jsx'

function paramsToFilters(sp) {
  const owner = sp.get('owner')
  const eloMin = sp.get('eloMin')
  const eloMax = sp.get('eloMax')
  const search = sp.get('search')
  return {
    owner:  owner && ['mine', 'community', 'all'].includes(owner) ? owner : undefined,
    eloMin: eloMin && !Number.isNaN(Number(eloMin)) ? Number(eloMin) : undefined,
    eloMax: eloMax && !Number.isNaN(Number(eloMax)) ? Number(eloMax) : undefined,
    search: search ?? undefined,
  }
}

function filtersToParams(filters) {
  const out = {}
  if (filters.owner)        out.owner = filters.owner
  if (filters.eloMin != null) out.eloMin = String(filters.eloMin)
  if (filters.eloMax != null) out.eloMax = String(filters.eloMax)
  if (filters.search)       out.search = filters.search
  return out
}

export default function BotDirectoryPage() {
  const [sp, setSp] = useSearchParams()
  const filters = useMemo(() => paramsToFilters(sp), [sp])

  const { data: session } = useOptimisticSession()
  const userId   = session?.user?.id ?? null
  const isGuest  = !session?.user

  const { bots, allBots, isLoading, error } = useBots(filters, userId)

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
          Bots
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {allBots.length} active · pick any opponent and play right away.
        </p>
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
        <div className="grid gap-2.5" data-testid="bot-directory-grid">
          {bots.map(b => (
            <Link
              key={b.id}
              to={`/bots/${b.id}`}
              className="block no-underline"
              data-testid={`bot-directory-row-${b.id}`}
            >
              <BotCard
                bot={b}
                variant="list"
                actions={
                  <ChallengeButton
                    botUserId={b.id}
                    variant="icon"
                    source="directory"
                  />
                }
              />
            </Link>
          ))}
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
