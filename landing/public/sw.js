// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * AI Arena service worker — Web Push (Tier 3).
 *
 * Receives push events from the backend, shows a system notification, and
 * focuses or opens the relevant tab when the user clicks it. Kept minimal
 * on purpose: no offline caching, no background sync — the app is an
 * online experience, push is the only responsibility here.
 */

self.addEventListener('install', (event) => {
  // Activate immediately on first install so push events start landing
  // without a reload — no prior SW to supersede since we only have one.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

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
