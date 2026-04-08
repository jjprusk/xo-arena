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

## aiarena Visual Identity Spec

This section is the buildable spec for `packages/ui` and the `aiarena` application. It is the authoritative source for all design tokens, typography, shape, elevation, and background treatment.

### Color Tokens

#### Primary — Slate Blue

| Token | Hex | Use |
|-------|-----|-----|
| `primary-50` | `#EEF3FA` | Tinted backgrounds, subtle highlights |
| `primary-100` | `#D5E2F3` | Hover backgrounds, selected states |
| `primary-200` | `#AABFE6` | Borders, dividers |
| `primary-300` | `#7A9DD4` | Disabled foreground |
| `primary-400` | `#5580BC` | Secondary actions |
| `primary-500` | `#4A6FA5` | **Base — buttons, links, active nav** |
| `primary-600` | `#3D5D8A` | Button hover |
| `primary-700` | `#304A6E` | Button pressed; dark mode primary |
| `primary-800` | `#233653` | Dark surface accents |
| `primary-900` | `#162338` | Deep backgrounds |

#### Neutral — Zinc

Standard Tailwind zinc scale (`zinc-50` through `zinc-950`). Zinc's slight cool cast pairs well with slate blue and is shared across all sites in the family.

#### Semantic Colors

| Token | Hex | Use |
|-------|-----|-----|
| `amber-500` | `#F59E0B` | Urgent notifications, flash tournaments, onboarding orb pulse |
| `green-500` | `#22C55E` | Online status, success states |
| `red-500` | `#EF4444` | Errors, ban indicators, destructive actions |
| `purple-500` | `#A855F7` | Match-ready notifications |

#### Surface Tokens

Semantic surface names are defined in `packages/ui`; values are set per site.

**Light mode:**

| Token | Value | Use |
|-------|-------|-----|
| `surface-base` | `zinc-50` `#FAFAFA` | Page background |
| `surface-raised` | `#FFFFFF` + shadow-md | Cards, panels |
| `surface-overlay` | `#FFFFFF` + shadow-lg | Modals, drawers |
| `surface-sunken` | `zinc-100` `#F4F4F5` | Input backgrounds, code blocks |

**Dark mode (tone steps — no shadows):**

| Token | Value | Use |
|-------|-------|-----|
| `surface-base` | `zinc-950` `#09090B` | Page background |
| `surface-raised` | `zinc-900` `#18181B` | Cards, panels |
| `surface-overlay` | `zinc-800` `#27272A` | Modals, drawers |
| `surface-sunken` | `zinc-950` `#09090B` | Input backgrounds |

#### Text Tokens

| Token | Light | Dark |
|-------|-------|------|
| `text-primary` | `zinc-900` | `zinc-50` |
| `text-secondary` | `zinc-600` | `zinc-400` |
| `text-muted` | `zinc-400` | `zinc-600` |
| `text-inverse` | `#FFFFFF` | `zinc-900` |
| `text-link` | `primary-500` | `primary-300` |

#### Border Tokens

| Token | Light | Dark |
|-------|-------|------|
| `border-default` | `zinc-200` | `zinc-800` |
| `border-subtle` | `zinc-100` | `zinc-900` |
| `border-strong` | `zinc-300` | `zinc-700` |

---

### Typography Scale

All sizes in rem; base = 16px.

| Role | Typeface | Size | Weight | Line height |
|------|----------|------|--------|-------------|
| `display` | Inter Tight | 3rem (48px) | 800 | 1.1 |
| `h1` | Inter Tight | 2.25rem (36px) | 700 | 1.2 |
| `h2` | Inter Tight | 1.75rem (28px) | 700 | 1.25 |
| `h3` | Inter Tight | 1.375rem (22px) | 600 | 1.3 |
| `h4` | Inter Tight | 1.125rem (18px) | 600 | 1.4 |
| `body-lg` | Inter | 1.125rem (18px) | 400 | 1.7 |
| `body` | Inter | 1rem (16px) | 400 | 1.6 |
| `body-sm` | Inter | 0.875rem (14px) | 400 | 1.5 |
| `caption` | Inter | 0.75rem (12px) | 400 | 1.4 |
| `mono` | Menlo | 0.875rem (14px) | 400 | 1.5 |

---

### Shape — Border Radius

Soft profile, consistent with xo.aiarena.

| Token | Value | Use |
|-------|-------|-----|
| `radius-sm` | 6px | Badges, tags, small inputs |
| `radius-md` | 10px | Buttons, cards, inputs |
| `radius-lg` | 16px | Modals, panels, large cards |
| `radius-full` | 9999px | Pills, guide orb, avatars |

---

### Elevation Model — Hybrid

Light mode uses shadows; dark mode uses tone steps (no shadows).

**Light mode shadows:**

| Token | Value | Use |
|-------|-------|-----|
| `shadow-sm` | `0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)` | Subtle card lift |
| `shadow-md` | `0 4px 12px rgba(0,0,0,0.10), 0 2px 4px rgba(0,0,0,0.06)` | Cards, dropdowns |
| `shadow-lg` | `0 20px 40px rgba(0,0,0,0.12), 0 8px 16px rgba(0,0,0,0.08)` | Modals, overlays |

Dark mode elevation is achieved via the tone-step surface tokens above — no shadow is applied.

---

### Background Treatment

The Colosseum photo is used across **aiarena platform pages** (the main platform site and admin). Individual game sites — including **xo.aiarena** — keep their own distinct backgrounds that fit their game identity. xo.aiarena uses the mountain background (`mountain-bg.jpg`). The Colosseum is not applied to game sites.

```css
/* aiarena global background */
.site-bg {
  position: fixed;
  inset: 0;
  background: url('/colosseum-bg.jpg') center 30% / cover no-repeat;
  opacity: 0.15;
  pointer-events: none;
  z-index: 0;
}

.dark .site-bg {
  opacity: 0.08;
}
```

If the photo proves visually heavy on data-dense pages (admin tables, reports), a per-page override can reduce opacity further or suppress it entirely — decided during implementation, not pre-empted here.

---

### Animation

| Token | Duration | Easing | Use |
|-------|----------|--------|-----|
| `duration-fast` | 100ms | ease-out | Hover states, badge count changes |
| `duration-normal` | 200ms | ease-out | Panel open, tooltip appear |
| `duration-slow` | 300ms | ease-out | Modal enter, Guide panel slide |
| — | — | ease-in | All exit animations (reverse of above) |

`prefers-reduced-motion`: all durations collapse to `0.01ms`.

---

### packages/ui Boundary

This resolves Design Exercise #3 (shared vs. distinct component surface).

**`packages/ui` provides (shared across all sites):**
- Tailwind preset: spacing scale, type scale, border radius tokens, shadow tokens, animation tokens
- CSS custom property names (token names only — not values)
- Base component primitives: `Button`, `Card`, `Input`, `Select`, `Badge`, `Avatar`, `Spinner`, `Tooltip`, `Modal`
- Components are built against token names (`--color-primary`, `--surface-raised`, etc.) with no hardcoded colours

**Each site provides (site-specific overrides):**

- Token values in their `tailwind.config.js` (primary colour scale, surface colours)
- Background image and opacity
- Any site-specific component variants (e.g. the Guide orb glow colour)

This means adding a third game site requires only a new colour palette and background image — all component behaviour, spacing, and typography are inherited automatically.

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

All admin functions live at **`aiarena.callidity.com/admin`** — the single unified admin panel for the entire platform. The xo.aiarena admin panel is deprecated immediately and redirects to the platform admin. As additional games are added, per-game admin settings appear as sub-sections under **Games** rather than as separate admin surfaces.

Admin navigation uses a **sidebar** with clearly labelled top-level sections. The destination space is large and users navigate it deliberately.

#### Admin Sidebar Structure

