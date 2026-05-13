---
slug: profile-and-settings
title: Profile and settings
category: account
tags: [profile, settings, notifications, push, privacy, account]
status: PUBLISHED
admin_only: false
---

# Profile and settings

Your profile is the page other players see when they click your name. Settings control notifications, password, and account deletion.

## Profile page

Open `/profile` (or click your avatar). The profile is organized into expandable sections:

- **Display name** — edit inline. (Your username is permanent; display name is what other players see.)
- **Stats** — open by default. Shows your tournament classification (Rookie / Amateur / Intermediate / etc.), ELO history chart, win/loss record.
- **Credits & tier** — your TC, HPC, BPC balances; activity tier; "Email me on achievements" toggle.
- **My bots** — your bots in a table view with create, train, spar, and delete actions per bot. The "Create bot" wizard walks you through name → persona → confirm. Names are checked against the reserved list (Rusty/Copper/Sterling/Magnus), platform profanity list, and per-owner uniqueness in real time.
- **Recurring tournaments** — your standing subscriptions; opt out per template.
- **Danger zone** — account deletion (irreversible).

The **public profile** at `/users/:username` is currently a stub linking to the rankings; full public profile pages are slated for a later release.

## Settings page

Open Settings from your avatar menu. The actual sections you'll see:

### Notification Sounds (client-side)

- **Enable sounds** — global toggle.
- **Sound choice** — pick from a small set (Guide, Alert, etc.).
- **Preview** — play the selected sound.

These are stored per-browser; they don't sync to other devices.

### Push Notifications

- **Browser support check** — tells you if your browser supports Web Push (Chrome/Edge/Firefox yes; Safari requires installed PWA).
- **Permission request** — first click opens the browser's permission prompt.
- **Per-device enable toggle** — push fires only to devices where you've opted in.

If your browser denies push, the panel surfaces the reason ("denied", "unsupported", "no VAPID key", etc.).

### Event Notification Preferences

A grid of 15 event types, each with separate **in-app** and **email** toggles. Categories:

- **Tournament announcements** — `tournament.published`, `tournament.flash_announced`.
- **My tournament reminders** — recurring occurrence opened, registration closing, starting soon, started.
- **My tournament results** — completed, cancelled, match.result.
- **Match ready** — your tournament match is ready to play (in-app + email by default).
- **Achievements** — tier upgrade, milestone.
- **Admin / system** — announcements and alerts.

Defaults are sensible (mostly in-app on, email selectively on); change any toggle and it saves immediately.

### Tournament Result Preference

Choose how match results show in your feed — currently "as played" is the default (records appear in chronological order). Other options may be added.

### Flash Tournament Start Alerts

A boolean toggle. When on, you get an in-app and (if configured) push notification whenever a Flash tournament starts.

### Password Management

Change your password by entering the current one plus a new one twice. Errors (wrong current password, weak new password) surface inline.

### Account Deletion

Click **Delete my account**, confirm via checkbox, and the platform runs `deleteUserWithBots` — your user record, owned bots, owned skills, and tournament participations are removed. The action is irreversible. Other players' games against you are kept; your name is replaced with a placeholder where it appears in their history.

If you only want a break, you can mute push and email via the preference toggles instead of deleting.

## Idle session handling

If you leave the tab idle past the warn threshold (30 minutes by default), you'll see a "Still there?" prompt. If you don't respond within the grace period (5 minutes by default), the platform signs you out automatically. Both thresholds are admin-tunable in SystemConfig.

## Where to give feedback

A floating 💬 button at the bottom-right corner of every page opens the Feedback modal. It captures the page URL and (optionally) a screenshot. Bug reports go to the admin queue; suggestions are triaged. The button hides automatically during active gameplay.
