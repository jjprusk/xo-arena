---
slug: notifications
title: Notifications — in-app, email, push
category: account
tags: [notifications, push, email, preferences]
status: PUBLISHED
admin_only: false
---

# Notifications — in-app, email, push

AI Arena has three notification channels: **in-app** (a stack inside the Guide drawer), **email** (delivered via Resend), and **browser push** (when your device supports it and you opt in). Each event type has independent toggles per channel.

## Where to set preferences

Settings → Event Notification Preferences. Each event has an **in-app** checkbox and an **email** checkbox; push is gated globally per-device (see below).

## The 15 event types

| Event | Default in-app | Default email | What it means |
|---|---|---|---|
| `tournament.published` | on | off | A new public tournament was announced. |
| `tournament.flash_announced` | on | off | A Flash tournament was just announced (short-notice). |
| `tournament.registration_closing` | on | off | A tournament you can still enter is closing soon. |
| `tournament.starting_soon` | on | off | A tournament you're in starts in minutes. |
| `tournament.started` | on | off | A tournament you're in just started. |
| `tournament.recurring_occurrence_opened` | on | off | A recurring template you subscribed to spawned a new occurrence; you're auto-enrolled. |
| `tournament.completed` | on | **on** | A tournament you played in completed. |
| `tournament.cancelled` | on | **on** | A tournament you registered for was cancelled. |
| `match.ready` | on | **on** | Your tournament match is ready to play. |
| `match.result` | on | off | A match you played has a result. |
| `achievement.tier_upgrade` | on | off | You moved up an activity tier (Bronze→Silver, etc.). |
| `achievement.milestone` | on | off | You hit a discovery milestone (first tournament win, etc.). |
| `admin.announcement` | on | off | Platform-wide message from admins. |
| `system.alert` | on | off | Operational alert (e.g., maintenance). |
| `system.alert.cleared` | on | off | The above alert is resolved. |

Defaults err on "tell me in-app, don't email me unless it really matters". Email defaults to *on* only for completed/cancelled tournaments and match.ready — the things you'd be sad to miss.

## Push notifications

Push is **per-device** and **opt-in**:

1. In Settings → Push Notifications, you'll see your browser's support status.
2. Click **Enable** to request permission. Your browser shows its own permission prompt.
3. Once granted, push fires to *that device* for any in-app-enabled event you have opted into. Other devices stay quiet until they also opt in.

Browser support: Chrome, Edge, Firefox, and Safari (when AI Arena is installed as a PWA on macOS / iOS). Without PWA, Safari does not support web push.

If permission is denied, you can change it from your browser's site-settings panel — AI Arena cannot re-prompt once denied.

## Tournament Result Preference

A separate setting controls **how match results are listed** in your feed. The current option is `AS_PLAYED` (chronological); future modes (grouped-by-tournament, grouped-by-day) may be added.

## Flash Tournament Start Alerts

A one-click boolean. When on, you get a high-priority in-app + push notification whenever a Flash tournament starts — useful if you want first-mover advantage on short-notice brackets.

## In-app notification stack

The in-app channel is rendered as a **stack inside the Guide drawer**. New notifications appear at the top, old ones expire after a configurable TTL. You can dismiss them individually or batch-clear from the drawer menu.

A red badge on the Guide orb indicates unread urgent items (match.ready, system.alert).

## Sound

Notification sounds are client-side and per-browser:

- Toggle on/off in Settings → Notification Sounds.
- Pick from several preset sounds.
- Preview each sound from the picker.

A sound plays for every in-app notification when sound is enabled — it does *not* play for email or background push (those have their own platform-controlled sounds).

## Unsubscribing entirely

If you want a complete break, set every event type to in-app=off and email=off, and disable push from Settings. The platform still records events server-side; you just don't get pinged.