```
Tournaments
  ├── All Tournaments       ← list view, filterable by status / mode / game
  ├── Create Tournament     ← full creation form
  └── Flash Tournament      ← quick-trigger panel; also available as a Guide slot (admin only)

Classification
  ├── Tier Thresholds       ← merit values required for promotion at each tier boundary
  ├── Merit Values          ← points awarded per result type (win / draw / loss / finish position)
  └── Demotion Rules        ← inactivity window, review period, opt-out settings

Players
  ├── Player List           ← all users; columns: username, tier badge, ELO, last active, status
  └── Player Profile        ← game stats, tier history, credits balance, ban controls, bot limits

Bots & ML
  ├── Bot List              ← all bots across all users; filter by owner, competitive flag, activity
  └── ML Models             ← model inventory, training status, storage usage per user

Games
  ├── XO Arena              ← ELO config, match settings, leaderboard controls
  └── Game Registry         ← enable / disable games platform-wide; cross-site routing config

Reports
  ├── Tournament Stats      ← participation counts, completion rates, format and mode breakdown
  ├── Tier Distribution     ← player counts per tier, promotion / demotion trends over time
  └── Activity Overview     ← DAU / WAU, game volume, bot vs. human match ratio

System
  ├── General Settings      ← invite expiry, onboarding TC reward amount, platform feature flags
  └── Notifications         ← admin broadcast tool: compose and send an admin-type Guide notification to all users
```

All Reports pages include a **Export PDF** action. Reports are read-only dashboards.

#### Admin Guide Slot (Flash Tournament)

The Guide action library includes an **Admin** section visible only to users with the admin role. Flash Tournament is the primary action — one tap opens the quick-trigger panel. Admins can pin it to their Guide slots for fast access during events. Additional admin actions may be added to this section over time.

### General User Navigation

For general users the **Guide is the primary cross-platform navigation and action mechanism**. Traditional nav links remain in the header (supplementary), but the Guide is the single place to move between sites, trigger cross-site actions, receive alerts, and invoke platform features.

This is a deliberate product differentiator: the Guide reinforces the platform's AI identity, reduces cognitive load, and makes navigation itself part of the experience.

The two layers serve distinct jobs and do not compete: **header nav links handle destinations** (where do I go); **the Guide handles actions and alerts** (what do I do, what needs my attention). A user who never opens the Guide can still navigate the site normally via header links. A user who lives in the Guide gets a richer, more integrated experience.

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

### Onboarding Journey

New users are guided through a 7-step journey that teaches the platform progressively — from watching a game to competing in a tournament with their own trained bot. The journey lives entirely inside the Guide, reinforcing it as the platform's primary navigation hub from the user's first interaction.

#### Entry point

On the very first login the Guide auto-opens to the Journey card (step 1 — Welcome). This is the only login-triggered auto-open. After that, the orb and contextual triggers keep the journey visible without being intrusive.

#### Orb state during onboarding

While the journey is in progress the orb displays a **progress ring** (e.g. a subtle arc showing 3 of 7 steps complete) with a slow amber pulse — visually distinct from both the normal idle pulse and the urgent notification pulse. The ring disappears when the journey is complete or dismissed.

Users learn quickly that the ring means "your journey is in progress." Clicking the orb opens the Guide to the Journey card.

#### Contextual auto-open (Option 4)

When the user navigates to a page that matches their current uncompleted step, the Guide auto-opens to that step. Examples:

| Page | Step triggered |
|------|---------------|
| `/gym` (first visit, no training runs) | Step 5 — Train your bot |
| Bot list (no bots created) | Step 4 — Create your first bot |
| `/gym/guide` | Step 3 — Learn how AI training works |
| Tournament lobby | Step 6 — Enter a tournament |

The Guide never auto-opens mid-game or while a form is being filled (same active-context rule as urgent notifications).

#### Journey steps

| # | Step | Completion trigger | Guide action |
|---|------|--------------------|--------------|
| 1 | **Welcome to XO Arena** | Auto — first login | Context text only |
| 2 | **Play a game — see how it works** | First game completed (any mode) | Cross-site: opens XO vs community bot, game queued and ready |
| 3 | **Learn how AI training works** | Visit `/gym/guide` | Cross-site: opens `xo.aiarena.callidity.com/gym/guide` |
| 4 | **Create your first bot** | First bot created (API event) | Cross-site: opens bot creation flow |
| 5 | **Train your bot** | First training run completes (`totalEpisodes > 0`) | Cross-site: opens Gym |
| 6 | **Enter a tournament** | First tournament registration | Cross-site: opens tournament lobby |
| 7 | **Play your first tournament match** | First tournament match played | Celebration — journey complete |

Steps complete automatically when the underlying event is detected — no "mark as done" button. Progress is stored server-side in the `preferences` JSON field on the `User` record so the journey follows the user across devices and browsers.

#### Guide presentation

- A **Journey card** is pinned at the top of the Guide panel, above the notification stack
- Collapsed view: progress bar ("3 of 7 complete") + next step title + action button
- Expanded view: all 7 steps, checkmarks on completed ones, action buttons on uncompleted ones
- A **× dismiss** button in the card corner — requires a one-tap confirmation prompt before permanently hiding the journey

#### Contextual spotlight

When the user is on a page relevant to their current step, a highlight ring and floating label appear on the specific UI element they need to interact with.

**Visual treatment (Option A):**

- 2px animated amber pulse ring around the target element
- Small floating label positioned above or below the element: *"Step N: [step title] →"*
- Amber colour matches the Guide's onboarding language — consistent, immediately recognisable
- Non-disruptive: the page remains fully usable; the spotlight is a hint, not a blocker

**Examples:**

- Bot list with no bots → ring on "Create Bot" button: *"Step 4: Create your first bot →"*
- `/gym` with no training runs → ring on "Start Training": *"Step 5: Train your bot →"*
- Tournament lobby (not yet registered) → ring on first tournament's "Register" button: *"Step 6: Enter a tournament →"*

The spotlight dismisses automatically when the step completes or the user navigates away. It never appears mid-game.

#### Dismissal

- Dismissed state stored server-side — the journey never resurfaces after dismissal
- A **Restart onboarding** option in Settings → Account for users who want to revisit
- On restart, already-completed steps remain marked done — the user continues from where they left off

#### Completion reward

When step 7 is recorded:

- Confetti burst in the Guide panel
- **Onboarding Complete** badge awarded to the user's profile
- **50 TC** (Tournament Credits) deposited — enough to enter a couple of tournaments and keep the momentum going

#### Relationship to existing components

The current `GettingStartedModal.jsx`, `getting-started.html` SVG journey map, and `onboardingStore.js` are replaced by this system. The "Getting Started" header button is removed — the Guide orb is the sole entry point. The SVG map may be archived or repurposed as a decorative asset.

---

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

#### Rule-based layer (client-side, zero cost)

Handles all recognisable intents before any API call is made:

- **Navigation**: "go to tournaments", "show rankings", "open gym" → direct route push
- **Known actions**: "invite someone", "flash tournament", "my profile" → trigger slot action
- **Onboarding FAQ**: "how do I train a bot", "what's a tier" → static canned response
- **Out of scope**: deflects with *"I can help with navigation, tournaments, and platform questions."*

#### Claude API layer (server-side fallback)

Only queries that clear the rule-based layer reach Claude.

| Parameter | Value |
|-----------|-------|
| Model | `claude-haiku-4-5-20251001` |
| Input cap | 1,500 tokens (system prompt ~600, history ~800, user message ~100) |
| Output cap | 250 tokens |
| History window | Rolling last 6 turns |
| Per-user rate limit | 20 calls / hour; resets on the hour |

**System prompt** is assembled server-side per request and injects: current page, user context (onboarding step, tier, active tournament), available slot actions as a structured list, and persona directive (concise, helpful, slightly AI-leaning, never verbose). The prompt is never sent from the client.

#### Fallback behaviour

| Scenario | Behaviour |
|----------|-----------|
| Claude timeout (> 4s) | Canned: *"Having trouble connecting — try navigating directly or check back shortly."* |
| API unavailable | Same canned message; rule-based layer continues normally |
| Rate limit reached | Quiet inline note: *"I'm running a bit slow right now — try asking more directly or use the slots below."* No error state shown. |

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

1. ~~**aiarena visual identity spec**~~ — **Resolved.** See aiarena Visual Identity Spec section above.
2. ~~**Admin menu structure**~~ — **Resolved.** See Admin Navigation section above.
3. ~~**Shared vs. distinct component surface**~~ — **Resolved.** See packages/ui Boundary section above.
4. **Guide technical approach** — confirm hybrid model; decide Claude model, token budget, and fallback behaviour.

---

## Open Items

### Blocking — Prerequisites to Build

All blocking design exercises are resolved. The aiarena build may begin once `packages/ui` is initialised with the identity spec above.

