# AI Arena — Tournament Requirements

## Overview

Tournaments are a platform-level feature shared across all games (XO Arena, Connect4 Arena, etc.). They support human players competing against each other, AI models competing against each other, and mixed fields of humans and bots. All tournament-related UI is accessed from the main landing page (aiarena.callidity.com). Tournament management requires the `tournament` role or `admin`.

---

## Guiding Principles

- Tournaments are game-agnostic — the tournament engine operates the same way regardless of which game is being played.
- All game play and results within a tournament must be recorded for replay, analysis, and audit purposes.
- Bot vs Bot matches run server-side. Only community bots (user-trained) may enter tournaments — built-in bots (Rusty, Copper, Sterling, Magnus) are not permitted.
- All threshold values governing classification, merits, and demotion are database-driven and admin-configurable. The values documented here are defaults only.
- Tournament outcomes have no effect on a player's general ELO rating — ELO is updated only through free play and community bot matches outside of tournaments.

---

## Tournament Modes

Organizers select one mode at creation time. The mode determines who may enter.

| Mode | Who may enter |
|------|--------------|
| `PVP` | Human players only |
| `BOT_VS_BOT` | Community bots only |
| `MIXED` | Both humans and bots in the same bracket |

---

## Tournament Types by Format

### 1. Open Tournament
- Always-on or time-bounded; any eligible logged-in user (human or bot) may join at any time up to the start.
- No registration window — participants enter the lobby and are placed in the bracket as they arrive.
- Registration closes when the tournament starts; no late entry is permitted once play begins.
- Tournaments start at the scheduled time. The organizer may override this and start early, provided the minimum participant count has been met.
- Suitable for low-commitment, casual competitive play.

### 2. Planned Tournament
- Defined start time and end time set in advance by the organizer.
- Participants explicitly register during a registration window that opens and closes before the start time.
- Bracket is seeded from the registered participant list at registration close.
- Notifications sent to registered participants before start (e.g., 1 hour and 15 minutes prior).
- Late entry not permitted once the tournament has started.
- May be configured as a **recurring** tournament — see Recurring Tournaments below.

### 3. Flash Tournament
- Spontaneous; organizer fires it with two parameters: **notice period N** (minutes until start) and **duration M** (minutes the tournament runs).
- All logged-in users receive a real-time notification: *"A flash tournament starts in N minutes."*
- Users have the notice period to opt in.
- Tournament auto-starts at T+N and auto-closes at T+N+M regardless of match completion state.
- Incomplete matches at close time are resolved by current series score. If the series score is level at close, the same draw resolution cascade applies: total tournament wins → ELO → random selection. This keeps forfeit handling consistent with the drawn match rules.

### Recurring Tournaments
A Planned tournament may be configured to recur on a schedule. Each recurrence runs as a fresh competition with its own bracket, participants, and results. Player classification and merits carry over between occurrences; match history does not. Qualification checks (ELO, tier, activity) are re-evaluated fresh at the start of each occurrence.

**Registration mode** — when registering for a recurring tournament, a participant chooses:

| Mode | Behavior |
|------|----------|
| `SINGLE` | Registered for the current occurrence only |
| `RECURRING` | Automatically enrolled in every future occurrence until opted out |

A `RECURRING` participant may opt out at any time. The organizer may also configure auto-opt-out rules based on inactivity (e.g., missed N consecutive occurrences), after which the participant's registration reverts to `SINGLE` or is removed entirely.

| Field | Description |
|-------|-------------|
| `isRecurring` | Whether this tournament repeats |
| `recurrenceInterval` | `DAILY \| WEEKLY \| MONTHLY \| CUSTOM` |
| `recurrenceEndDate` | Optional date after which no new occurrences are created |
| `autoOptOutAfterMissed` | Number of consecutive missed occurrences before auto-opt-out (configurable) |

---

## Tournament Structure / Bracket Formats

| Format | Best for |
|--------|----------|
| Single elimination | Fast, large fields |
| Round robin | Small fields (≤ 8), most accurate ranking |

Organizer selects format at creation time.

---

## Minimum Participants

All tournament formats require a minimum number of participants before play can begin. The default is 2 and is organizer-configurable. If the minimum is not met at the scheduled start time, the tournament is automatically cancelled and all registered participants are notified.

---

## Match Rules

