# AI Arena — Platform UI Design

## Overview

This document covers the user interface design decisions for the entire AI Arena platform. It is not specific to any one feature or game — it governs the shared design language, navigation model, component architecture, and cross-site experience that all applications in the platform family inherit.

The platform currently consists of two live sites:

| Site | Purpose |
|------|---------|
| `aiarena.callidity.com` | Platform hub — tournaments, rankings, replays, profile |
| `xo.aiarena.callidity.com` | XO Arena — free play, bots, leaderboard |

Future sites (Connect4 Arena, Checkers Arena, etc.) will follow the same patterns established here.

---

## Design Language

### Visual Identity — Site Family Model

The platform uses a **family resemblance** model (Option C). Sites are related but distinct:

- **Shared**: typography, spacing scale, component shapes, base primitives, accessibility standards
- **Distinct**: colour palette and background treatment per site

This model scales cleanly as new games are added — each game gets its own colour identity while the scaffolding feels consistent to users moving between sites.

| Site | Primary colour | Background treatment |
|------|---------------|---------------------|
| `aiarena` | Slate blue `#4A6FA5` | Colosseum photo, faded |
| `xo.aiarena` | Teal `#24B587` | Mountain photo, faded |
| Future games | TBD per game | TBD per game |

### Typography

Both sites use the same typefaces, sourced from Google Fonts:

- **Display / headings**: Inter Tight, weights 600–800
- **Body / UI**: Inter, weights 400–600
- **Mono**: Menlo (code blocks, countdowns)

### Tone

Clean and open. Personality with restraint. The Guide persona ("Guide") has a slightly AI-leaning character — helpful, knowledgeable, not over the top.

### Theme

System default (light or dark), with a manual override available in the nav. Both sites respect `prefers-color-scheme`.

### Accessibility

WCAG AA minimum across all surfaces. Requirements:

- Skip-nav link on every page
- `aria-live` regions for all dynamic content (notifications, countdowns, search results)
- `role="dialog"` and focus management for all overlays and panels
- Keyboard-navigable throughout; Escape closes any open panel
- `prefers-reduced-motion` respected — all animations disabled at 0.01ms when set

---

## Shared Packages

Before the aiarena frontend can be built, four packages must be extracted or created in the monorepo:

| Package | Contents | Status |
|---------|----------|--------|
| `packages/xo` | XO game board component, game logic, PvP socket integration | **Critical path** — required for inline tournament match play and for adding a second game |
| `packages/auth` | BetterAuth client config, `getToken()`, `useSession()` hook | Seamless cross-site auth under `.aiarena.callidity.com` domain |
| `packages/ui` | Tailwind preset, spacing/type scale, base component primitives | Shared design foundation; each site applies its own colour palette on top |
| `packages/guide` | Guide panel component, slot system, notification stack, online strip | Platform-wide; deployed to every site in the family |

**Build order**: `packages/auth` → `packages/ui` → `packages/xo` → `packages/guide` → `aiarena/` app

`packages/xo` is the critical path item — it is a prerequisite for inline tournament match play at aiarena and for adding any second game. It should be planned and executed as a discrete task before the aiarena build begins.

---

## Authentication

Authentication is seamless across all sites. BetterAuth token domain is set to `.aiarena.callidity.com` so a single sign-in covers the entire platform. `packages/auth` wraps this consistently so all frontend apps import the same hooks and token utilities.

Guest users may view tournaments, rankings, and replays without an account. Registration is required to enter tournaments or play games.

---

## Navigation

### Admin Navigation

Admin surfaces (tournament management, classification config, merit thresholds, user management) use a **traditional structured menu** — sidebar or top-nav with clearly labelled sections. The destination space is large and users navigate it deliberately.

### General User Navigation

For general users the **Guide is the primary cross-platform navigation and action mechanism**. Traditional nav links remain in the header (supplementary), but the Guide is the single place to move between sites, trigger cross-site actions, receive alerts, and invoke platform features.

This is a deliberate product differentiator: the Guide reinforces the platform's AI identity, reduces cognitive load, and makes navigation itself part of the experience.