### Non-Blocking — Resolve During Design Iteration

| # | Item | Notes |
|---|------|-------|
| 3 | ~~**Guide: primary vs. supplementary nav**~~ | **Resolved.** See below. |
| 4 | **Guide technical approach** | Hybrid model agreed in principle; model, token budget, fallback not yet specified. |
| 5 | ~~**Onboarding spotlight design**~~ | **Resolved.** See below. |
| 6 | ~~**Online strip — activity status**~~ | **Deferred.** Show what a player is doing ("in a tournament", "playing", "browsing"). Not in scope for alpha. |

### Mockups Not Yet Built

| # | Page / Surface | Key elements |
|---|---------------|-------------|
| 7 | **Tournament detail page** | Bracket view, match status, registration panel, notification preference selector |
| 8 | **Classification / player profile page** | Tier badge, merit history, promotion/demotion progress, match record |
| 9 | **Admin pages** | Sidebar layout, tournament list, create/edit form, classification config, reports with PDF export |
| 10 | **xo.aiarena Guide integration** | Guide on the game site with cross-site slots; flash tournament notification in active-game context |
| 11 | **Onboarding Journey card** | Guide Journey card (collapsed + expanded states), orb progress ring, completion celebration |
| 12 | **XO Arena site UI review** | Audit current xo.aiarena frontend against the new design system: palette, typography, component styling, Guide integration, nav structure, Colosseum background. Identify gaps and produce a prioritised list of changes needed before or alongside Guide/onboarding implementation. |

### Resolved

| # | Item | Resolution |
|---|------|-----------|
| — | Admin menu structure | Unified at aiarena.callidity.com/admin; sidebar with 7 sections; xo.aiarena admin deprecated immediately |
| — | Admin — xo.aiarena admin fate | Deprecated immediately, redirects to platform admin |
| — | Admin — Flash Tournament | Sub-item under Tournaments; also pinnable as Guide slot action (admin only) |
| — | Admin — Reports | Read-only dashboards with PDF export from day one; 3 reports: Tournament Stats, Tier Distribution, Activity Overview |
| — | Onboarding journey | Guide-native journey tracker (orb progress ring + contextual auto-open); 7 steps; dismissible; badge + 50 TC reward |
| — | Onboarding — auto-open rule | Guide auto-opens on first login only; orb progress ring + contextual page triggers thereafter |
| — | Flash tournament page banner | Removed — surfaces in Guide notification stack instead |
| — | Lobby background treatment | Colosseum photo, `opacity: 0.25`, `background-position: center 30%` |
| — | Guide name and persona | "Guide" — AI-leaning, personality with restraint |
| — | Guide invocation model | On-demand floating orb button in header |
| — | Site colour palette | Slate blue (`#4A6FA5`) for aiarena; teal retained for xo.aiarena |
| — | Guide technical approach | Hybrid: rule-based client-side + Haiku 4.5 fallback; 1,500 token input cap, 250 token output cap, 20 calls/user/hour |
| — | Guide: primary vs. supplementary nav | Option C — header nav handles destinations; Guide handles actions, notifications, and cross-site operations. Neither competes. |
| — | Onboarding spotlight design | Option A — amber pulse ring around target element, small floating label with step title. Non-disruptive; consistent with Guide amber language. |
| — | Online strip — activity status | Deferred to post-alpha. |

---

## Addendum — Deferred Features and Future Considerations

### Guide AI — Cost and Volume Scaling

The current Guide AI approach (Claude Haiku 4.5 as a separate API service) is appropriate for early-stage usage. If platform volume grows significantly — many concurrent users making frequent Guide queries — the per-call cost of the external Claude API will become material.

**Future consideration**: if Claude API costs increase significantly relative to platform scale, migrate the Guide's conversational layer to a backend-hosted model integrated with the existing AI infrastructure rather than continuing to call the external API per query. This would bring the Guide's intelligence in-house alongside the existing ML/bot training backend, reduce per-query cost, and allow tighter integration with user and game state without round-tripping through the API.

This is not a day-one concern — monitor monthly Claude API spend as a line item and trigger this evaluation if it exceeds a meaningful fraction of total infrastructure cost.

### xo.aiarena UI — Structured Revisit Required

The xo.aiarena frontend was built organically without a formal design spec. Now that the platform identity spec (color tokens, type scale, shape, elevation, spacing) is formalised, the existing game UI should be audited and brought into alignment.

This is not a full redesign — it is an alignment pass. It should be planned as a discrete task once `packages/ui` is initialised, so the primitives already exist to migrate to.

---

## XO Arena UI Audit — Findings

*Conducted April 2026 against the design system spec in this document.*

### Stack summary (current)

| Layer | What's there |
|-------|-------------|
| Framework | React 19.2, React Router v7, Vite + Tailwind v4 |
| State | Zustand 5.0 (7 stores) |
| Real-time | Socket.IO |
| Auth | Better Auth |
| Fonts | Inter 400/500/600/700 + Inter Tight 700/800 (Google Fonts) — **matches spec** |
| Sound | Howler.js + Web Audio API synth |
| Charts | Recharts (lazy-loaded) |

---

### Gap Analysis by Area

#### 1. Background image

| | Current | Spec |
|---|---------|------|
| Image | `mountain-bg.jpg` | `mountain-bg.jpg` — **correct** (Colosseum is aiarena platform only; game sites keep their own backgrounds) |
| Opacity (light) | 0.30 | 0.25 |
| Opacity (dark) | 0.30 (no dark override) | 0.08 |
| Position | `center center` | `center 30%` |

**Action**: keep mountain image; add dark-mode opacity override via `--photo-opacity` CSS var; adjust position to `center 30%`.

---

#### 2. Color tokens

**Aligned:**

- Teal palette (`#24B587` / `#1D9E75`) — matches spec exactly; retained as xo.aiarena primary
- Amber palette (`#D4891E`) — matches
- Red (`#E85554`) — matches
- Warm gray scale (`gray-50: #F1EFE8` through `gray-900`) — matches
- Light/dark CSS variable split on `:root` / `.dark` — matches approach

**Missing / wrong:**

- **Slate blue ramp absent** — `#4A6FA5` (platform primary, used for Guide, nav accents, and admin) has no tokens in `index.css`. The current blue (`#2E86E0`) is for X marks only; the platform accent colour is entirely missing.
- **`--color-slate-{50–900}` ramp** needs to be added to `index.css`.
- The Guide trigger, orb, active nav states, and focus rings all reference slate tokens — without them the Guide component cannot be added.

**Action**: add the full slate blue ramp (50–900) to `index.css` with the values from this spec.

---

#### 3. Border radius

**Current:** No border-radius tokens defined. Tailwind utilities used inline (`rounded-lg`, `rounded-xl`, etc.) with no consistency check.

**Spec:** Soft profile — `6px` (sm), `10px` (md/default), `16px` (lg/card), `9999px` (pill). Named tokens: `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-pill`.

**Action**: define the four radius tokens in `index.css`. Audit key components (cards, buttons, badges, modals, nav items) and apply consistently.

---

#### 4. Elevation (shadows)

**Current:** `--shadow-sm`, `--shadow-md`, `--shadow-card`, `--shadow-cell`, `--shadow-cell-win` — defined but not audited for dark mode adaptation.

**Spec:** Hybrid elevation — shadows in light mode, tone steps (slightly lighter surface) in dark mode.

**Action**: review dark-mode shadow values; ensure cards in dark mode use tone elevation (`bg-surface-2`) rather than box shadows.

---

#### 5. Navigation

**Current nav structure:**

- Play · Gym · Puzzles · Tournaments · Rankings
- Admin links inline in the top bar (desktop only, amber-tinted)
- Mobile: bottom tab bar (Play / Gym / Tourney / Ranks / Profile) + hamburger slide-out
- Guide: separate "✦ Guide" pill button (conditionally shown, not integrated with nav)

**Spec navigation:**

- Header: destination links only (Play / Gym / Tournaments / Rankings)
- Guide: orb button replaces "✦ Guide" pill — floating panel, not a modal
- Admin: all admin routes redirect to `aiarena.callidity.com/admin`; admin links removed from xo.aiarena header
- Mobile: bottom tab bar stays (good — keep as is); hamburger kept for overflow

**Gaps:**