### Series Length
Each match is a best-of-N series. N must be an odd number (e.g., 3, 5, 7) and is set by the organizer at tournament creation. The first player to win the majority of games advances.

### Drawn Matches
If a best-of-N series ends level (equal wins on both sides), the match is recorded as a draw. There are no replays or tiebreaker games — this keeps bot match counts bounded.

- **Round robin:** a draw is recorded as a draw and scores accordingly (2 points for a win, 1 point for a draw, 0 points for a loss).
- **Single elimination:** a draw requires a winner to advance. Resolution proceeds in order until a winner is determined:
  1. Player with the most total wins across the tournament advances.
  2. If still equal, the player with the higher ELO rating advances.
  3. If still equal, one player is selected at random to be eliminated.
  All three steps are logged for auditability.

### Bot vs Bot Matches
- Bots compete head-to-head directly — no benchmark or built-in opponent is used.
- Matches run server-side; no client connection is required once the bot is entered.
- Match execution is spread across available server capacity to avoid overloading the server.
- Execution pace is configurable by the organizer.

### Human vs Bot Matches (Mixed mode)
- Execution approach (client-side or server-side) is determined by architecture at implementation time.
- All game play and results are recorded regardless of execution approach.

---

## Seeding

Bracket seeding is based on ELO rating at the time registration closes. Seeding ensures stronger players are not matched against each other in early rounds.

---

## Qualification

Organizers may restrict entry to participants who meet configurable thresholds for:
- ELO rating (minimum / maximum)
- Tournament classification tier (minimum tier required)
- Activity (minimum games played)

### Bot Eligibility
For tournaments that allow bots (`BOT_VS_BOT` or `MIXED`), a bot must meet all of the following before it can be entered:
1. **Active and available** — the bot is marked active and available on its record.
2. **Non-provisional** — the bot has exited its provisional ELO period.
3. **Minimum games played** — the bot has played at least N games. N is organizer-configurable, database-driven, and exposed through the admin interface.

---

## Roles and Permissions

| Action | Guest | User | Tournament Role | Admin |
|--------|-------|------|-----------------|-------|
| View tournaments | ✓ | ✓ | ✓ | ✓ |
| Register / enter a tournament | — | ✓ | ✓ | ✓ |
| Watch matches (spectator) | ✓ | ✓ | ✓ | ✓ |
| Create / edit tournaments | — | — | ✓ | ✓ |
| Fire a flash tournament | — | — | ✓ | ✓ |
| Cancel a tournament | — | — | ✓ | ✓ |
| Grant tournament role to users | — | — | — | ✓ |

---

## Tournament Lifecycle States

```
DRAFT → REGISTRATION_OPEN → REGISTRATION_CLOSED → IN_PROGRESS → COMPLETED
                                                             ↘ CANCELLED
```

| State | Description |
|-------|-------------|
| `DRAFT` | Created but not yet published; only visible to organizer |
| `REGISTRATION_OPEN` | Published; participants may register |
| `REGISTRATION_CLOSED` | Registration window has ended; bracket is being seeded |
| `IN_PROGRESS` | Matches are running |
| `COMPLETED` | All matches finished; final standings recorded |
| `CANCELLED` | Cancelled by organizer or admin; no classification or merit impact |

**Open tournaments** skip `REGISTRATION_CLOSED` — they go directly from `REGISTRATION_OPEN` to `IN_PROGRESS` at the scheduled start time (or early if the organizer overrides). Registration closes implicitly when the tournament starts.

**Flash tournaments** skip `DRAFT` and `REGISTRATION_CLOSED` — they go directly from creation to `REGISTRATION_OPEN`, then `IN_PROGRESS` at T+N. Registration closes implicitly when the tournament starts.

---

## Tournament Configuration Fields