The Guide is **platform-wide** — it appears on every site in the family with the same component, same slot system, and same notification stack. Slot configuration is per-site with user overrides on top.

---

## The Guide

### Overview

The Guide is a floating panel opened by a glowing orb button in the header. It is the single notification surface, navigation aid, and action launcher across the entire platform.

**Invocation**: on-demand via the orb button. The orb pulses slowly in its normal state and switches to an urgent amber pulse when time-sensitive notifications are present.

**State storage**: slot configuration and user preferences are stored server-side in a `preferences` JSON field on the `User` record so the Guide follows the user across devices and browsers.

### Slot System

The Guide panel contains a grid of up to **8 quick-action slots** (4 columns). Rules:

- Empty slots are hidden — only filled slots are visible
- Slots are user-configurable: add from a curated action library, remove, drag to reorder
- Each site has its own default slot configuration; users customise on top
- **Onboarding slots** are pre-filled at account creation, displayed with a dashed amber border and a ⏱ expiry indicator. They auto-remove after a configured period (default 30 days)
- Edit mode (gear button) reveals drag handles, remove badges (×), and empty Add slots up to the cap of 8
- A slot picker overlay organises the full action library by section: Platform, XO Arena, Onboarding

### Action Library

Actions fall into two classes:

| Class | Description | Examples |
|-------|-------------|---------|
| **Local** | Navigate or act within the current site | Go to Tournaments, My Tier, Rankings, Flash Tournaments |
| **Cross-site** | Deep-link to another site in a ready state | Play XO vs community bots (from aiarena), Join flash tournament (from xo.aiarena) |

Cross-site actions are the key differentiator — they make the Guide feel like a unified platform rather than a collection of separate apps.

### Notification System

The Guide notification stack is the **single in-app notification surface** across the entire platform. There are no separate page-level banners. All real-time alerts surface here.

#### Notification types

| Type | Trigger | Urgency | Actions |
|------|---------|---------|---------|
| `flash` | Flash tournament announced | Urgent — amber orb pulse | Join / Dismiss |
| `match_ready` | Tournament match ready to play | Urgent — amber orb pulse | Go to match / Dismiss |
| `admin` | Broadcast from admin to all users | Normal — blue badge | Got it |
| `invite` | Another user challenges you to a game | Normal — blue badge | Accept / Decline |
| `room_invite` | Another user invites you to join their open room | Normal — blue badge | Join now / Maybe later |

#### Context-aware delivery

- **Passive context** (browsing, lobby, rankings) — Guide auto-opens when an urgent notification arrives
- **Active context** (mid-game, filling a form) — orb pulses urgently, badge count updates; Guide never auto-opens

#### Stack behaviour

- Up to 3 cards visible at once; additional shown as a "+N more" indicator
- Notifications ordered by arrival time, newest first
- Dismissing or acting on a card removes it from the stack and decrements the badge count
- Orb returns to normal slow pulse when the stack is empty

### Game Invites

Users can invite any other player to a game via a Guide slot action (⚔️ Invite). Flow:

1. Open the invite panel (slides in over the Guide)
2. Search for and select a player — online status shown next to each name
3. Select the game
4. Send

**Routing**:
- **Online** → real-time `invite` notification card delivered to recipient's Guide stack immediately via Socket.io
- **Offline** → falls through to the email notification service with a deep link to the game

Invite expiry: **5 minutes by default**, configurable by admins globally via `SystemConfig` (key: `invite.expiryMinutes`). When an invite expires it auto-dismisses and the sender receives a quiet `invite_expired` notification.

### Online Presence Strip

A compact strip of avatars is displayed in the Guide below the notification stack, showing currently signed-in players. Tapping an avatar sends a **one-tap room invite** — a `room_invite` notification delivered directly to that player's Guide with a link to the sender's current room.

This is distinct from the general game invite: it requires no configuration, works only for online players, and carries the sender's current room context automatically.

**Online strip rules**:
- Shows up to 6 avatars; overflow displayed as "+N more"
- Online indicator (green dot) on each avatar
- Only online users are shown — no offline fallback for room invites
- Invite expires after the same `invite.expiryMinutes` window as general invites