- Admin links need to be removed from the xo.aiarena header and replaced with a single "Admin" link that navigates to the platform admin URL
- "Puzzles" is an xo.aiarena-specific link — keep it
- "✦ Guide" pill replaced by the Guide orb component (new build)
- Guide component needs to be wired into nav at the same position

**Action**: strip admin links from xo.aiarena nav, add platform admin redirect, build Guide orb component.

---

#### 6. Guide / onboarding system

This is the largest gap — a near-complete rebuild.

**Current implementation:**
| Component | What it does |
|-----------|-------------|
| `GettingStartedModal.jsx` | Renders `/getting-started.html` in a fullscreen iframe |
| `WelcomeModal.jsx` | Pop-up shown to signed-out first-time visitors after 1.2s delay |
| `AccomplishmentPopup.jsx` | One-at-a-time toast for tier upgrades and credit milestones |
| `prefsStore.js` | Tracks `showGuideButton` flag and basic hint state |
| `onboardingStore.js` | Checks if user has completed first training run |

**Spec requirements:**
| Component | What needs to exist |
|-----------|---------------------|
| Guide orb + panel | Floating panel opened by orb in header |
| Slot system | 8 configurable quick-action slots; edit mode; slot picker overlay |
| Notification stack | Flash, match_ready, admin, invite, room_invite cards |
| Journey card | 7-step tracker, collapsed/expanded, orb progress ring |
| Contextual spotlight | Amber pulse ring + label on target elements |
| Cross-site actions | Slots that deep-link to gym, tournaments, bot creation |
| Completion reward | Confetti + badge + 50 TC on step 7 |
| Server-side state | Slot config + journey progress stored in `User.preferences` |

**What can be reused:**

- `AccomplishmentPopup.jsx` socket listener logic → migrate into Guide notification stack
- `onboardingStore.js` training check → feeds into journey step 5 completion
- `prefsStore.js` → can be subsumed into Guide store

**What gets retired:**

- `GettingStartedModal.jsx` (iframe approach replaced)
- `WelcomeModal.jsx` (replaced by Guide auto-open on first login)
- `/getting-started.html` (archived; SVG journey map may be repurposed as a decorative asset)

**Action**: build the Guide as a new `GuidePanel` component. Wire it into `AppLayout`. Replace/retire the three current modals.

---

#### 7. Component library state

**Current:** No centralised component library. Buttons, badges, and cards are styled inline with Tailwind + CSS variables. The only shared UI components are `UserAvatar`, `SearchBar`, `ListTable`, `ThemeToggle`, `MuteToggle`, `Skeleton`.

**Spec:** `packages/ui` boundary — shared token names + base primitives (Button, Badge, Card, Avatar, Input). Site-specific: token values, background, variants.

**Action**: this is a phased effort. In the near term, align inline components to spec tokens. After `packages/ui` is created (a separate milestone), migrate.

---

#### 8. Typography

**Current fonts:** Inter 400/500/600/700 + Inter Tight 700/800 — **fully aligned with spec**. No changes needed.

---

#### 9. Mobile experience

**Current:** Bottom tab bar (5 items) + hamburger slide-out. Responsive layouts on key pages.

**Spec:** Bottom tab bar retained. Guide orb in top-right header replaces the "✦ Guide" button on mobile as well.

**Action**: ensure Guide orb is tap-friendly on mobile (minimum 44px touch target). Guide panel should be full-screen or bottom-sheet on small viewports. Verify tournament list, profile, and game board remain usable at 375px.

---

#### 10. Admin

**Current:** Admin links removed from xo.aiarena nav (Phase 2 complete). The `/admin/*` routes and page components (`AdminUsersPage`, `AdminTournamentsPage`, `AdminBotsPage`, etc.) still exist in the xo.aiarena app and remain fully functional — admins can reach them by navigating directly.

**Target:** All admin functionality lives at `aiarena.callidity.com/admin`. xo.aiarena admin routes are deprecated once the platform admin has feature parity.

**Why not now:** The platform admin is currently a mockup only. Removing or redirecting the xo.aiarena admin routes before the platform admin is built would leave admins without working tools. The existing pages serve as a functional bridge during the transition.

**Deprecation plan (Phase 7 — last step):** Once the platform admin at `aiarena.callidity.com/admin` is built and covers the xo.aiarena admin feature set, redirect all `/admin/*` routes in App.jsx to the platform admin URL and remove the local admin page components. The xo.aiarena-specific admin data (games config, ELO settings, match settings, leaderboard controls) becomes a sub-section under **Games → XO Arena** in the platform admin sidebar as specified in the Admin Navigation section above.

---

### Prioritised Implementation Plan

Phases are ordered by dependency. Each phase is a discrete PR or sprint. Status is noted where work has begun.

#### Phase 0 — Remove existing onboarding from xo.aiarena

*Clean-slate step. Remove all current onboarding UI and logic so Phase 4's Journey system is built from scratch without conflicts or legacy code.*

1. [ ] Audit and list all current onboarding-related files, components, hooks, and store slices (search for: `onboarding`, `tutorial`, `walkthrough`, `first-time`, `intro`, `welcome`)
2. [ ] Remove onboarding UI components (e.g. step modals, tooltips, banners, popovers that are part of the tutorial flow)
3. [ ] Remove onboarding state from Zustand stores (clear any `onboardingStep`, `hasSeenTutorial`, `tourComplete`, etc.)
4. [ ] Remove onboarding-related API calls and backend endpoints (if any — e.g. `POST /api/onboarding/complete`)
5. [ ] Remove onboarding-related database flags from frontend (schema changes, if any, are deferred until Phase 4 defines the Journey schema)
6. [ ] Remove any route guards or redirects that funnel new users into an onboarding flow
7. [ ] Smoke-test: new user registration → lobby loads cleanly with no onboarding prompts
8. [ ] Smoke-test: existing user login → no stale onboarding state shown

**Acceptance criteria:**

- `grep -r "onboarding\|tutorial\|walkthrough" frontend/src` returns no matches in component or store files (doc/comments OK)
- New and returning user flows both reach the lobby without any onboarding overlay or redirect
- All existing non-onboarding tests pass

**Effort:** Small–Medium. **Risk:** Low — delete-only; no new logic introduced.

---

#### Phase 1 — Token alignment ✅ Done

*Pure CSS changes. No component logic. Builds the foundation all subsequent phases depend on.*

1. ✅ Add `--color-slate-{50–900}` ramp to `index.css` (platform accent colour for Guide, nav accents, focus rings)
2. ✅ Add `--radius-sm` (6px), `--radius-card` (16px), `--radius-pill` (9999px) tokens
3. ✅ Add `--bg-surface-2` (secondary surface / dark-mode tone elevation step) to both themes
4. ✅ Add `--shadow-nav` token
5. ✅ Add `--photo-opacity` CSS variable (0.25 light / 0.08 dark) — dark mode auto-subdues background
6. ✅ Fix background position to `center 30%`; keep `mountain-bg.jpg` (xo.aiarena visual identity — Colosseum is aiarena platform only)

**Commit:** `295b275` + `5614d8e`

---

#### Phase 2 — Navigation cleanup ✅ Done

*Remove admin links from xo.aiarena header; stub Guide button with slate tokens.*

1. ✅ Remove inline admin nav links from desktop header (`AppLayout.jsx`)
2. ✅ Remove admin section from hamburger menu
3. ✅ Replace both with single external "Admin ↗" link → `aiarena.callidity.com/admin` (admin role only)
4. ✅ Update Guide pill button gradient to use slate tokens (visual interim — full orb in Phase 3)
5. ✅ Remove `ADMIN_MENU_LINKS` constant; add `PLATFORM_ADMIN_URL` constant

**Nav link set confirmed for xo.aiarena:** Play · Gym · Puzzles · Tournaments · Rankings · Stats · Profile · About

**Commit:** `295b275`

---

#### Phase 3 — Guide component build

*The core new UI work. Build the Guide as a self-contained component that replaces the existing pill button and GettingStartedModal.*

