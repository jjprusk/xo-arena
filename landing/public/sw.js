// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * AI Arena service worker.
 *
 * Two responsibilities, one file:
 *
 *   1. Web Push (Tier 3, shipped first) — receive `push` events from
 *      the backend, show a notification, focus or open the relevant tab
 *      when the user clicks it.
 *
 *   2. App-shell caching (Phase 20.2, doc/Performance_Plan_v2.md) —
 *      cache-first for the immutable hashed bundles under `/assets/*`,
 *      stale-while-revalidate for the entry HTML, network-only for
 *      everything under `/api/*` and `/socket.io/*`. Repeat-visit
 *      Ready ≈ paint floor (~50–100 ms) instead of 370 ms.
 *
 * The kill switch (`GET /api/v1/config/sw`, 20.1b) is consulted on
 * every `activate` and on a 10-minute throttle during navigation
 * requests. If `enabled: false`, the worker self-unregisters and
 * deletes every cache it owns. Operator runbook: Guide_Operations.md
 * §5.8.
 */

// Bump SW_VERSION on any SW logic change — cache names are scoped to
// it, so old caches are dropped during `activate` automatically.
// `sw.version` SystemConfig key is the operator-driven equivalent.
const SW_VERSION   = 1
const SHELL_CACHE  = `aiarena-shell-v${SW_VERSION}`
const KILL_SWITCH_URL = '/api/v1/config/sw'

// Throttle: at most one kill-switch fetch per this interval per SW.
const KILL_SWITCH_INTERVAL_MS = 10 * 60 * 1000   // 10 min
let _lastKillCheck = 0
let _killSwitchFetched = false   // first activate hasn't returned yet

// ── Lifecycle ─────────────────────────────────────────────────────────────────

self.addEventListener('install', (_event) => {
  // Activate immediately on first install so push events + cache routes
  // start landing without a reload. No prior SW to supersede beyond v0
  // (push-only), which had no cache to migrate.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 1. Drop any cache from a previous SW_VERSION.
    try {
      const names = await caches.keys()
      await Promise.all(
        names
          .filter(n => n.startsWith('aiarena-') && n !== SHELL_CACHE)
          .map(n => caches.delete(n)),
      )
    } catch { /* non-fatal */ }

    // 2. Take control of any open tabs (the v0 push-only SW used this
    //    same line — preserved so push behavior is unchanged).
    try { await self.clients.claim() } catch { /* non-fatal */ }

    // 3. Consult the kill switch. Failing open is intentional —
    //    a network blip during activate must not brick the worker.
    await checkKillSwitch()
  })())
})

// ── Kill switch ───────────────────────────────────────────────────────────────

async function checkKillSwitch() {
  _lastKillCheck = Date.now()
  let body = null
  try {
    const res = await fetch(KILL_SWITCH_URL, { cache: 'no-store' })
    if (!res.ok) return
    body = await res.json()
  } catch {
    // Backend unreachable — fail open.
    return
  }
  _killSwitchFetched = true
  if (body?.enabled === false) {
    await dropAllCaches()
    try { await self.registration.unregister() } catch { /* non-fatal */ }
    return
  }
  // sw.version drift → invalidate the shell cache (worker stays alive).
  if (Number.isInteger(body?.version) && body.version !== SW_VERSION) {
    try { await caches.delete(SHELL_CACHE) } catch { /* non-fatal */ }
  }
}

async function dropAllCaches() {
  try {
    const names = await caches.keys()
    await Promise.all(names.filter(n => n.startsWith('aiarena-')).map(n => caches.delete(n)))
  } catch { /* non-fatal */ }
}

function maybeRecheckKillSwitch(event) {
  if (Date.now() - _lastKillCheck < KILL_SWITCH_INTERVAL_MS) return
  // Fire-and-forget; the event itself is satisfied by the fetch handler
  // below. waitUntil keeps the SW alive long enough for this to land.
  event.waitUntil(checkKillSwitch())
}

