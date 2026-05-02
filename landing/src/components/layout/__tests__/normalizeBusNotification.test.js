// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * AppLayout's normalizeBusNotification — turns a `guide:notification` bus
 * payload into the toast-stack shape (or null to suppress).
 *
 * Why this suite exists: every bus type that's *not* in the explicit switch
 * falls through to the `default` branch which produces a generic admin toast
 * with the raw type string as the title. That meant `table.released` —
 * broadcast to every connected user on every game-end — surfaced a literal
 * "table.released" toast for everyone on the site, even uninvolved
 * spectators. Locking down the suppression list here so a future bus-event
 * addition can't reintroduce that class of regression silently.
 */
import { describe, it, expect } from 'vitest'
import { normalizeBusNotification } from '../AppLayout.jsx'

describe('normalizeBusNotification', () => {
  // Telemetry / list-refresh events that reach every connected client. None
  // should produce a toast — the relevant UI already reacts to them via
  // dedicated useEventStream subscriptions.
  it.each([
    'table.created',
    'table.released',
    'table.completed',
    'table.deleted',
    'table.empty',
    'table.started',
    'spectator.joined',
  ])('suppresses %s from the notification stack', (type) => {
    expect(normalizeBusNotification(type, { tableId: 't1' })).toBeNull()
  })

  it('still surfaces stakeholder-scoped player.joined as a table toast', () => {
    const out = normalizeBusNotification('player.joined', {
      tableId: 't1', gameId: 'xo', actorDisplayName: 'Alice', seatIndex: 0,
    })
    expect(out).toMatchObject({
      uiType: 'table', type: 'table',
      tableId: 't1',
      title:   /Alice took seat 1/i,
    })
  })

  it('still surfaces tournament events as tournament toasts', () => {
    const out = normalizeBusNotification('tournament.published', {
      tournamentId: 'tn1', name: 'Spring Cup',
    })
    expect(out).toMatchObject({
      uiType: 'tournament', type: 'tournament',
      title:  /Spring Cup/i,
      href:   '/tournaments',
    })
  })

  it('routes unknown types through the default admin branch — confirms why suppress list matters', () => {
    const out = normalizeBusNotification('some.future.event', { message: 'hello' })
    expect(out).toMatchObject({ uiType: 'admin', type: 'admin', title: 'some.future.event', body: 'hello' })
  })
})