**Frontend sub-tasks:**
1. ✅ `GuideOrb` — orb button in nav header; progress ring SVG overlay; urgent amber pulse; notification badge count
2. ✅ `GuidePanel` — slide-in right panel; header with orb + title + close/settings; scrollable body; chat input footer
3. ✅ `SlotGrid` — 8 configurable quick-action slots in a 4-column grid; edit mode (gear button) exposes drag handles and × remove badges; onboarding slots render with dashed amber border and ⏱ expiry
4. ✅ `SlotPicker` overlay — action library organised by section: Platform / XO Arena / Onboarding; cross-site actions labelled ↗
5. ✅ `NotificationStack` — card types: `flash` (amber, urgent), `match_ready` (slate, urgent), `admin` (blue), `invite` (teal), `room_invite` (teal); dismiss removes card and decrements badge; up to 3 visible + "+N more"
6. ✅ `OnlineStrip` — up to 6 online player avatars; amber dot = in-match; tap sends one-tap room invite
7. ✅ `GuideStore` (Zustand) — panel open/close, slot config, notification queue, journey progress; mirrors server-side state
8. ✅ Wire `AccomplishmentPopup` socket events → Guide `NotificationStack`
9. ✅ Wire Flash tournament socket events → Guide `NotificationStack` (urgent, never auto-opens mid-game)
10. ✅ Active-game context rule: detect mid-game state; block Guide auto-open; show orb pulse only

**Backend sub-tasks:**
1. ✅ Add `preferences` JSONB column to `User` table (or extend existing if present); fields: `guideSlots`, `journeyProgress`, `journeyDismissed`
2. ✅ `GET /api/guide/preferences` — return slot config + journey state for authenticated user
3. ✅ `PATCH /api/guide/preferences` — update slot config or journey fields
4. ✅ Socket event: `guide:notification` — server pushes notification cards to connected user's Guide stack

**Retire on completion:** `GettingStartedModal.jsx` (iframe approach), `WelcomeModal.jsx` (replaced by Guide auto-open on first login)

**Effort:** Large (1–2 sprints). **Risk:** Medium — real-time notification wiring and backend schema require coordination.

---

#### Phase 4 — Onboarding journey

*Build the Journey card inside the Guide panel. Requires Phase 0 (legacy onboarding removed) and Phase 3 complete.*

**Frontend sub-tasks:**
1. `JourneyCard` component — collapsed view (progress bar + next step + CTA) and expanded view (all 7 steps with checkmarks, arrows, action buttons); pinned above notification stack
2. Orb progress ring updates to reflect step count (amber arc, 0–7)
3. Contextual auto-open hook — on page load, check current route against incomplete step trigger map; call `guideStore.open()` if matched; never triggers mid-game or mid-form
4. `useSpotlight(stepIndex, targetRef)` hook — renders amber 2px pulse ring around target element + floating label ("Step N: [title] →"); dismisses on step completion or navigation
5. Completion celebration — confetti burst, "Onboarding Complete" badge pop, +50 TC deposit notification
6. Dismiss flow — × button in card corner → one-tap confirmation overlay → `journeyDismissed: true` synced server-side
7. "Restart onboarding" option in Settings → Account

**Backend sub-tasks:**
1. Journey step completion detection — server-side where possible (first game completed, first bot created, first training run, first tournament registration, first tournament match); emit `guide:journeyStep` socket event on detection
2. TC deposit on step 7 — trigger existing credits system; send `guide:notification` with type `admin` confirming reward
3. `POST /api/guide/journey/dismiss` — mark dismissed server-side

**Retire on completion:** `onboardingStore.js` (replaced by journey state in GuideStore); `/getting-started.html` (archive or repurpose SVG journey map as decorative asset)

**Effort:** Large (1 sprint). **Risk:** Medium — steps 2, 4, 5, 6 require cross-site deep-links (Phase 5 dependency for full flow; journey card can ship without cross-site actions and add them in Phase 5).

---

#### Phase 5 — Cross-site slot actions

*Wire Guide slot actions that deep-link across aiarena sites. Requires Phase 3.*

1. Define cross-site URL scheme — e.g. `xo.aiarena.callidity.com/go?action=play-bot` or via a central redirect at `aiarena.callidity.com/go?target=xo&action=play-bot`
2. "Play XO vs community bot" — opens xo.aiarena game page with community bot pre-selected and game queued
3. "Open Gym" — opens `xo.aiarena.callidity.com/gym` with training flow in ready state
4. "Enter tournament" — opens tournament lobby with registration modal pre-opened for the relevant tournament
5. Journey step deep-links use the same scheme (steps 2, 3, 4, 5, 6)

**Effort:** Medium. **Risk:** Medium — requires coordination between the xo.aiarena and aiarena apps; auth token needs to be passed or user already signed in via shared auth.

---

#### Phase 6 — Component library alignment (ongoing)

*Progressively migrate inline-styled components to shared token usage. Not a big-bang rewrite — runs alongside other phases.*

1. **Buttons** — define `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger` CSS classes in `index.css`; replace inline `linear-gradient` button styles site-wide
2. **Badges / pills** — define `.badge`, `.badge-open`, `.badge-live`, `.badge-done` etc.; replace inline badge styling
3. **Cards** — define `.card` CSS class with `--radius-card`, `--shadow-card`, `--border-default`; audit pages for consistency
4. **Modals** — build a `<Modal>` component with correct backdrop blur, animation (`slide-up`), close-on-Escape, and `aria-modal`; migrate `NamePromptModal`, `AuthModal` and any remaining modals
5. **When `packages/ui` is created** — migrate base primitives (Button, Badge, Card, Avatar, Input) to the shared package; import from there in xo.aiarena

**Effort:** Medium (small PRs per component type, can run in parallel with other phases). **Risk:** Low.

---

#### Phase 7 — xo.aiarena admin deprecation (last step)

*Do this only after the platform admin at `aiarena.callidity.com/admin` has full feature parity with the current xo.aiarena admin pages.*

**Prerequisite checklist — platform admin must cover:**

- [ ] User list with tier, ELO, online status, ban controls
- [ ] User profile detail view
- [ ] Bot list with owner, competitive flag, activity
- [ ] Tournament list, create/edit form, flash trigger, results view
- [ ] XO Arena game config (ELO settings, match timeout, leaderboard toggle)
- [ ] Reports: Tournament Stats, Tier Distribution, Activity Overview
- [ ] System: general settings, notification broadcaster
- [ ] Feedback inbox (currently at `/admin/feedback` and `/support`)

**Migration steps:**
1. Verify each checklist item is live and tested in the platform admin
2. In `frontend/src/App.jsx`, replace all `/admin/*` `<Route>` entries with a single catch-all that redirects to `PLATFORM_ADMIN_URL`
3. Remove local admin page component imports from `App.jsx`
4. Archive (do not delete immediately) `frontend/src/pages/admin/` — keep for 30 days as a safety net, then remove in a follow-up PR
5. Remove `AdminRoute` and `SupportRoute` guard components if no longer needed
6. Update `FeedbackButton` and `FeedbackToast` unread-count logic if the feedback inbox has moved

**Effort:** Small (mostly deletions once platform admin is ready). **Risk:** Low if checklist is complete before cutting over.

---

### Summary table

| Phase | What | Status | Effort | Risk | Dependency |
|-------|------|--------|--------|------|-----------|
| 0 | Remove existing onboarding from xo.aiarena | Upcoming | Small–Medium | Low | — |
| 1 | Token alignment (palette, radius, photo opacity) | ✅ Done | Small | Very low | — |
| 2 | Nav cleanup (admin links out, Guide pill → slate) | ✅ Done | Small | Low | — |
| 3 | Guide component build | ✅ Done | Large | Medium | Phase 1, 2 |
| 4 | Onboarding journey | Upcoming | Large | Medium | Phase 0, 3 |
| 5 | Cross-site slot actions | Upcoming | Medium | Medium | Phase 3, 4 |
| 6 | Component library alignment | Ongoing | Medium | Low | Phase 1 |
| 7 | xo.aiarena admin deprecation | Last step | Small | Low | Platform admin feature-complete |

Phase 0 clears the slate for the new onboarding system. Phase 3 is the core new build — start here once Phases 0–2 are done. Phases 4 and 5 follow in sequence. Phase 6 runs in the background. Phase 7 is gated on the platform admin being fully built and verified.

---

## Integrated UI Implementation Plan

This section ties together all UI work across both the xo.aiarena game site refresh and the new aiarena platform surfaces (Guide, onboarding, admin). It is the single source of truth for sequencing, team responsibilities, acceptance criteria, and testing.

