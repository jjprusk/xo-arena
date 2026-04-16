<!-- Copyright © 2026 Joe Pruskowski. All rights reserved. -->
# AI Arena — Table & Seat Paradigm

**Status**: Working draft. Sections marked `[OPEN]` are questions we haven't answered yet. Sections marked `[DECIDED]` are locked.

**Purpose**: Define the visual/UX paradigm for "Tables" and "Seats" so the experience is coherent from browsing a table → forming → playing → finishing. All games on the platform should inherit the same paradigm so a player learns it once.

---

## 1. Vision statement

`[DECIDED]`

> **When a player joins a table at AI Arena, they sit down in a place — a specific seat at a specific table — and stay there through forming, playing, and finishing. The place persists; only its state changes. Every game, whether a turn-based board game or a head-to-head action match, shares this single spatial paradigm: you are somewhere, across from someone, watching the board between you.**

Corollaries that fall out of this:

- The word "table" means a rendered, visually coherent surface — not a database row or a list entry
- The word "seat" means a specific position the player occupies, not just a slot in an array
- The game appears *on* the table, not in an unrelated part of the page
- Two players at the same table see each other across that surface — the paradigm is spatially consistent from both viewpoints
- Spectators are visible participants in the scene (badge + avatars), not an invisible integer
- A tournament match and a pickup match share the exact same visual paradigm — the difference is sidebar context, nothing more

---

## 2. Design principles

Starting principles — we'll edit as we go:

- **Name = visual.** If we call it a "table," it should look like a table. If we call a thing a "seat," the player should feel they are sitting somewhere.
- **Continuity of place.** The seat you join in forming is the same seat you play from. No jarring reflow when the game starts.
- **One paradigm, many games.** The visual language scales from 2p XO to 8p poker without bespoke chrome per game.
- **Tournaments aren't special.** A tournament match is a table like any other — no different visual treatment just because a bracket generated it.
- **Honest affordance.** Clickable things look clickable; static decor doesn't lie.

---

## 3. The foundational questions

These shape everything below. We'll answer them in order.

### 3.1 How literal should "table" be? `[DECIDED]` → **Medium**

Three positions on a spectrum:

| Level | What the player sees |
|---|---|
| **Light** | No rendered "table" shape. Same list/form UI we have today, but with softer seat labels ("You", opponent avatars) |
| **Medium** ✓ | A rendered table / play-surface *shape* with seats visibly arranged **around** it. Game board (or play field) sits on the surface during play. Same visual in forming + playing. |
| **Heavy** | Full immersive scene (Colosseum framing, wood/felt surface, avatar expressions, chat bubbles rising from seats). |

