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

The Colosseum photo is platform-wide across all aiarena pages, including admin.

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
| Image | `mountain-bg.jpg` (a mountain landscape) | Colosseum photo (`colosseum-bg.jpg`) |
| Opacity (light) | 0.30 | 0.15–0.25 |
| Opacity (dark) | 0.30 (no dark override) | 0.08 |
| Position | `center center` | `center 30%` |

**Action**: swap image, add dark-mode opacity override, adjust position.

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

**Current:** Admin links inline in the xo.aiarena nav, separate admin pages at `/admin/*` routes within the xo.aiarena app.

**Spec:** Unified admin at `aiarena.callidity.com/admin`. xo.aiarena admin deprecated immediately; routes redirect.

**Action**: replace xo.aiarena admin routes with a redirect to the platform admin URL. The existing admin page code may be migrated to the aiarena app or rebuilt there directly.

---

### Prioritised Implementation Plan

Phases are ordered by dependency. Each phase can be a separate PR or sprint.

#### Phase 1 — Token alignment (low risk, high leverage)

*These are pure CSS changes. No component logic changes. Do this first so all subsequent work builds on correct tokens.*

1. Add `--color-slate-{50–900}` ramp to `index.css`
2. Add `--radius-sm / --radius-md / --radius-lg / --radius-pill` tokens to `index.css`
3. Swap background image from `mountain-bg.jpg` to `colosseum-bg.jpg`, set opacity 0.25 (light) / 0.08 (dark), position `center 30%`
4. Audit dark-mode shadow values; introduce tone elevation for cards in dark mode

**Effort:** Small (half-day). **Risk:** Very low.

---

#### Phase 2 — Navigation cleanup

*Remove admin links from xo.aiarena header; make room for Guide orb.*

1. Remove admin nav links from `AppLayout.jsx`; add a single "Admin" external link to `aiarena.callidity.com/admin` (visible to admin role only)
2. Remove the inline "✦ Guide" pill button — replaced by the Guide orb component (Phase 4)
3. Audit nav link set: confirm Play / Gym / Puzzles / Tournaments / Rankings is the right set for xo.aiarena

**Effort:** Small. **Risk:** Low.

---

#### Phase 3 — Guide component build (new)

*The biggest single piece of new UI work. Build the Guide as a self-contained component.*

Sub-tasks:
1. **GuideOrb** — orb button with progress ring SVG, urgent pulse, badge count
2. **GuidePanel** — slide-in panel with header, body sections, chat input
3. **SlotGrid** — 8 configurable slots (add/remove/reorder in edit mode), onboarding slots with dashed border and expiry
4. **SlotPicker** overlay — library of available actions organised by section (Platform / XO Arena / Onboarding)
5. **NotificationStack** — card types: flash, match_ready, admin, invite, room_invite; dismiss; badge decrement
6. **OnlineStrip** — 6 avatar slots, one-tap room invite
7. **GuideStore** — Zustand store for panel open state, slot config, notification queue, journey progress (mirrors server-side `User.preferences`)
8. Wire AccomplishmentPopup socket events into NotificationStack
9. Wire Flash tournament socket events into NotificationStack (urgent)
10. Server-side: add slot config + journey progress to `User.preferences` JSONB field; expose via GET/PATCH `/api/guide/preferences`

**Effort:** Large (1–2 sprints). **Risk:** Medium — real-time notification wiring requires backend coordination.

---

#### Phase 4 — Onboarding journey

*Build the Journey card inside the Guide panel. Requires Phase 3 complete.*

1. **JourneyCard** component — collapsed and expanded states, orb progress ring, CTA per step
2. **JourneyStore** — step completion state, server sync
3. **Contextual auto-open** — page-load hook checks current route against incomplete step triggers; calls `guideStore.open()` if matched (never mid-game)
4. **Spotlight** — `useSpotlight(stepIndex, targetRef)` hook; renders amber pulse ring + label
5. **Completion celebration** — confetti, badge award, +50 TC deposit
6. **Dismiss flow** — one-tap confirmation; server-side `dismissed: true` in journey state
7. Retire `GettingStartedModal.jsx`, `WelcomeModal.jsx`, update `onboardingStore.js`
8. Backend: journey step completion events (step detected server-side or reported from client); TC deposit on step 7

**Effort:** Large (1 sprint). **Risk:** Medium — journey step 2, 4, 5, 6 require cross-site deep-links.

---

#### Phase 5 — Cross-site slot actions

*Wire the Guide slot actions that jump to other aiarena sites.*

1. Define the cross-site URL scheme: `aiarena.callidity.com/redirect?target=gym&action=start-training&userId=…`
2. Implement "Play XO vs community bot" slot action (opens xo.aiarena game with bot pre-selected)
3. Implement "Open Gym" cross-site slot (opens gym page with training flow ready)
4. Implement "Enter tournament" cross-site slot (opens tournament lobby with registration modal pre-opened)

**Effort:** Medium. **Risk:** Medium — requires coordination with the aiarena app shell.

---

#### Phase 6 — Component library alignment (ongoing)

*Progressively migrate inline-styled components to shared token usage. Not a big-bang rewrite.*

1. Buttons: define three variants (primary, secondary, danger) as CSS classes in `index.css` or as a `Button` component; replace inline gradient buttons site-wide
2. Badges: define badge CSS classes; replace inline badge styling
3. Cards: define card CSS class with correct radius, shadow, and border; audit pages
4. Modals: build a `<Modal>` component with correct backdrop, animation, close behaviour; migrate existing modals
5. Once `packages/ui` exists: migrate base primitives there

**Effort:** Medium (can be broken into small PRs per component type). **Risk:** Low.

---

### Summary table

| Phase | What | Effort | Risk | Dependency |
|-------|------|--------|------|-----------|
| 1 | Token alignment (palette, radius, background) | Small | Very low | None |
| 2 | Nav cleanup (strip admin, remove Guide pill) | Small | Low | None |
| 3 | Guide component build | Large | Medium | Phase 1, 2 |
| 4 | Onboarding journey | Large | Medium | Phase 3 |
| 5 | Cross-site slot actions | Medium | Medium | Phase 3, 4 |
| 6 | Component library alignment | Medium | Low | Phase 1 (ongoing) |

Phases 1 and 2 can land in the same PR. Phase 3 is the core new build and should be its own branch. Phases 4 and 5 follow naturally. Phase 6 is evergreen work that runs alongside everything else.