---

### Team and Skills Required

| Role | Person | Responsibilities | Skills |
|------|--------|-----------------|--------|
| **Orchestrator** | Claude (AI) | Break phases into tasks, write and review code, enforce design spec, coordinate between engineers, flag blockers | Full-stack context, design spec, codebase |
| **Frontend Engineer (primary)** | TBD | Guide component, onboarding journey, xo.aiarena UI alignment, component library | React 19, Zustand, Tailwind v4, CSS custom properties, SVG animation, Socket.IO client, Vite |
| **Frontend Engineer (secondary / can overlap)** | TBD | Platform admin build (aiarena), cross-site routing, packages/ui extraction | Same as above; familiarity with multi-repo or monorepo patterns |
| **Backend Engineer** | TBD | Guide preferences API, journey step detection, TC deposit, Socket.IO events, admin API | Node.js, Prisma, PostgreSQL, Socket.IO, REST API design |
| **UI/UX (design review)** | TBD | Sign off each phase against mockups before merge; catch visual regressions; review new mockups as needed | Figma or HTML mockup evaluation; familiarity with the design spec in this document |
| **QA Engineer** | TBD | Manual smoke tests per phase; own the E2E Playwright suite additions; cross-browser and mobile viewport testing | Playwright, visual comparison, cross-browser, mobile |
| **DevOps (light touch)** | TBD | Railway deploy coordination; environment variable management for new API endpoints | Railway, GitHub Actions CI |

### Phase 3 Active Team

For Phase 3 specifically, the active team is:

| Role | Person | Phase 3 focus |
|------|--------|---------------|
| **Orchestrator** | Claude (AI) | Task breakdown, code implementation, PR review, design spec enforcement |
| **Frontend Engineer (primary)** | TBD | Build `GuideOrb`, `GuidePanel`, `SlotGrid`, `SlotPicker`, `NotificationStack`, `OnlineStrip`, `GuideStore` |
| **Backend Engineer** | TBD | `guide/preferences` API, `guide:notification` Socket.IO event, Flash/accomplishment wiring |
| **UI/UX (design review)** | TBD | Visual sign-off against `doc/mockups/xo-game.html` before merge to staging |
| **QA Engineer** | TBD | Smoke test on staging; Playwright coverage for orb toggle, panel open/close, notification dismiss |

Frontend secondary and DevOps are not needed until Phase 5+ (cross-site actions) and have no Phase 3 responsibilities.

A team of 2 engineers (1 frontend-heavy, 1 backend-heavy) plus UI/UX and QA can execute Phase 3 in one sprint, with frontend and backend working in parallel.

---

### Development Streams

Work can be parallelised across two streams once Phase 1+2 are merged (done).

```
Stream A — xo.aiarena (game site)          Stream B — aiarena platform
─────────────────────────────────          ────────────────────────────
Phase 6: Component library alignment  ──►  Platform admin build (new app)
Phase 3: Guide component (frontend)   ──►  Guide backend API
Phase 4: Onboarding journey           ──►  Journey step events + TC deposit
Phase 5: Cross-site slot actions      ──►  Cross-site redirect service
Phase 7: Admin deprecation (last)     ◄──  Platform admin feature-complete
```

Stream A and Stream B share a backend engineer. The frontend engineers can work in parallel: one on xo.aiarena components, one on the platform admin app.

---

### Milestones

| # | Milestone | What's shippable | Phases complete |
|---|-----------|-----------------|-----------------|
| M0 | **Foundation** | Token ramp, nav cleanup live on staging | 1, 2 ✅ |
| M1 | **Guide MVP** | Guide orb, panel, slots, notification stack live; old Guide modal retired | 3 |
| M2 | **Onboarding live** | Full 7-step journey, spotlight, completion reward; old modals retired | 4 |
| M3 | **Cross-site connected** | Guide slots deep-link across sites; journey steps 2–6 fully automated | 5 |
| M4 | **Component library** | Buttons, badges, cards, modals consistent across xo.aiarena | 6 |
| M5 | **Platform admin live** | aiarena.callidity.com/admin fully functional | (separate build) |
| M6 | **Full deprecation** | xo.aiarena admin routes removed; single unified admin | 7 |

M0 is already done. M1 is the next target. M5 and M6 can overlap in timing — M6 gates on M5.

---

### Phase 0 — Remove Existing Onboarding: Tasks, Acceptance Criteria, Tests

#### Tasks

- [ ] `grep -r "onboarding\|tutorial\|walkthrough\|GettingStarted\|WelcomeModal\|firstLogin\|hasSeenTutorial\|tourComplete" frontend/src` — audit and list every match
- [ ] Delete or empty identified onboarding components (step modals, intro tooltips, welcome popovers, tutorial overlays)
- [ ] Remove onboarding fields from Zustand stores (e.g. `onboardingStep`, `hasSeenTutorial`)
- [ ] Remove any route guards or redirects that funnel new users into an onboarding flow
- [ ] Remove onboarding-related API calls from frontend (backend endpoints / DB columns deferred — Phase 4 will define the new schema)
- [ ] Verify `AppLayout.jsx` has no remaining onboarding modal imports or invocations
- [ ] Run full unit + Playwright smoke suite; confirm no regressions

#### Acceptance Criteria

| # | Criterion |
|---|-----------|
| 1 | `grep -r "onboarding\|tutorial\|walkthrough" frontend/src/components frontend/src/store` returns zero results |
| 2 | New user registration → lobby renders with no onboarding UI |
| 3 | Existing user login → lobby renders with no stale onboarding state |
| 4 | All existing Playwright smoke tests pass |

#### Tests

| Type | What to test |
|------|-------------|
| Manual | Register fresh account → reach lobby with no tutorial modal/overlay |
| Manual | Login existing account → no onboarding state shown |
| Playwright | `smoke` suite passes |
| Unit | Any onboarding store slices deleted; no orphaned imports |

---

### Phase 3 — Guide Component: Tasks, Acceptance Criteria, Tests

#### Tasks

**Frontend**

- [x] `GuideOrb` component: circular orb button, SVG progress ring (animated arc for 0–7 steps), idle / onboarding-amber / urgent-amber pulse animations, notification badge, minimum 44px touch target
- [x] `GuidePanel` component: slide-in panel from right (320px desktop, full-width mobile bottom-sheet), header with orb + title + settings/close buttons, scrollable body, chat input footer
- [x] `SlotGrid` component: 4-column grid, up to 8 slots, edit mode (gear toggles drag handles + × badges + empty "Add" slots), onboarding slots with dashed amber border and ⏱ expiry countdown
- [x] `SlotPicker` overlay: modal with action library by section (Platform / XO Arena / Onboarding / Admin); cross-site actions labelled ↗; selecting adds to next empty slot
- [x] `NotificationStack` component: ordered by arrival, newest first; up to 3 visible + "+N more"; flash (amber), match_ready (slate), admin (blue), invite (teal), room_invite (teal); dismiss animates out and decrements badge
- [x] `OnlineStrip` component: up to 6 avatar tiles + overflow count; amber dot = in-match; green dot = available; tap sends room invite notification
- [x] `GuideStore` (Zustand): `panelOpen`, `slots[]`, `notifications[]`, `journeyProgress`, `journeyDismissed`; `addNotification`, `dismissNotification`, `updateSlots` actions; hydrates from server on sign-in
- [x] Active-game detection: `useIsInGame()` hook reads `gameStore` + `pvpStore`; blocks Guide auto-open; orb still pulses urgently
- [x] Retire `GettingStartedModal.jsx` import and usage from `AppLayout.jsx`; retire `WelcomeModal.jsx` (first-login opens Guide panel instead)
- [x] Replace Guide pill button in nav with `GuideOrb` component

**Backend**

- [x] Add `guideSlots` and `guideNotificationPrefs` JSONB fields to `User.preferences` (Prisma migration)
- [x] `GET /api/guide/preferences` — return slots + notification prefs for authenticated user
- [x] `PATCH /api/guide/preferences` — update slots or prefs; validate slot count ≤ 8
- [x] Socket event `guide:notification` — server pushes notification cards to user's connected socket; client `GuideStore` receives and enqueues
- [x] Wire existing Flash tournament socket event into `guide:notification` with type `flash`
- [x] Wire existing accomplishment socket event into `guide:notification` with type `match_ready` or `admin` as appropriate

