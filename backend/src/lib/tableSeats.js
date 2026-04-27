// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Seat-release helpers for chunk 3 (F1).
 *
 * Until now no code path freed a seat once a player sat down — the JSON blob
 * kept pointing at the players who finished the game and the table appeared
 * "stuck occupied" until the row itself was deleted by GC. Two release shapes:
 *
 *  - `releaseSeats(seats)` — clear ALL occupied seats. Used for mass-departure
 *    paths (room:cancel, idle abandon, admin DELETE, disconnect-both-gone, GC
 *    abandon-idle-active). The whole table is being shut down.
 *
 *  - `releaseSeatForUser(seats, userId)` — clear only the seat for a single
 *    user. Used for individual departures (game:forfeit, game:leave,
 *    disconnect-after-COMPLETED) where the other player may still be at the
 *    table waiting on a rematch.
 *
 * Both return a new array — neither mutates input. `userId`/`displayName` on
 * released seats are nulled so the seat can be cleanly re-occupied if the row
 * is reused later (rematch keeps the row ACTIVE so this never normally
 * matters, but defensive cleanup is cheap).
 */
export function releaseSeats(seats) {
  if (!Array.isArray(seats)) return seats
  return seats.map((seat) => {
    if (!seat || seat.status !== 'occupied') return seat
    return { ...seat, status: 'empty', userId: null, displayName: null }
  })
}

export function releaseSeatForUser(seats, userId) {
  if (!Array.isArray(seats) || !userId) return seats
  return seats.map((seat) => {
    if (!seat || seat.status !== 'occupied' || seat.userId !== userId) return seat
    return { ...seat, status: 'empty', userId: null, displayName: null }
  })
}