### Technical Approach

The Guide's conversational layer uses a **hybrid model**: rule-based intent matching handles navigation and known actions client-side at zero cost; unrecognised queries fall through to a Claude API call for flexible natural-language handling. This balances cost and capability.

---

## Platform Page Structure (aiarena)

```
aiarena.callidity.com/
├── /                  ← Platform home (featured tournaments, highlights)
├── /tournaments       ← Tournament hub (browse, register, watch, results)
├── /rankings          ← Cross-game leaderboards
├── /replays           ← Game replay browser
├── /games             ← Directory of available games
└── /profile           ← Platform-level player profile
```

### Player Profile Hierarchy

| Level | URL | Content |
|-------|-----|---------|
| Platform | `aiarena.callidity.com/profile` | Cross-game overview, tournament classification, credits, links to game profiles |
| Game-specific | `xo.aiarena.callidity.com/profile` | XO ELO, XO stats, XO bots, XO game history |

### Rankings

The `/rankings` page provides two views:

- **Overall** — cross-game leaderboard ranked by tournament classification tier (primary), activity score (secondary), combined ELO (tertiary)
- **By game** — per-game leaderboard with a game selector; mirrors the leaderboard on each game site

---

## Design Exercise (Prerequisites to Build)

The following decisions must be resolved in a design session before the aiarena build begins:

1. **aiarena visual identity spec** — slate blue confirmed, Inter confirmed, system dark/light confirmed. Not yet formalised as a buildable spec that `packages/ui` can be built from.
2. **Admin menu structure** — information architecture for the tournament admin section: top-level categories, page hierarchy, how classification config, merit thresholds, and demotion settings are organised. Nothing designed yet.
3. **Shared vs. distinct component surface** — which primitives (buttons, cards, inputs, badges) go into `packages/ui` vs. remain site-specific overrides.
4. **Guide technical approach** — confirm hybrid model; decide Claude model, token budget, and fallback behaviour.

---

## Open Items

### Blocking — Prerequisites to Build

| # | Item | Notes |
|---|------|-------|
| 1 | **Admin menu structure** | Nothing designed yet. See Design Exercise above. |
| 2 | **aiarena visual identity spec** | Decisions made but not formalised as a buildable spec. |
| 3 | **Shared vs. distinct component surface** | Depends on identity spec (#2). |

### Non-Blocking — Resolve During Design Iteration

| # | Item | Notes |
|---|------|-------|
| 4 | **Guide: primary vs. supplementary nav** | Lobby mockup leans supplementary. Not formally settled. |
| 5 | **Guide technical approach** | Hybrid model agreed in principle; model, token budget, fallback not yet specified. |
| 6 | **Onboarding arrow design** | Configurable arrows for onboarding slots that expire. Mentioned, not yet designed. |
| 7 | **Online strip — activity status** | Future phase: show what a player is doing ("in a tournament", "playing", "browsing"). Not in scope for alpha. |

### Mockups Not Yet Built

| # | Page / Surface | Key elements |
|---|---------------|-------------|
| 8 | **Tournament detail page** | Bracket view, match status, registration panel, notification preference selector |
| 9 | **Classification / player profile page** | Tier badge, merit history, promotion/demotion progress, match record |
| 10 | **Admin tournament pages** | Tournament list, create/edit form, classification config panel, merit threshold settings |
| 11 | **xo.aiarena Guide integration** | Guide on the game site with cross-site slots; flash tournament notification in active-game context |

### Resolved

| # | Item | Resolution |
|---|------|-----------|
| — | Flash tournament page banner | Removed — surfaces in Guide notification stack instead |
| — | Lobby background treatment | Colosseum photo, `opacity: 0.25`, `background-position: center 30%` |
| — | Guide name and persona | "Guide" — AI-leaning, personality with restraint |
| — | Guide invocation model | On-demand floating orb button in header |
| — | Site colour palette | Slate blue (`#4A6FA5`) for aiarena; teal retained for xo.aiarena |