#### Acceptance criteria

- [x] Guide orb visible in nav on all pages when signed in
- [x] Clicking orb toggles panel open/closed; Escape closes it
- [x] Panel does not auto-open mid-game (play page with active game); orb pulses urgently if notification arrives
- [x] Panel does auto-open for urgent notifications when user is in a passive context (browsing, lobby, rankings)
- [x] Slots load from server on sign-in; changes persist across page reloads and devices
- [x] Notification badge count matches number of unread notification cards
- [x] Dismissing a notification card removes it and decrements badge; badge disappears at 0
- [x] Flash tournament notification arrives in real time and triggers amber orb pulse
- [x] Guide pill button and `GettingStartedModal` are gone from the codebase
- [x] First sign-in opens Guide panel (not a modal iframe)
- [x] All Guide UI passes WCAG AA: orb has `aria-label`, panel has `role="dialog" aria-modal`, slots are keyboard-navigable

#### Tests

| Type | What | Tool |
|------|------|------|
| Unit | `GuideStore` actions: addNotification, dismiss, slot update, badge count | Vitest |
| Unit | `useIsInGame()` returns true when `gameStore` has active board | Vitest |
| Integration | `PATCH /api/guide/preferences` persists slot config; `GET` returns it | Vitest (backend) |
| Integration | Socket event `guide:notification` arrives in `GuideStore.notifications` | Vitest with mock socket |
| E2E | Open Guide → dismiss notification → badge decrements | Playwright |
| E2E | Flash tournament announcement → orb pulses amber → open Guide → notification card present | Playwright |
| E2E | Edit slots → reorder → reload page → order persists | Playwright |
| Visual | Guide panel at 1280px, 768px, 375px against mockup screenshots | Manual / Playwright screenshot |
| A11y | Keyboard navigation through panel and slots; screen reader announces notification | axe-core / manual |

---

### Phase 4 — Onboarding Journey: Tasks, Acceptance Criteria, Tests

#### Tasks

**Frontend**

- [ ] `JourneyCard` component: pinned at top of Guide body above notification stack; collapsed state (progress bar, next step name, CTA button, expand toggle); expanded state (all 7 steps with status markers, action buttons on uncompleted steps, dismiss link at bottom)
- [ ] Orb progress ring: update ring fill arc as step count changes (0/7 = empty, 7/7 = full); amber during journey, teal on completion
- [ ] `useJourneyAutoOpen()` hook: on route change, check `GuideStore.journeyProgress` against step trigger map; if current route matches an incomplete step and user is not mid-game, call `guideStore.open()`
- [ ] `useSpotlight(stepIndex, targetRef)` hook: renders amber 2px pulse ring as absolutely-positioned overlay around `targetRef`; floating label above/below with "Step N: [title] →"; hides when step completes or route changes
- [ ] Add spotlight to: Tournaments page first "Register" button (step 6), bot list "Create Bot" button (step 4), Gym page "Start Training" button (step 5)
- [ ] Completion celebration: confetti component (40 pieces, randomised colours/sizes/durations), "Onboarding Complete" badge pop animation, Guide notification card announcing +50 TC
- [ ] Dismiss flow: × in card header → confirmation overlay ("Dismiss your journey? Your progress is saved.") → "Keep going" / "Yes, dismiss" → on confirm, `PATCH /api/guide/preferences` with `journeyDismissed: true`; Journey card removed from panel
- [ ] "Restart onboarding" option in Settings → Account page: calls `POST /api/guide/journey/restart`; resets dismissed flag; journey resumes from first incomplete step
- [ ] Retire `onboardingStore.js` (training completion check absorbed into journey step 5 state in GuideStore)

**Backend**

- [ ] `journeyProgress` JSONB field in `User.preferences`: `{ completedSteps: number[], dismissedAt: string|null }`
- [ ] Step completion detection for server-detectable steps:
  - Step 2: first game record created (`GameRecord` table)
  - Step 4: first bot created (`User` where `isBot=true` and `createdBy=userId`)
  - Step 5: first training run completes (`totalEpisodes > 0`)
  - Step 6: first tournament registration (`TournamentParticipant` row created)
  - Step 7: first tournament match played (match with `tournamentId` recorded)
- [ ] On each detection: update `journeyProgress.completedSteps`, emit `guide:journeyStep` socket event to user
- [ ] Step 1 (Welcome): auto-complete on first sign-in (server marks step 1 complete when user record is created)
- [ ] Step 3 (AI training guide visit): client-side — fire `POST /api/guide/journey/step/3` when user visits `/gym/guide`
- [ ] Step 7 completion: deposit 50 TC via existing credits system; emit `guide:notification` with type `admin` confirming reward; award "Onboarding Complete" badge to user profile
- [ ] `POST /api/guide/journey/restart`: clear `completedSteps` and `dismissedAt`

#### Acceptance criteria

- [ ] Journey card appears for new users on first sign-in with step 1 pre-completed (Welcome)
- [ ] Journey card does not appear after journey is dismissed (persists across sessions)
- [ ] Progress bar and ring reflect actual completed step count
- [ ] Completing step 4 (bot creation) while Guide is closed: orb badge increments; opening Guide shows step updated
- [ ] Contextual auto-open fires when navigating to tournament lobby with step 6 incomplete; does not fire mid-game
- [ ] Spotlight ring appears on "Register" button in tournament lobby when step 6 is active; disappears on registration
- [ ] Step 7 completion triggers confetti in Guide panel, "Onboarding Complete" badge on profile, +50 TC deposit
- [ ] Dismissal requires confirmation; dismissed state survives sign-out and back in
- [ ] Restart onboarding in Settings reactivates Journey card from first incomplete step

#### Tests

| Type | What | Tool |
|------|------|------|
| Unit | `JourneyCard` renders correct step count and CTA per step index | Vitest + React Testing Library |
| Unit | `useJourneyAutoOpen` fires on correct routes; does not fire when `useIsInGame()` is true | Vitest |
| Unit | `useSpotlight` mounts/unmounts ring on correct step transitions | Vitest |
| Integration | Server marks step 2 complete after `GameRecord` insert; emits socket event | Vitest (backend) |
| Integration | Step 7 completion triggers TC deposit and badge award | Vitest (backend) |
| Integration | `POST /api/guide/journey/restart` resets progress | Vitest (backend) |
| E2E | New user flow: sign in → Guide opens → complete step 2 (play game) → step updates in panel | Playwright |
| E2E | Complete all 7 steps → confetti fires → badge appears on profile | Playwright |
| E2E | Dismiss journey → confirm → journey card gone → sign out → sign back in → still gone | Playwright |
| E2E | Restart journey from Settings → journey card reappears | Playwright |
| Visual | Journey card collapsed + expanded states against `onboarding-journey.html` mockup | Manual |
| Visual | Spotlight ring positioned correctly on Register button at 1280px and 375px | Manual |

---

### Phase 5 — Cross-Site Slot Actions: Tasks, Acceptance Criteria, Tests

#### Tasks

- [ ] Define and document the cross-site URL scheme (decision: query-param approach on each target site, e.g. `xo.aiarena.callidity.com/play?action=vs-community-bot`)
- [ ] xo.aiarena `/play` page: read `?action=vs-community-bot` query param on mount; auto-select community bot and queue game
- [ ] xo.aiarena `/gym` page: read `?action=start-training` param; open TrainTab and focus training config
- [ ] xo.aiarena `/tournaments` page: read `?action=register&tournamentId=X` param; open registration modal for specified tournament
- [ ] Guide slot actions updated: "Play XO vs community bot", "Open Gym", "Enter tournament" use the cross-site URLs
- [ ] Journey step CTAs updated to use cross-site URLs for steps 2, 3, 4, 5, 6

#### Acceptance criteria

- [ ] Clicking "Play XO vs community bot" Guide slot navigates to xo.aiarena game page with bot pre-selected
- [ ] Clicking "Open Gym" slot navigates to Gym with training config focused
- [ ] Journey step 6 CTA opens tournament lobby with registration modal for a suitable upcoming tournament
- [ ] Arriving from a cross-site link works whether user is already signed in or signs in mid-flow

#### Tests