| Field | Type | Applies to | Description |
|-------|------|-----------|-------------|
| `name` | string | All | Display name |
| `description` | string? | All | Optional organizer notes |
| `game` | string | All | e.g., `xo`, `connect4` |
| `mode` | enum | All | `PVP \| BOT_VS_BOT \| MIXED` |
| `format` | enum | All | `OPEN \| PLANNED \| FLASH` |
| `bracketType` | enum | All | `SINGLE_ELIM \| ROUND_ROBIN` |
| `minParticipants` | int | All | Minimum players required before tournament can start; default 2. If not met at start time, the tournament is automatically cancelled. |
| `maxParticipants` | int? | All | Cap on entries; null = unlimited |
| `bestOfN` | int | All | Games per match (odd number: 3, 5, 7…) |
| `botMinGamesPlayed` | int | BOT_VS_BOT, MIXED | Minimum games a bot must have played to be eligible; database-driven |
| `allowSpectators` | bool | All | Whether matches are publicly watchable |
| `replayRetentionDays` | int | All | How long replays are available after tournament ends |
| `startTime` | datetime | Open, Planned | When tournament begins |
| `endTime` | datetime | Planned, Flash | When tournament auto-closes |
| `registrationOpenAt` | datetime | Planned | When registration opens |
| `registrationCloseAt` | datetime | Planned | When registration closes |
| `noticePeriodMinutes` | int | Flash | Minutes of notice before start |
| `durationMinutes` | int | Flash | How long the tournament runs |
| `isRecurring` | bool | Planned | Whether this tournament repeats |
| `recurrenceInterval` | enum? | Planned | `DAILY \| WEEKLY \| MONTHLY \| CUSTOM` |
| `recurrenceEndDate` | datetime? | Planned | When the recurring series ends |
| `autoOptOutAfterMissed` | int? | Planned (recurring) | Consecutive missed occurrences before auto-opt-out; null = never |
| `createdBy` | userId | All | Organizer |

---

## Notifications

| Event | Who is notified | Channel |
|-------|----------------|---------|
| Flash tournament announced | All logged-in users | Real-time (Socket.io broadcast) + in-app banner |
| Flash tournament starting in 2 min | Opted-in users | Real-time |
| Planned tournament registration opens | All users (opted in to tournament alerts) | In-app notification |
| Planned tournament starts in 1 hour | Registered participants | In-app notification |
| Planned tournament starts in 15 min | Registered participants | Real-time |
| Your match is ready | Participant | Real-time |
| Your match result | Participant | Real-time + persistent notification + optional email; delivery timing governed by user preference (see below) |
| Tournament completed | All participants | In-app notification |

### Match Result Delivery Preference

Bot owners may choose when to receive match result notifications:

| Preference | Behavior |
|------------|----------|
| `AS_PLAYED` | Notified after each match result as it occurs |
| `END_OF_TOURNAMENT` | Notified once at the end of the tournament with all results |

This preference is set globally in the user's account settings and may be overridden at registration time for any specific tournament. Notifications include a link to the match replay.

---

## Replays and Game Records

- All matches are recorded and available for replay.
- Replays are accessible to any user, including guests, for a configurable retention period after the tournament ends (`replayRetentionDays`).
- After the retention period, replays are archived or removed.

---

## Player Classification

Tournament classification is independent of the credits tier system. It tracks a player's competitive standing within tournament play specifically.

Bots are first-class players. A bot's ELO rating and tournament classification are earned independently through its own play and have no relationship to its owner's ELO or classification. Owning a highly-ranked bot does not affect the owner's standing, and vice versa.

### Tiers

| Tier | Description |
|------|-------------|
| Recruit | Default starting classification for all new players |
| Contender | Early competitive standing |
| Veteran | Established tournament participant |
| Elite | Advanced competitive standing |
| Champion | Near-top competitive standing |
| Legend | Highest classification; terminus |

### Merits

Merits are the currency of classification advancement. They are earned by finishing in a top position within your own classification tier at a tournament. Merits accumulate permanently and reset to zero upon promotion to the next tier.

**Merits awarded per tournament finish (defaults — all values are database-configurable):**

| Players in your tier at this tournament | 1st | 2nd | 3rd | 4th |
|-----------------------------------------|-----|-----|-----|-----|
| 3–9 | 1 | — | — | — |
| 10–19 | 2 | 1 | — | — |
| 20–49 | 4 | 2 | 1 | — |
| 50+ | 4 | 4 | 2 | 1 |

**Best Overall bonus:** The single top finisher across all tiers in a tournament (minimum 10 total participants) earns at least 1 merit regardless of tier.

Merits are earned based on finish position within your own tier only. Ties at the same position share the same merit award.

### Promotion

A player is promoted to the next tier when their accumulated merits reach the threshold for their current tier.

| Current Tier | Merits required to promote (default) |
|--------------|--------------------------------------|
| Recruit | 4 |
| Contender | 6 |
| Veteran | 10 |
| Elite | 18 |
| Champion | 25 |
| Legend | — |