// ── Fetch routing ─────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const req = event.request

  // Only GET is cacheable.
  if (req.method !== 'GET') return

  let url
  try { url = new URL(req.url) } catch { return }

  // Same-origin only — never touch cross-origin requests (analytics, fly
  // edge, etc. are unrelated to the app shell).
  if (url.origin !== self.location.origin) return

  // /api/* and /socket.io/* are NEVER cached — auth, sessions,
  // mutations, SSE streams, all of it must hit the network.
  if (url.pathname.startsWith('/api/'))       return
  if (url.pathname.startsWith('/socket.io/')) return

  // The kill-switch endpoint itself uses HTTP cache (max-age=30) and
  // must not double-cache inside the SW.
  if (url.pathname === KILL_SWITCH_URL) return

  // Navigation requests → stale-while-revalidate from cached /index.html.
  if (req.mode === 'navigate') {
    maybeRecheckKillSwitch(event)
    event.respondWith(handleNavigation(req))
    return
  }

  // Hashed Vite bundles → cache-first. URLs are content-addressed and
  // the express layer already serves them as `immutable` (Phase 20.1).
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(handleAsset(req))
    return
  }

  // Everything else (favicon, fonts, root-level images) → network
  // first, fall back to cache on offline.
  event.respondWith(handleStatic(req))
})

async function handleNavigation(req) {
  const cache = await caches.open(SHELL_CACHE)
  // Fetch + cache `/` (the entry HTML) regardless of the navigated
  // route — every SPA route renders out of the same index.html.
  const shellReq = new Request('/', { credentials: 'same-origin' })
  const cached = await cache.match(shellReq)

  // Background revalidate — keeps the cached HTML fresh for next visit.
  const networkPromise = fetch(req).then(async (res) => {
    if (res && res.ok && res.type === 'basic') {
      try { await cache.put(shellReq, res.clone()) } catch { /* quota */ }
    }
    return res
  }).catch(() => null)

  if (cached) return cached
  // Cold visit — wait for the network. If that fails, return a minimal
  // offline fallback rather than a useless white screen.
  const fresh = await networkPromise
  if (fresh) return fresh
  return new Response(
    '<!doctype html><meta charset="utf-8"><title>AI Arena — offline</title>' +
    '<body style="font:16px/1.4 system-ui;padding:2rem">Offline. Reconnect to continue.</body>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

async function handleAsset(req) {
  const cache = await caches.open(SHELL_CACHE)
  const cached = await cache.match(req)
  if (cached) return cached
  try {
    const res = await fetch(req)
    if (res && res.ok && res.type === 'basic') {
      try { await cache.put(req, res.clone()) } catch { /* quota */ }
    }
    return res
  } catch {
    // Asset miss + offline = bubble up to the caller; the app already
    // has fallback behavior for chunk-load errors.
    return Response.error()
  }
}

async function handleStatic(req) {
  try {
    const res = await fetch(req)
    if (res && res.ok && res.type === 'basic') {
      const cache = await caches.open(SHELL_CACHE)
      try { await cache.put(req, res.clone()) } catch { /* quota */ }
    }
    return res
  } catch {
    const cache = await caches.open(SHELL_CACHE)
    const cached = await cache.match(req)
    return cached ?? Response.error()
  }
}

// ── Push (unchanged from v0) ──────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  if (!event.data) return
  let data = {}
  try { data = event.data.json() } catch { /* non-JSON push — ignore */ }
  const title = data.title || 'AI Arena'
  const options = {
    body: data.body ?? '',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    // Tag collapses duplicate notifications of the same type. Per-type tag
    // so a second 'match.ready' supersedes the first rather than stacking.
    tag: data.type || 'aiarena',
    data: { url: data.url ?? '/', type: data.type ?? null },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url ?? '/'
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // Prefer focusing an already-open tab on the same origin.
    for (const client of allClients) {
      try {
        const url = new URL(client.url)
        if (url.origin === self.location.origin) {
          await client.focus()
          client.navigate?.(targetUrl)
          return
        }
      } catch { /* ignore malformed URLs */ }
    }
    await self.clients.openWindow(targetUrl)
  })())
})