**Decision**: Medium. Heavy was evaluated and rejected because the cost compounds per-game (every new game needs bespoke visual authorship to match the aesthetic, plus a "minimal" fallback for mobile/accessibility that would approximate Medium anyway — we'd pay for both). Light keeps the name-without-metaphor mismatch we're trying to solve. Medium gives us the paradigm without locking us into per-game art direction.

**Key refinement**: seats are positioned **around** the table (on its perimeter, looking inward), not on the table surface itself. The surface is for the game. Seats are where players *sit*.

### 3.1a Table archetypes `[DECIDED]`

Not every game is a "sit-down" game. Two archetypes cover the roadmap:

| Archetype | Games | Layout |
|---|---|---|
| **Sit-down table** | XO, Connect4, Poker, future card / board games | Round or rectangular surface with seats around the perimeter, all facing inward toward the shared board. Works for 2p (opposite sides), 4p (each edge), 8p (around the circle). |
| **Head-to-head court** | Pong, future 2-player action games (Air Hockey, etc.) | Long rectangular play field with players at opposite ends, not perimeter-seated. The metaphor is a ping-pong table or a tennis court — players face each other across the field rather than all facing an inward center. |

**Implication**: the game's `meta` needs a declarative field so the platform shell knows which archetype to render.

```
// packages/<game>/src/meta.js
meta: {
  ...,
  tableArchetype: 'sit-down' | 'head-to-head',
}
```

Defaults to `'sit-down'` if omitted.

Future archetypes are possible (co-op arena for racing, split-screen for puzzle-race, etc.) but out of scope for now — add them when the first game in that category lands.

### 3.2 Is the game board **inside** the table or does the table **frame** it? `[DECIDED]` → **Inside**

- **Inside** ✓: the table surface contains the game. Seats look inward toward it. The board is the centerpiece. For head-to-head courts, the play field *is* the court between the two ends.
- **Frame**: the game renders as-is; the table is furniture around it (chrome, chat, scoreboard).

**Decision**: Inside. Frame would keep the name-without-metaphor problem — just pushed one layer out. Inside commits to the board being visually part of the table, which is what the paradigm promises.

**Engineering consequence** (captures for §6 phasing):

- The platform shell owns the sizing/position of the game render. The game component renders into a rect the shell provides, not at its own preferred width.
- `meta.layout.preferredWidth` becomes advisory (an aspect-ratio hint) rather than a hard constraint. The shell consults it when choosing the table/court dimensions but ultimately controls the render rect.
- Games already receive a React component slot in PlatformShell — this change adds "given a surface of dimensions W × H, render the game to fit." Most games that use CSS-relative sizing will just work; grid-based games (XO, Connect4) need to compute cell size from the provided rect.
- Head-to-head courts: the game's play field fills the court length. Paddle/player indicators attach to each end (the "seat" positions), not around the perimeter.

### 3.3 Should the tournament experience be visually identical to a pickup game? `[DECIDED]` → **Yes, with sidebar context**

- **Yes** ✓: the table surface + seats + board are identical. What makes it a tournament match is not visible chrome — it's the behavior (when this game ends, the bracket advances).
- **No**: tournament tables get dedicated chrome (round header, match score, bracket preview, etc.).

**Decision**: Yes for the table itself. Tournament context (round, opponent, bracket meaning) is information the player benefits from, but it belongs in the **sidebar** (PlatformShell already has one) — not baked into the table surface.

**Why**: keeps tournament tables from becoming a second code path. One table shell, same across pickup and bracket contexts, with the sidebar populated differently based on `isTournament`.

**Concretely**:
- Table surface + seats + board: identical
- Chrome-present sidebar: adds a "Tournament: Spring Cup · Round 2 · Best of 3 (1-0)" block when `isTournament=true`, collapses to the normal seated-players list otherwise
- Focused mode: no tournament chrome visible. You're playing.

---

## 4. Derived decisions — depend on §3

> These only make sense once §3 is decided.

### 4.1 Seat layout geometry `[DECIDED]`

**Sit-down archetype** — shell picks shape based on `maxPlayers`:

| Players | Surface shape | Seat positions |
|---|---|---|
| 2 | Rectangle | Seats on the short edges (you at bottom center, opponent at top center) |
| 3 | Triangle / round | 120° equidistant |
| 4 | Round or rectangle (4-sided) | One seat per edge / 90° equidistant |
| 6 | Hexagon | One seat per edge / 60° equidistant |
| 8 | Octagon or round (oval) | One seat per edge / 45° equidistant |

- Shell-picked; games don't override. If a future game genuinely needs a different shape, that's a conversation and a new opt-in field — not something we design for today.

**Head-to-head archetype** — long rectangular court, responsive by viewport:

- **Wide viewport** (desktop, landscape phone): horizontal court. P1 left / P2 right. Classic Pong layout.
- **Tall viewport** (portrait phone): vertical court. P1 bottom / P2 top. Natural for thumbs on left/right edges, paddles on top/bottom.
- Shell flips orientation based on viewport. Game supports both via a coordinate-axis swap.
- Seat info (name, avatar, score) sits *outside* the play field at each player's end.

**Contract for head-to-head games**:

```js
meta: {
  tableArchetype: 'head-to-head',
  orientations:   ['horizontal', 'vertical'],  // both ideal; may be just one
}
```

- Both supported (recommended): shell picks per viewport
- Only one supported: shell uses it and either scales or prompts "rotate device" based on severity
- For 2D physics games like Pong, supporting both is a trivial coordinate-axis choice.

### 4.2 Player point-of-view rotation `[DECIDED]` → **Relative**

- **Absolute**: seat index → stable screen position for everyone
- **Relative** ✓: rotate the rendered table so your seat is at the bottom-center; other seats arrange around the rim accordingly

**Decision**: Relative. Worth the implementation cost because "I am here, they are across from me" is the entire payoff of a rendered table paradigm. For 2p it's trivial (you bottom, opponent top). For 3p+ it sells the metaphor — especially on mobile where players can't mentally rotate to find themselves.

**Head-to-head courts**: the "you at the closer end" convention — P1 at the bottom (portrait) or left (landscape) from the viewer's POV. One convention for the platform.

**Guardrails**:

- **Data layer stays absolute**. `Table.seats[i]` is a stable index. Only the *render* is rotated per-viewer.
- **Spectators get a canonical POV** — always "seat index 0 at the bottom-center" for sit-down; "seat index 0 at the near side" for head-to-head. Spectators are watching, not playing; they don't need a personalized view. (We may revisit this if tournament-casting develops a natural "featured POV" concept.)
- **Game-logic positions (dealer button, blinds, etc.) stay tied to seat index**. Their screen position varies per viewer, but their identity doesn't. Minor per-viewer bookkeeping.
- **Reactions/chat reference seat index or player name, not screen direction.** "The player on my left" is ambiguous across viewers; "seat 3" or "@alice" is not.

### 4.3 Spectator rendering `[DECIDED]` → **Low-density badge at table edge, click to expand into avatar popover**

**Default state (everyone, including on mobile)**:
- A small watcher cluster-badge sits at the edge of the table (off the play surface, not competing with seats or the game).
- The badge shows the count ("N watching") and optionally 1–2 tiny avatars to signal it's people.
- No visual noise when count is 0 — the badge is hidden.

**Expanded state (user clicks / hovers the badge)**:
- A popover opens with tiles showing watcher avatars + display names.
- If watchers > ~8, the popover scrolls.
- Closes on outside-click or Escape.

**Sidebar fallback**:
- In chrome-present mode, the sidebar also lists watchers by name (the existing PlatformShell already has the infrastructure to do this). The badge is the primary surface; the sidebar is a secondary view for users who have it open anyway.

**Head-to-head courts**: same pattern — watcher cluster-badge on the court's side (off the play field), expanding to a popover.

**Rationale**:
- Low visual density by default — good for mobile and focused play
- Power users who care about *who* is watching can click to see
- Scales to crowds: popover can scroll where a rendered crowd would overwhelm the scene
- Keeps "table is where the game happens, sidebar/popover is metadata" separation
- No bespoke art required (no balcony, no ghost layer)

**Privacy note**: `table:presence` already broadcasts authenticated watcher userIds to the seated-players cohort. This UI decision doesn't change what the server shares; it only changes whether clients render it as a count or as avatars. If "anonymous watching" ever becomes a feature, it's a server-side change (scrub userIds from the presence payload), not a UI redesign.

### 4.4 Forming → Playing transition `[DECIDED]` → **Short "game starting" moment; seats persist throughout**

- **A. Zero-animation swap**: center updates instantly when status flips. Simplest, feels abrupt.
- **B. Short starting moment** ✓: seats stay in place, the table's center briefly transitions (~600–900ms pulse / fade / glow), then the board materializes. Sells the place-persists metaphor with a small beat of drama.
- **C. Sit-down animation on join** (follow-up): avatar slides into a seat on join. Polish, not critical path.

**Decision**: B for the FORMING → ACTIVE transition; seats stay put and only the center of the table changes. The point of Inside + Medium is that the *place* doesn't change — only the state of the place does. A hard swap fights that intent.

**Follow-up**: C (slide-into-seat) can ship separately as polish.

**Accessibility**: respect `prefers-reduced-motion` — fall back to A (instant swap) when the user opts out.

**Symmetric note**: the reverse transition (ACTIVE → COMPLETED) also leaves seats in place. See §4.5.

### 4.5 End-of-game state `[DECIDED]`

**What stays in place**: seats (same positions, same avatars, same POV); board (final frame with win line highlighted / final placement visible).

**Result indication — seat-first, not banner-first**:
- Winner's seat gets a subtle gold glow / crown / emphasis
- Loser's seat goes muted
- Draw: neutral tone on all
- A small banner at the bottom edge of the table confirms the outcome ("You win!" / "Draw" / "Opponent wins") — but the seats are the primary signal
- Rationale: reinforces "the **place** persists, the **state of its people** changes." A big overlay banner (today's approach) ignores the seat metaphor entirely.

**Actions — in the sidebar, not on the table**:
- Rematch (both players click → seats stay, table flips back to FORMING/ACTIVE)
- Leave seat
- Share (already exists)
- Delete (creator-only, allowed on COMPLETED)
- No action buttons on the table surface. Table surface is for the game; sidebar is the home of actions.

**Persistence**: completed tables don't auto-delete. They remain until:
- Both players accept a rematch (table resets)
- Creator deletes it (DELETE endpoint already exists)
- Stale-tables health metric eventually flags it for admin attention

**Head-to-head courts**: identical pattern — final frame visible in the play field, player indicators at each end glow/dim per win-loss, sidebar hosts Rematch/Leave/Share.

### 4.6 Variants by player count `[DECIDED]` — design for 2p, head-to-head, and 8p poker together

Poker (8p, hidden information, rich per-seat state) drives the richest constraints. Designing for it now means every simpler configuration (2p sit-down, 2p head-to-head) is a specialisation of the same system.

#### 2-player sit-down (XO, Connect4, Chess, Checkers)

- **Shape**: rectangle, landscape orientation
- **Seats**: 2, on short edges (you bottom-center, opponent top-center)
- **Board**: centered on the table surface
- **Mobile**: same layout; tighter margins; board auto-sizes to remaining vertical space

#### 2-player head-to-head court (Pong + future action games)

- Covered in §4.1. Long rectangular play field; players at opposite ends; responsive orientation.

#### 3–7 player sit-down (no near-term games, but the shell supports them)

- **Shape**: round
- **Seats**: equidistant at 360°/N spacing around the rim
- **POV**: you at bottom-center; other seats fan around
- **Mobile**: avatars shrink to initials-only if required; name tooltips available on tap

#### 8-player sit-down (Poker, and the template for all multi-seat card/board games)

Poker makes explicit what other games can reuse. Listing what the shell must provide:

**Per-seat UI slot** (not just an avatar):
- Avatar + display name
- Seat-index badge (immutable; stays with the seat, not the player)
- Role/position badges (dealer button, blinds, etc.) — game-defined, shell renders whatever the game emits
- Per-seat state zone — a region near the seat where the game renders seat-specific content (cards, chip stack, current bet, hand rank, "folded" overlay)
- Active-turn indicator (glow / ring) — shell reads `currentTurn` from game state
- Disconnect / away state (muted / pulsing)

**Per-seat visibility control** (hidden-information support):
- The GameSDK already has `getPlayerState(playerId)` for this. The shell must render *your* seat with your player-state view and *other* seats with their masked views (face-down cards etc.).
- Seat occupants can change visibility over time (a folded player's cards may become visible at showdown). Shell doesn't need to reason about this — it just asks the game what to render for each seat at each moment.

**Shared center** (the "table surface" between seats):
- The game's shared state (community cards, pot, current-action marker). This is just `previewState` applied to the center region.

**Animations** (listed here so the shell is designed to accommodate them; authoring them is a later pass):
- Chip movements (seat → pot, pot → seat)
- Card deal (from center to seat)
- Showdown reveal (seat → face-up)
- Pot collection (pot → winner's seat)
- These are cross-seat motions, so the shell needs stable DOM node refs for seats and the center. Once exposed, any game can emit animations against this.

**Layout — oval, 8 seats**:
- Oval wider than tall (landscape). Seats spaced around the rim at roughly 45° intervals, with you at bottom-center.
- On mobile (portrait): the oval rotates 90° (tall, narrow) **or** the shell reduces visible information per seat (avatar + chip count only, tap seat for detail). Choose the cleaner option when Poker actually ships; design both as capabilities.

#### Implications for the shell and for GameSDK

- Seat positions are **computed by the shell** from `maxPlayers` + archetype. Games don't provide seat coordinates.
- The game gets a **per-seat render slot** as part of its rendering contract. A game that doesn't need per-seat content (e.g., XO) leaves those slots empty.
- The center-surface render rect is provided by the shell as today, just sized according to the archetype / seat count.
- `getPlayerState(playerId)` is promoted from nice-to-have to **required** for any hidden-information game. The shell calls it once per seat to populate the per-seat slots.
- A new `meta.tableArchetype` field is required (`'sit-down' | 'head-to-head'`), with `'sit-down'` as the default.
- A new optional `meta.orientations` field for head-to-head games (`['horizontal', 'vertical']` by default).

#### Scope call for initial implementation

Build the shell with **all layouts ready** (2p sit-down, 3–8p sit-down oval, head-to-head court), but **only wire per-seat content** for the games that need it when they ship. XO's per-seat slot stays empty until we have something to put there (e.g., an ELO badge). Poker fills it completely.

### 4.7 Tournament-specific additions `[DECIDED]` — sidebar context card only

**The table surface is identical** to a pickup game (§3.3). Tournament context lives in the sidebar as a dedicated **Tournament context card**, visible only when `isTournament = true`.

**Contents of the card**:

- Tournament name (links to `/tournaments/:id`)
- Round label ("Round 2 of 4", "Quarterfinal")
- Match format ("Best of 3", "Single game")
- Current series score (e.g., "You 1 – 0 Opponent")
- What happens next (brief — "Winner advances to Round 3")
- Secondary "View bracket →" link

```
┌──────────────────────────────┐
│ 🏆 Spring Cup                │
│ Round 2 of 4 · Best of 3     │
│ Series: You 1 – 0 Opponent   │
│ ─────────────────────────    │
│ Winner advances to Round 3   │
│ [View bracket →]             │
└──────────────────────────────┘
```

**What we don't add**:
- No bracket thumbnail on the table surface
- No next-opponent preview (noise for the current match)
- No bracket-position label on the table surface

**Tables list (`/tables`)**: "Tournament" in the Type column already exists — unchanged.

**Head-to-head tournament matches**: same sidebar card, no other differences.

**Data source**: `Table.isTournament` + a join to the `TournamentMatch` row for context (round, bestOfN, series score). After Phase 3.4 unifies Tables with the realtime layer this is a straightforward query — no new API surface required.

---

## 5. Current-state inventory

What's built today that this paradigm has to replace or evolve:

- `/tables` list view: rows in a ListTable with status, seats count, seat-strip dots, type label
- `/tables/:id` detail view: grid of numbered seat boxes + join/leave/delete actions
- `PlatformShell` wrapper: game board in a centered column + table-context sidebar (seated players list, spectator count, Gym/Puzzles links)
- XO `GameComponent`: self-contained board with PlayerStrip header ("vs Bot-name")
- Presence tracking: live watcher count via `table:presence` socket event
- Phase 3.4 will collapse in-memory Rooms into Tables — this paradigm should be designed so 3.4 just wires data into whatever we design here.

---

## 6. Implementation phasing `[DECIDED]`

### Phase 3.5 — Rendered table (minimum viable paradigm)

Ships the Medium rendered table for 2p sit-down and 2p head-to-head. XO validates sit-down; shell is ready for head-to-head when Pong arrives.

- Add `meta.tableArchetype` (`'sit-down' | 'head-to-head'`) + `meta.orientations` (`['horizontal', 'vertical']`) fields. Defaults preserve existing behavior.
- Evolve `PlatformShell` to render a `<TableSurface>` with positioned `<Seat>` slots. Board renders in the `<TableCenter>` rect.
- Seats are avatar + name, spatially positioned.
- Forming → Playing transition: fade-in on the center when ACTIVE lands (§4.4 option B); respect `prefers-reduced-motion`.
- Relative POV (§4.2): you at bottom / near-end.
- Spectator badge (§4.3): edge cluster with click-to-expand popover; sidebar list unchanged.
- End-of-game seat indication (§4.5): winner glow, loser muted, plus small outcome banner.
- Tournament context card in sidebar (§4.7) when `isTournament = true`.
- QA: XO still plays correctly via the new shell on both desktop and mobile.

### Phase 3.6 — Multi-seat sit-down shell (no new games yet)

Shell gains layouts for 3–8p sit-down tables and the per-seat render slot API for hidden-info games. No user-visible change from a gameplay standpoint — this is infrastructure for Poker to land cleanly in Phase 5.

- Seat position maps for 3/4/6/8p (round / oval).
- Per-seat render slot API (game returns content per seat, shell positions it).
- Per-seat visibility control via `getPlayerState(playerId)` — shell asks the game what to render for each seat from each viewer's POV.
- Responsive behavior: 8p oval on desktop, compact/rotated on portrait mobile.
- XO / Connect4 leave per-seat slots empty — no game changes required.

### Phase 4 — Connect4 (validates 2p sit-down with a second game)

Already in the plan. With the shell done, Connect4 is a `meta + GameComponent + botInterface` drop-in. No shell changes.

### Phase 5 — Poker (validates 8p + hidden-info)

Already in the plan. Poker fills the per-seat slots (cards, chip stacks, dealer button) and renders community cards + pot via `previewState`. Shell handles visibility per viewer.

### Phase 6 — Pong (validates head-to-head court)

Already in the plan. Pong uses the court layout the shell ships. Responsive orientation handled by shell.

### Phase 3.7 — Optional polish

- Sit-down animation on seat claim (§4.4 option C)
- Showdown / chip / card animations for card games (per-game assets)
- Any additional visual refinements from live use

### Migrations / data model

No Prisma migrations required — all changes are frontend + shell + `meta` fields on game packages.

---

## 7. Open discussion log

Populated during design conversations; entries promote to decisions in §3–§6 once settled. Currently empty — all conversation points were integrated into the relevant sections as they came up.

---

## 7. Open discussion log

Running notes from our conversation — raw material we can promote into decisions above.

- (Empty — we'll add entries as we go)
