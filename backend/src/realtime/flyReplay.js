// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Fly-Replay session pinning.
 *
 * SSE sessions are stored in `sseSessions` as a per-process Map. With more
 * than one backend machine in a Fly app, the LB round-robins each `fetch()`,
 * so a POST that should hit the machine holding the session can land on a
 * different machine — which has no entry — and fail with 409
 * SSE_SESSION_EXPIRED.
 *
 * Rather than move the registry to Redis (the `res` writable is fundamentally
 * pinned to the originating machine anyway, so half the metadata can never
 * move), we use Fly's built-in routing primitive: the `Fly-Replay` response
 * header. When a POST lands on the wrong machine, we respond 200 with
 * `Fly-Replay: instance=<owning-machine-id>` and Fly's edge proxy transparently
 * replays the request — body and all — on the right machine. The client never
 * sees the indirection.
 *
 * To know which machine owns a session we encode the machine id into the
 * session id at mint time: `<machineId>.<nanoid>`. The middleware parses the
 * prefix and replays when it doesn't match the current machine. When
 * `FLY_MACHINE_ID` isn't set (local dev, tests), session ids are minted
 * without a prefix and the replay path is dormant.
 *
 * Docs: https://fly.io/docs/networking/dynamic-request-routing/#the-fly-replay-response-header
 */

import { nanoid } from 'nanoid'

const SEP = '.'

export function getMachineId() {
  return process.env.FLY_MACHINE_ID || null
}

/**
 * Mint a new SSE session id. On Fly, prefixes with the machine id so other
 * machines can route follow-up POSTs back here via Fly-Replay. Off-Fly,
 * returns a bare nanoid for backward compatibility with tests + local dev.
 */
export function mintSessionId() {
  const id = nanoid(16)
  const machineId = getMachineId()
  return machineId ? `${machineId}${SEP}${id}` : id
}

/**
 * Parse the owning machine id from a session id. Returns `null` for ids that
 * have no prefix (legacy / off-Fly) so callers can treat those as "any
 * machine" (skip the replay check, fall through to local lookup).
 */
export function parseMachineId(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return null
  const idx = sessionId.indexOf(SEP)
  if (idx <= 0) return null
  return sessionId.slice(0, idx)
}

/**
 * If the session id pins to a different machine than this one, return that
 * machine id. Otherwise (matches us, or no prefix at all, or we're not on
 * Fly) return null and the caller proceeds with normal local handling.
 */
export function targetMachineFor(sessionId) {
  const owner = parseMachineId(sessionId)
  if (!owner) return null
  const me = getMachineId()
  if (!me) return null              // off-Fly: never replay
  if (owner === me) return null     // already on the right machine
  return owner
}

/**
 * Send a Fly-Replay response. Fly's edge proxy intercepts the response,
 * drops it, and replays the original request — including body — on the
 * named machine. The client never sees the empty 200.
 *
 * Status is 200 by convention; Fly only inspects the header. We include a
 * tiny JSON body purely so curl-style debug output isn't completely empty.
 */
export function sendReplay(res, machineId) {
  res.setHeader('Fly-Replay', `instance=${machineId}`)
  res.status(200).json({ replay: machineId })
}