All thresholds are database-driven and admin-configurable.

### Demotion

Players may be demoted one tier following a periodic review. The review cadence and eligibility thresholds are set by the tournament manager. A player is eligible for demotion if they meet all of the following during the review period:

1. Did not promote during the review period.
2. Played at least the minimum number of qualifying tournament matches (configurable).
3. Finish Ratio exceeds the demotion threshold (configurable; default 0.70).

**Finish Ratio (FR)** = average finish percentile across all qualifying matches in the review period, where finishing last = 1.0 and finishing first = 0.0. A player with FR above the demotion threshold is consistently finishing in the bottom of their tier pool.

All demotion parameters are database-driven and admin-configurable. Default values:

| Parameter | Default |
|-----------|---------|
| Finish Ratio demotion threshold | 0.70 |
| Minimum qualifying matches for review eligibility | Configurable |
| Review cadence | Configurable |

Players may opt out of demotion once per review period. Demotion drops the player one tier; their merit count resets to zero for the new tier.

---

## User Interface

### Platform Architecture

All tournament UI — player-facing and admin — lives at **aiarena.callidity.com**, the platform-level site. Individual game applications (e.g., xo.aiarena.callidity.com) handle free play and game-specific features only; they do not host tournament pages.

**Authentication is seamless across all sites.** A single BetterAuth token covers the entire platform. Logging into any site authenticates the user everywhere — no second sign-in is required when moving between aiarena and a game app.

**The XO game component is extracted to a shared package** (`packages/xo`) importable by both the aiarena app and the xo.aiarena app. When a tournament match requires game play, the board renders inline at aiarena — the player never leaves. PVP tournament matches use the existing xo.aiarena backend room infrastructure; the tournament service creates the room and hands the slug to both players.

**Tournament admin** (create/manage tournaments, classification configuration, merit thresholds, demotion settings) lives at aiarena, not in the xo.aiarena admin panel.

---

### Tournament Lobby

The lobby is the primary entry point for all tournament activity, accessible to all users including guests.

**Layout**
- A filterable list of tournaments organized into tabs or sections: **Upcoming**, **In Progress**, **Completed**.
- Each tournament card shows: name, game, mode, format, bracket type, status, participant count (current / max), start time, and a tier requirement badge if applicable.
- Filters: game, mode (PVP / BOT_VS_BOT / MIXED), format (Open / Planned / Flash), status.
- Flash tournaments appear at the top of the lobby with a countdown timer and a prominent "Join now" call to action.

**Access**
- Guests may browse the lobby and view tournament details but cannot register.
- Logged-in users may register, withdraw, and view their registration status inline on each card.

---

### Tournament Detail Page

Each tournament has a dedicated detail page reachable from the lobby.

**Header**
- Tournament name, game, mode, format, bracket type, status badge, and organizer name.
- Start time (with countdown if upcoming), end time if applicable.
- Registration status for the current user: not registered / registered (with their notification preference shown) / ineligible (with reason).

**Registration Panel**
- Register / Withdraw button for eligible logged-in users.
- At registration time, the user selects their **match result notification preference**: *After each match* (`AS_PLAYED`) or *Summary at end* (`END_OF_TOURNAMENT`).
- For recurring tournaments, the user selects their **registration mode**: *This occurrence only* (`SINGLE`) or *All future occurrences* (`RECURRING`).
- Registered participants list (avatar, display name, tier badge, ELO). Collapsed by default for large fields.

**Bracket / Standings View**
- *Single elimination:* visual bracket tree. Completed matches show scores. The current user's path is highlighted.
- *Round robin:* standings table (rank, player, wins, draws, losses, points). Completed matches shown in a collapsible match results section.
- Bracket is visible to all users (guests included) once the tournament is IN_PROGRESS or COMPLETED.

**Match Panel (active participant)**
- When a match is ready for the current user, a prominent banner appears: *"Your match is ready — Round N."*
- PVP and MIXED human-vs-bot matches: the game board renders inline on the page — the player never leaves aiarena. The game component is sourced from `packages/xo`.
- The panel clears once the match result has been recorded.

---

### Player Classification Profile

Each authenticated user has a classification profile page at aiarena.

