// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Web Push (Tier 3) client helpers.
 *
 * Coordinates: service-worker registration, Notification permission prompt,
 * PushManager subscription, and REST registration with the backend. Designed
 * to be called from Settings UI — caller owns UX decisions (when to ask,
 * what to show on denial).
 */
import { getToken } from './getToken.js'

const SW_URL = '/sw.js'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? null

export function isPushSupported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
}

export function currentPermission() {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission   // 'default' | 'granted' | 'denied'
}

/** Decode a urlBase64 VAPID key into the Uint8Array PushManager expects. */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw     = atob(base64)
  const out     = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null
  const existing = await navigator.serviceWorker.getRegistration(SW_URL)
  if (existing) return existing
  return navigator.serviceWorker.register(SW_URL)
}

async function getVapidPublicKey() {
  if (VAPID_PUBLIC_KEY) return VAPID_PUBLIC_KEY
  try {
    const res = await fetch('/api/v1/push/public-key')
    if (!res.ok) return null
    const { publicKey } = await res.json()
    return publicKey ?? null
  } catch {
    return null
  }
}

/**
 * Subscribe this browser to push notifications.
 * Requests permission if needed. Returns:
 *   { ok: true, endpoint }       subscribed (new or existing)
 *   { ok: false, reason }         one of: 'unsupported', 'denied', 'no-vapid',
 *                                 'sw-failed', 'network'
 */
export async function subscribePush() {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' }

  const perm = currentPermission() === 'default'
    ? await Notification.requestPermission()
    : currentPermission()
  if (perm !== 'granted') return { ok: false, reason: 'denied' }

  const publicKey = await getVapidPublicKey()
  if (!publicKey) return { ok: false, reason: 'no-vapid' }

  const reg = await registerServiceWorker().catch(() => null)
  if (!reg) return { ok: false, reason: 'sw-failed' }

  // Reuse an existing subscription if present. PushManager treats .subscribe
  // as idempotent only when the VAPID key matches — if you rotate the key
  // you must unsubscribe old subs first, but that's a release-time concern.
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })
  }

  const json = sub.toJSON()
  try {
    const token = await getToken()
    const res = await fetch('/api/v1/push/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        endpoint:  json.endpoint,
        keys:      json.keys,
        userAgent: navigator.userAgent,
      }),
    })
    if (!res.ok) return { ok: false, reason: 'network' }
  } catch {
    return { ok: false, reason: 'network' }
  }

  return { ok: true, endpoint: json.endpoint }
}

/**
 * Unsubscribe this browser. Best-effort — tells both the browser's
 * PushManager and the backend. Returns { ok, reason? }.
 */
export async function unsubscribePush() {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' }
  const reg = await navigator.serviceWorker.getRegistration(SW_URL)
  if (!reg) return { ok: true }
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return { ok: true }

  const endpoint = sub.endpoint
  await sub.unsubscribe().catch(() => {})
  try {
    const token = await getToken()
    await fetch('/api/v1/push/subscribe', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ endpoint }),
    })
  } catch { /* backend unreachable — browser side is already unsubscribed */ }

  return { ok: true }
}

/** True when this browser has a live push subscription. */
export async function hasActiveSubscription() {
  if (!isPushSupported()) return false
  const reg = await navigator.serviceWorker.getRegistration(SW_URL)
  if (!reg) return false
  const sub = await reg.pushManager.getSubscription()
  return !!sub
}