| Type | What | Tool |
|------|------|------|
| E2E | Click Guide slot → lands on correct page → correct action is pre-triggered | Playwright (cross-origin) |
| E2E | Journey step 2 CTA → play page → game loads vs community bot | Playwright |

---

### Phase 6 — Component Library Alignment: Tasks, Acceptance Criteria, Tests

#### Tasks

- [ ] **Buttons**: add `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-sm` CSS classes to `index.css`; audit and replace all inline `linear-gradient` button styles across all page components
- [ ] **Badges**: add `.badge`, `.badge-open`, `.badge-live`, `.badge-done`, `.badge-draft`, `.badge-pvp`, `.badge-bot`, `.badge-mixed` classes; replace inline badge styling in `TournamentsPage`, `TournamentDetailPage`, `ProfilePage`, `LeaderboardPage`
- [ ] **Cards**: add `.card`, `.card-header`, `.card-body` classes using `--radius-card`, `--shadow-card`, `--border-default`; audit pages and replace inline card containers
- [ ] **Modals**: build `<Modal>` component with backdrop blur, `slide-up` animation, Escape-to-close, `aria-modal`; migrate `NamePromptModal`, `AuthModal`
- [ ] **Form inputs**: define `.form-input`, `.form-select`, `.form-textarea` with consistent focus ring using `--color-slate-500`; audit Settings, Profile, and tournament forms
- [ ] **Dark-mode cards**: verify cards in dark mode use tone elevation (`--bg-surface-2`) rather than box shadows; update any that still rely on `--shadow-card` alone

#### Acceptance criteria

- [ ] All primary action buttons across the site use the same visual style
- [ ] All status badges are visually consistent regardless of which page renders them
- [ ] Cards have consistent radius (16px), border, and shadow at all breakpoints
- [ ] Modal backdrop, animation, and close behaviour is identical across all modals
- [ ] Focus rings on all interactive elements use `--color-slate-500` consistently
- [ ] Dark mode cards do not have visible box-shadow halos; elevation is communicated by tone

#### Tests

| Type | What | Tool |
|------|------|------|
| Visual | Button variants (primary, secondary, danger, sm) in light + dark | Manual / Playwright screenshot |
| Visual | Badge variants across all types | Manual |
| Visual | Card with header + body in light + dark at 375px, 768px, 1280px | Manual |
| A11y | All buttons have accessible name; all form inputs have associated labels | axe-core |

---

### Phase 7 — Admin Deprecation: Tasks, Acceptance Criteria, Tests

*Gated on platform admin at `aiarena.callidity.com/admin` having full feature parity. See prerequisite checklist in the Phase 7 section above.*

#### Tasks

- [ ] Verify all items on the feature parity checklist are live and tested in platform admin
- [ ] Replace all `/admin/*` `<Route>` entries in `App.jsx` with a single `<Navigate to={PLATFORM_ADMIN_URL} />` or server-level redirect
- [ ] Remove local admin page component imports from `App.jsx`
- [ ] Remove `AdminRoute` component if unused after admin removal; verify `SupportRoute` still needed for `/support`
- [ ] Archive `frontend/src/pages/admin/` directory (rename to `_admin_deprecated/`); schedule deletion after 30-day safety period
- [ ] Update `FeedbackButton` and `FeedbackToast` unread-count poll endpoint if feedback inbox has moved to platform admin
- [ ] Remove `unreadCount` state and related socket listener from `AppLayout.jsx` if admin feedback is fully platform-side
- [ ] Verify no remaining references to `/admin` routes in `MENU_LINKS`, `BOTTOM_NAV`, or any page-level `<Link>` components

#### Acceptance criteria

- [ ] Navigating to `xo.aiarena.callidity.com/admin` redirects to platform admin
- [ ] No 404s or broken links anywhere on xo.aiarena related to admin
- [ ] Admin users can perform all previous admin tasks via the platform admin
- [ ] `frontend/src/pages/admin/` is archived and not imported anywhere

#### Tests

| Type | What | Tool |
|------|------|------|
| E2E | Navigate to `/admin` on xo.aiarena → redirects to platform admin URL | Playwright |
| Smoke | All xo.aiarena nav links return 200; no broken internal links | Playwright smoke suite |

---

### Overall Testing Strategy

#### Test levels

| Level | Scope | Tool | When |
|-------|-------|------|------|
| Unit | Store actions, hooks, utility functions | Vitest | Every PR |
| Integration | API endpoints, socket events, database mutations | Vitest (backend) | Every PR |
| Component | React components in isolation with mocked stores | Vitest + React Testing Library | Every PR |
| E2E | Full user journeys across pages and features | Playwright | Every PR; full suite on staging deploy |
| Visual | Key surfaces against HTML mockups in `doc/mockups/` | Manual per milestone | Milestone reviews |
| A11y | WCAG AA compliance on all new components | axe-core + manual | Milestone reviews |
| Performance | Core Web Vitals on Play, Tournaments, and Profile pages | Lighthouse CI | Milestone reviews |
| Mobile | All new UI at 375px (iPhone SE), 390px (iPhone 15), 768px (iPad) | Manual + Playwright | Every major component |
| Cross-browser | Chrome, Firefox, Safari on latest two versions | Playwright | Pre-staging |

#### Existing test suite

The backend uses Vitest with the `forks` pool. New tests for Guide preferences API and journey step detection go in `backend/src/__tests__/` following the existing pattern.

E2E tests live in `e2e/` (Playwright). The existing smoke suite covers `/api/version`, sign-in, and the play page. New journey tests extend this suite.

#### Definition of Done (per phase)

A phase is complete when:
- [ ] All tasks in the phase checklist are marked done
- [ ] All acceptance criteria pass
- [ ] All automated tests pass in CI (green on `dev` branch)
- [ ] A visual review against the relevant `doc/mockups/` file has been signed off by a second person
- [ ] The feature has been tested on mobile (375px) and desktop (1280px) in both light and dark mode
- [ ] No new console errors or warnings introduced
- [ ] No accessibility regressions (axe-core clean on changed components)
- [ ] PR merged to `dev`, staged to `staging`, smoke tests pass, promoted to `main`

---

### Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Guide real-time events conflict with existing Socket.IO listeners | Medium | Medium | Namespace Guide events under `guide:` prefix; audit existing listeners before adding new ones |
| Journey step detection server-side is delayed (socket delivery lag) | Low | Low | Client can optimistically mark step complete on action; server confirms asynchronously |
| Cross-site deep-links break if auth session not shared across subdomains | Medium | High | Verify Better Auth session cookie scope covers `*.callidity.com`; test sign-in state across site boundaries early in Phase 5 |
| Component library migration introduces visual regressions on pages not reviewed | Medium | Medium | Do one component type at a time (buttons first, then badges, etc.); screenshot tests before/after each batch |
| Platform admin build takes longer than expected, blocking Phase 7 | High | Low | Phase 7 is last step and has no user-facing urgency; xo.aiarena admin routes remain functional in the interim |
| Confetti / animation performance on low-end devices | Low | Low | Use `prefers-reduced-motion` media query to disable animations; confetti is already gated behind journey completion |
| `User.preferences` JSONB grows unbounded over time | Low | Low | Cap slot array at 8 entries server-side; prune delivered notification history after 30 days |

---

### Pre-Build Checklist

Before starting Phase 3, confirm:

- [ ] Phase 1 and 2 merged and live on staging ✅
- [ ] `User.preferences` JSONB column exists or migration is ready to run
- [ ] Socket.IO `guide:` event namespace agreed with backend team
- [ ] `colosseum-bg.jpg` sourced and added to aiarena platform app `/public/` (not xo.aiarena)
- [ ] Design mockups in `doc/mockups/` reviewed and approved as implementation targets:
  - [ ] `lobby.html` — tournament list, view toggle, Guide slots
  - [ ] `tournament-detail.html` — standings, match banner, registration sidebar
  - [ ] `player-profile.html` — tier, merit, history
  - [ ] `xo-game.html` — Guide panel states (mid-game context, notifications, slots, online strip)
  - [ ] `onboarding-journey.html` — Journey card all states (1/7, 3/7, 6/7 spotlight, complete)
  - [ ] `admin.html` — platform admin sidebar and all panel views
- [ ] Playwright E2E suite passes on staging before any Phase 3 work begins
- [ ] Team alignment: frontend and backend engineers briefed on Guide architecture and event naming