**Content**
- Current tier (displayed as a color-coded badge: Recruit → Legend).
- Merit progress bar: current merits / merits required for next promotion.
- Tier history: a timeline of promotions and demotions with dates and reasons.
- Recent tournament results: last N tournaments entered, finish position, merits earned.

Visible to the authenticated user. Admin users may view any player's classification via the tournament admin panel.

---

### Flash Tournament Banner

When a flash tournament is announced, all logged-in users receive a real-time, dismissible banner at the top of the page regardless of which page they are on:

> **Flash Tournament — [Name]** — Starting in N minutes. [Join now →]

The banner includes a countdown. Tapping/clicking navigates to the tournament detail page. The banner auto-dismisses when the tournament starts or when the user dismisses it manually. The banner must appear on both aiarena and xo.aiarena pages, since users may be active on either site when a flash tournament fires.

---

### Notification Preferences (Settings Page)

The aiarena Settings page includes a **Tournament Notifications** section:

- **Match result delivery** — global default: *After each match* / *Summary at end*. This default applies to any tournament registration where the user does not override it at enrollment.
- **Flash tournament alerts** — toggle: receive the real-time flash announcement banner.
- **Planned tournament reminders** — toggle: receive 1-hour and 15-minute reminders for registered tournaments.

---

### Navigation

- The aiarena main navigation includes: Tournaments, My Profile, Settings, and a sign-in/account control.
- An unread badge on the navigation indicates pending tournament notifications (match ready, results available, etc.).
- A notification bell surfaces tournament notifications inline.
- A **Play** link or game launcher navigates users to the appropriate game app (xo.aiarena, etc.) for free play outside of tournaments.

---

### Shared Packages

The following packages are extracted from the xo.aiarena frontend and made available across both sites:

| Package | Contents |
|---------|----------|
| `packages/xo` | XO game board component, game logic, PvP socket integration |
| `packages/auth` | BetterAuth client config, `getToken()`, `useSession()` hook |
| `packages/ui` | Shared design foundation: Tailwind preset, spacing/type scale, base component primitives |

Each site applies its own theme on top of the shared foundation. aiarena has a distinct visual identity from xo.aiarena.

---

### Responsive Design

All tournament UI must be fully functional on mobile (phones and tablets) as well as desktop. Key constraints:
- Bracket trees on mobile: horizontally scrollable or collapsed to a list view.
- Round robin standings table: horizontally scrollable on narrow viewports.
- The inline game board must be playable on touch screens.
- Flash tournament banners must be visible and dismissible on all viewport sizes.

---

## Addendum — Deferred Features

The following items have been considered but are explicitly out of scope for the initial implementation. They are noted here for future reference.

### Additional Bracket Formats

**Double elimination** and **Swiss** formats were evaluated and deferred. Both are valid for tournament play but add meaningful complexity to bracket management and tiebreaker logic.

- **Double elimination** — players are eliminated only after two losses; requires a losers' bracket running in parallel with the winners' bracket.
- **Swiss** — players are never eliminated; matched against opponents with similar win records each round; final standings determined by total points. Well-suited to large fields with many rounds.

These formats should be revisited when the tournament system is mature and organizer demand warrants the additional complexity.

---

### Items Deferred to Design / Plan Phase

The following items are acknowledged at the requirements level but require architectural decisions that belong in the subsequent design and planning document.

**Mixed-mode execution (Human vs Bot)**
In `MIXED` tournaments, when a human plays against a bot the match may run client-side (bot inference in the browser) or server-side (bot inference on the server). The decision affects client/server load, latency, and replay recording. To be resolved during design.

**Server-side bot match pacing**
Bot vs Bot matches run server-side and must be spread across available capacity to avoid overloading the server. The exact pacing and scheduling logic — including how concurrency limits are enforced and how pace is exposed as an organizer-configurable parameter — is to be determined during design.

**Best Overall merit bonus — multi-tier calculation**
Resolved during design: the bonus is awarded to the player with `finalPosition = 1` in the tournament's overall final standings — the same finishing order the bracket already produces. No special cross-tier comparison is required. In round robin, ties for 1st place share the bonus. In single elimination there is exactly one bracket winner.

**Database schema**
The tournament system introduces a significant number of configurable fields, classification thresholds, merit parameters, and demotion rules, all of which are database-driven. The full schema design — including tables for tournaments, participants, matches, brackets, merits, classification history, and recurring registration — is to be produced during the design phase.
