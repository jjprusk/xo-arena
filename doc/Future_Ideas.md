<!-- Copyright © 2026 Joe Pruskowski. All rights reserved. -->
# Future Ideas

Deferred features and improvements that are worth revisiting but not currently prioritized.

## Known Critical Bugs

### PlayVsBot start-flow — full collapse landed 2026-05-16 (filed 2026-05-13)

**Status — RESOLVED on dev (pending /stage + /promote).** All four originally-filed CTA items have shipped. The 3-RTT start-flow chain is now collapsed into a single `POST /api/v1/play/bot`: the server pre-allocates the SSE session id and the client claims it via `?sseSession=<id>` when the shared EventSource opens. The opening board is returned in the same response, so the SSE round-trip is no longer on the perf-ready critical path.

**Final shipped form (dev v5.7):**

```
   0ms  navigate
   …    HTML + lazy JS chunk
   ~    POST /api/v1/play/bot   → { sseSessionId, tableId, slug, board, mark, currentTurn, bot }
        setPlayBundle → applyCreateResultHvb → setPhase('playing')
   ~    board cell rendered (tReady)
        ┄ in parallel ┄
        EventSource open with ?sseSession=<id>  (claims pre-allocated session via attachRes)
```

**Structural collapse confirmed** by `perf/perf-playvsbot.js` (asserts run as part of the benchmark, not just metric tracking):

- `POST /api/v1/play/bot` — exactly **1** per run ✓
- `POST /api/v1/rt/tables` — **0** per run ✓ (collapsed)
- `POST /api/v1/rt/tables/:slug/join` — **0** per run ✓
- `GET /api/token` — **0** on critical path ✓
- `GET /api/v1/bots?gameId=xo` — **0** on critical path ✓

**Local-dev measurement (3-run benchmark, post-StrictMode-dedup):** `tReady` p50 = **853 ms** (Vite dev mode, no JS minification, sourcemaps on — staging/prod numbers will land lower once deployed).

**Mobile confidence — new `perf/perf-playvsbot-mobile.js`** (Fast 3G profile via CDP `Network.emulateNetworkConditions` + Pixel 5 device): same harness, throttled to 1.6 Mbps down / 750 Kbps up / 150 ms RTT. Run via the qa menu's new "PlayVsBot mobile (Fast 3G)" entries for local / staging / prod. This is the channel that translates the structural win into measured mobile minutes-of-life.

| Date | Version | Item | Status |
|---|---|---|---|
| 2026-05-15 | v5.5 | 1 — HvB join-chain trim | shipped |
| 2026-05-15 | v5.6 | 2 — `[data-perf-ready]` marker | shipped |
| 2026-05-15 | v5.6 | 3 — server `/bots?gameId=` cache | shipped |
| 2026-05-15 | v5.6 | 4 — eager initial-state event | confirmed fictional (struck) |
| 2026-05-16 | v5.7 (dev) | **3′ — full `POST /play/bot` collapse** | **shipped** |

**What shipped in v5.7:**

- **`backend/src/routes/play.js`** — new `POST /api/v1/play/bot`. Thin orchestrator: resolves the community bot (or accepts caller-supplied `botUserId`), mints + pre-registers an SSE session id with `res:null`, calls `tableFlow.createHvbTable`, tracks the table on the pending session, returns `{ sseSessionId, tableId, slug, label, mark, board, currentTurn, bot }`. Anonymous-OK. 12 vitest cases in `play.test.js`.
- **`backend/src/realtime/sseSessions.js`** — new `attachRes(sessionId, { res, onDispose, userId })` helper. Upgrades a pending pre-allocated session by attaching the live SSE response + dispose callback. Preserves any tables already joined. 5 new vitest cases.
- **`backend/src/routes/events.js`** — `/api/v1/events/stream` now honors `?sseSession=<id>`. If the id matches a pending pre-allocation it claims via `attachRes`; otherwise falls through to the existing mint-on-open behavior. Backward-compatible for every other flow (PvP, tournaments, demo, gym, admin).
- **`landing/src/lib/useEventStream.js`** — new `claimSseSession(id)` export stages a pre-allocated session id for the next `openStream()` call. One-shot; cleared after use.
- **`landing/src/lib/useGameSDK.js`** — accepts a `playBundle` parameter. When provided, skips `waitForSseSession` entirely: stages the bundle's session id, applies the create result synchronously, sets the tableId. The shared EventSource opens in parallel; the multi-step path is intact for PvP / joinSlug / tournaments / demo.
- **`landing/src/pages/PlayPage.jsx`** — `vs-community-bot` action now calls `api.play.startBot()` instead of `getCommunityBot()`, passes the response to `<GameView playBundle={…}>`. Module-level in-flight dedup so React StrictMode dev double-mount doesn't create a stranded duplicate table.
- **`landing/src/lib/api.js`** — `api.play.startBot({ gameId, botUserId? })`.
- **`perf/perf-playvsbot.js`** — extended assertions: tracks `tokenGETs`, `botsListGETs`, `tablesCreatePOSTs`, `playBotPOSTs`. Summary section calls out the structural collapse (one POST replaces three).
- **`perf/perf-playvsbot-mobile.js`** — new throttled-network mobile benchmark. Wired into `npm run qa` Perf menu (local / staging / prod).
- **`e2e/tests/bot-challenge-flow.spec.js`** — new test asserts HomePage "Play against a bot" CTA emits exactly 1 `POST /play/bot` and zero `/rt/tables` POSTs. Defense-in-depth regression guard against accidental fallback.
- **`useGameSDK.sse.test.jsx`** — 3 new cases pinning the single-shot bundle branch + the multi-step fallback for non-HvB flows.

**Why we stop here on the *chain*:**

The structural cost of the start-flow chain is eliminated end-to-end — no serial RTTs remain on the critical path. The next round of optimization is no longer chain-shaped — it's session-bootstrap chatter (see the next entry).

---

### Warm-anon `/play` tReady — session-bootstrap chatter is the new bottleneck (filed 2026-05-16)

**Context:** after the PlayVsBot start-flow collapse landed on v5.7, the absolute `tReady` win was ~80 ms (924 → 842 ms desktop warm-anon prod) — meaningfully smaller than the ~200 ms we projected. The structural collapse itself worked (one `/play/bot` POST replaces the three-RTT chain), but the wall-clock floor moved to a different bottleneck: **cold-mount session-probe chatter**.

**Measured on prod v1.4.0-alpha-5.7, slowest run waterfall:**

```
GET 235ms  /api/session    ← (1)
GET 197ms  /api/session    ← (2)
GET 160ms  /api/session    ← (3)
GET 190ms  /api/v1/bots    ← prefetch leaking onto critical path
GET 116ms  /api/session    ← (4)
GET 114ms  /api/v1/events/stream
GET 288ms  /api/session    ← (5)
GET 244ms  /api/session    ← (6)
POST 264ms /api/v1/play/bot
GET  44ms  /api/session    ← (7)
GET  44ms  /api/v1/events/stream   ← duplicate SSE open
```

**Eight `/api/session` GETs** on a single warm-anon landing — each 100–290 ms. They're parallel network-wise but several gate React renders, so the wall-clock floor stays ~850 ms even though no single request is longer than 288 ms. AppLayout, JourneyCard, ProfileMenu, AuthGate, etc. each fire their own session probe on cold mount with no in-flight dedup.

The second `/api/v1/events/stream` GET is `reopenSharedStream()` firing once on cold mount even when the auth identity hasn't actually changed (anon → anon shouldn't reopen).

**CTAs:**

1. ✅ **Dedupe `/api/session` via shared-singleton (item 1 — shipped on dev 2026-05-16).** `landing/src/lib/useOptimisticSession.js` rewritten as a module-level singleton: one fetch + one 60-second poller regardless of subscriber count. The previous version fired one fetch per `useOptimisticSession()` instance on mount; 8 simultaneous callers (AppLayout, PlayPage, HomePage, JourneyCard, ProfileMenu, …) hammered `/api/session` in parallel. New `_listeners` Set fans the shared state out to every subscriber; subscribers attach via `listener(state, pending)`; first mount starts polling, last unmount stops it. 6 vitest cases pin: (a) 5 parallel cold mounts → exactly 1 fetch; (b) shared state propagation; (c) `triggerSessionRefresh()` fires one fetch and notifies all subscribers; (d) failure → null; (e) anon → null without leaking the response shape; (f) last-unmount stops the poll. **Projected ~150–250 ms saved on the warm-anon `/play` tReady. Will rebaseline on staging/prod after /stage + /promote.**

2. **Duplicate `/events/stream` open — needs instrumentation first.** The prod waterfall shows two `/events/stream` GETs but `AppLayout.jsx:177-183`'s `reopenSharedStream()` already has an identity-change guard that should prevent firing on cold-mount anon → anon. Most likely culprit is EventSource auto-reconnect after a server-side session race (Better Auth identity probe mid-bootstrap), but without prod instrumentation to confirm I can't pick the right fix. The second open is also not on the perf-ready critical path (Cell 1 visible fires from the synchronous `applyCreateResultHvb` *before* the second open finishes), so the wall-clock cost is closer to **server-side resource leak** than user-perceived latency. Deferred until either a) we see it gating tReady in a future measurement, or b) we add SSE-lifecycle telemetry. **Files involved (when picked up):** `landing/src/lib/useEventStream.js`, `landing/src/lib/rtSession.js`, `backend/src/routes/events.js`.

**Files touched (item 1):** `landing/src/lib/useOptimisticSession.js` (rewrite), `landing/src/lib/__tests__/useOptimisticSession.test.jsx` (new — 6 cases). Regression coverage via `perf/perf-playvsbot.js` + `perf/perf-playvsbot-mobile.js` (tReady p50 + structural-collapse asserts).

**Larger items (deferred, for reference):**

- **Render `/play` before auth resolves** — AppLayout currently awaits `/api/session` before rendering child routes. Render-then-hydrate pattern: render assuming anon, hydrate to authed UI when the session lands. `/play?action=vs-community-bot` is fully anon-OK so this is safe. **~1 day. ~100–200 ms saved.**
- **Inline the opening board into the HTML** — SSR the `/play?action=vs-community-bot` route with a static empty-board placeholder. The `/play/bot` POST fires from a script tag in the HTML head, before the React bundle finishes loading. Removes the JS-boot-then-effect-then-POST chain. **~2 days. ~200–400 ms saved.**
- **Edge-route `/play/bot`** — Cloudflare Worker or Fly multi-region for this one endpoint. Costs a Tokyo user 200+ ms RTT to a single US-East Fly machine today. Needs DB read-replicas at edge or Redis-cache write-through for bot resolution. **~1 week. ~200–500 ms saved, geography-dependent.**

---

_See **Appendix — Resolved & Obsolete** at the end of this doc for fixed entries._

---

## Journey CTA spotlight — wiring leftovers

The reusable `<Spotlight target={ref} active={...} onDismiss={...} />` component shipped on 2026-04-29 (`landing/src/components/guide/Spotlight.jsx`) and replaces the ad-hoc per-page `xo-spotlight-pulse` toggle. Wired so far:

- **Step 4 (`?action=train-bot`)** — `BotProfilePage` Train button. ✅
- **Step 5 (`?action=spar`)** — `BotProfilePage` Spar block; `ProfilePage` forwards the action to the bot detail page same way it does for `train-bot`. ✅

Not yet wired (each one is one `<Spotlight>` render line + a small destination handler):

- **Step 3 (`?action=quick-bot`)** — `QuickBotWizard` "Next" button. The wizard is already a focused modal so the spotlight is lower-value here; skip unless usability tests show the Next button blends in.
- **Step 6 (`?action=cup`)** — Curriculum Cup card. No `?action=cup` handler exists on `ProfilePage` (or anywhere else), and there's no Cup-card destination element to ref. Needs the destination feature first.
- **Step 7 (`?action=cup-result`)** — result row in the tournament list. Same as step 6 — destination doesn't exist yet.

Effort: ~30 minutes per remaining wiring site once the destination handler is in place.

---

## Status snapshot (last reviewed 2026-04-23)

| Item | Status |
|---|---|
| Real-Time Presence / Inactivity Detection | ✅ Mostly done (presence store + heartbeat live; away/active refinement open) |
| Multi-Game Bots (now Phase 3.8) | 🚧 In-plan (scheduled as Phase 3.8 of the Implementation Plan) |
| Real-Time Games Against Bots (Pong) | ⏳ Open (Phase 6) |
| Persist Game State Through Deploys | ❌ Obsolete (replaced by DB-backed `Table` rows in Phase 3.4) |
| Backend Logs in Admin Log Viewer | ⏳ Open |
| Guide Help Subsystem (Chat Interface) | ⏳ Open |
| Guide as Navigation (Command Palette) | ⏳ Open |
| Configurable Guide | ❌ Obsolete (iframe guide retired; premise gone) |
| Multi-Game Architecture | ✅ Largely done as the Game SDK (Phases 1.1–1.4) — remaining games are their own phases |
| Tier 2/3 instrumentation | 🟡 Partly done (3 counters live; rest in `doc/Observability_Plan.md`) |
| Recurring tournaments schema refactor (Phase 3.7a) | ✅ Shipped — `TournamentTemplate` + `templateId` FK live; `AdminTemplatesPage` + `AdminTemplateDetailPage` exist (see Appendix) |
| Tournament admin UX overhaul | ⏳ Open — operator-facing surfaces around recurring tournaments are clumsy; entry below |
| `table.released` per-reason soak monitor | ⏳ Open (post-prod-launch — needs real traffic to be meaningful) |

## Migration-sensitivity audit (2026-04-23)

Which of the items above actually benefit from shipping *before* prod has real users? Only schema/data-migration costs scale with user volume; UX features cost the same at 0 users or 10,000.

| Item | Migration-sensitive? | Verdict |
|---|---|---|
| Real-Time Presence | Done (✅) | — |
| Multi-Game Bots (Phase 3.8) | No — schema already anticipates it (`BotSkill (botId, gameId)` unique from Phase 1.7) | Do via 3.8 on the normal track |
| Pong (Phase 6) | No — new subsystems, no data migration | Ship when scheduled |
| Persist Game State | Obsolete (❌) | — |
| Backend Logs → DB | No — just starts writing more rows | Ship anytime |
| Guide Chat | No — UX feature | Ship anytime |
| Command Palette | No — UX feature | Ship anytime |
| Configurable Guide | Obsolete (❌) | — |
| Multi-Game Architecture | Done via SDK (✅) | — |
| Tier 2/3 instrumentation | No — counters, not schema | Ship anytime |
| **Recurring tournaments refactor** | **Yes — template vs occurrence split** | **Phase 3.7a (now)** |

Also folded into Phase 3.7a for the same "easier empty than later" reason (not in the original Future_Ideas list):

- Bot `displayName` uniqueness policy
- Public profile URL structure (reserve `/users/:username`)
- OAuth prod redirect URLs at providers
- Seeded built-in bot polish (avatars, bios, ELO ladder)

---

## Multi-Game Bots

**What:** Allow a single bot to have trained models for multiple games (e.g., XO and chess). Today a bot is effectively XO-only — it holds one model. A multi-game bot would hold one model per supported game and compete on each game's leaderboard independently.

**Why deferred:** Requires a second game to exist on the platform first. The groundwork is already in place — the credits system is game-agnostic (`appId` field), the `Game` table has an `appId` column, and the Credits Plan explicitly notes "a bot can hold one model per supported game." Bot slot limits already govern agent count, not model count.

**What it would take:**
- Schema: `BotModel` table keyed by `(botId, appId)` to hold per-game weights and ELO separately from the bot's top-level record.
- Training UI: game selector when starting a training session in the Gym.
- Leaderboard: per-game filtering so a bot's XO ELO and chess ELO are tracked independently.
- Community bot matchmaking: players select a game, and only bots with a model for that game appear.

**Complexity:** Medium-to-large. Straightforward once a second game is added; no point building it for a single game.

---

## Research Log for users — in-platform training journal

**What:** A persistent training journal owned by each user that automatically captures every training session's hyperparameters, results, and per-session notes. Sits alongside the Gym → Sessions tab; surfaces in Profile and (eventually) in the Guide's What's Next recommendations.

Today the corpus (onboarding-after-the-journey.md, gym-sessions-tab.md) explicitly recommends users keep a research log **outside the platform** — a markdown file or notebook of "what I tried, what worked, what didn't." That advice is the right pattern for serious bot training, but pushing the burden onto the user externally guarantees the data never accrues into anything the platform can learn from. Bringing it in-platform produces three compounding wins.

**Why:**

1. **User memory.** Sessions tab already records every training run; users still can't remember why they picked a given learning rate three weeks ago. Notes attached to each session row close that gap with zero extra workflow — type a sentence, the platform remembers.
2. **Training-data goldmine.** Per-session notes plus their hyperparameters plus the resulting benchmark/ELO are exactly the shape of data the reranker and (eventually) fine-tuning will love. A user writes "this run plateaued because epsilon decay too aggressive"; six months later that's a labelled example for a "training-advice" assistant.
3. **Onboarding accelerator.** New users see what experienced users wrote about similar runs (privacy-gated; opt-in shared notes only). Shortens the "how do I think about hyperparameters" curve from months to days.

**What it would take:**

- **Schema:** `TrainingSessionNote` table keyed by `(userId, sessionId)`. Fields: `note` (text, ~2 KB cap), `tags` (text[]), `outcome` (enum: success / plateau / regression / inconclusive), `parentNoteId` (nullable — chain follow-ups), `sharedWithCommunity` (bool, default false), timestamps. A separate `ResearchLogEntry` table for ad-hoc entries not tied to a session (planning, retrospectives).
- **Auto-captured fields:** every training session already stores algorithm, hyperparameters (lr, gamma, epsilon, episodes, etc.), pre/post benchmark, ELO delta. The note layer attaches structured commentary to that existing data — nothing duplicated.
- **UI surface (3 places):**
  - **Gym → Sessions tab:** inline "Add note" affordance on each row. Expanding shows prior notes plus a small textarea + outcome dropdown.
  - **Profile → Training journal tab:** all notes chronologically, filterable by algorithm/outcome/tag. Markdown supported. Export to .md for backup.
  - **Help System integration:** when the user asks the Guide a training question, the retrieval pipeline can surface their own past notes (and, post-opt-in, related public notes from other users) as ranked chunks alongside the corpus. Closes the loop on point #2.
- **Privacy:** notes are private by default. Sharing is opt-in per-note; a "publish" toggle scrubs `userId` and adds the note to a public training-notes corpus that the Help System indexes.
- **Streak / habit nudges:** the Guide's What's Next surface can prompt "you've trained 5 times this week — add a note about what you tried" to drive accrual. Discovery reward eligible.

**Complexity:** Medium. Schema and auto-capture are straightforward (Sessions tab already has the data). UI is 2–3 dev days for the basic version. The cross-cutting Help System integration (point 2) is what makes this transformative; that's another ~1 week and depends on the reranker work currently scoped for Sprint 5+.

**Sequencing dependency:** ships best after Sprint 3 of the Help System (so user-private notes can be a retrieval source via the same FTS+pgvector path) and after the §2.5 rate limiter (so a "publish your note as community context" action can be safely opt-in without abuse vectors). The auto-capture-only version (notes attached to sessions, no Help integration) is a clean v1 deliverable any time after Sprint 2.

---

## Real-Time Games Against Bots (e.g. Pong)

**What:** Support games with a continuous real-time loop — not turn-based. A classic example is Pong, where the bot controls a paddle and reacts to ball position in real time rather than waiting for a discrete move prompt.

**Why deferred:** The current architecture is designed around turn-based games (discrete moves, game recorded on completion). Real-time games require a fundamentally different loop: a shared simulation running at a fixed tick rate, input from both sides on every frame, and a bot that acts on continuous state rather than a board snapshot.

**What it would take:**
- **Game loop:** server-authoritative tick loop (e.g. 60Hz) running in the backend, or a client-side loop with the bot running in the browser. Client-side is simpler to start and avoids server compute overhead for solo bot games.
- **Bot model:** the AI input is a continuous state vector (ball position, velocity, paddle positions) rather than a discrete board encoding. Suitable algorithms: DQN or Policy Gradient trained on the continuous state space. The existing Gym infrastructure could be extended since DQN already trains on arbitrary state vectors.
- **Rendering:** a canvas or WebGL game loop on the frontend replacing the current board grid.
- **Recording:** game outcome (win/loss/score) still POSTed to `/games` at completion — credit and ELO hooks unchanged.
- **PvP extension:** two human players could also play real-time games against each other via the existing WebSocket infrastructure, with the server relaying inputs rather than authoritative state.

**Complexity:** Large. The game loop and rendering are new territory. The AI training pipeline is more reusable than it might seem — the Gym's episode-based training maps naturally to a real-time game where each episode is one full match.

---

## Backend Logs in Admin Log Viewer

> **Status update (2026-04-29):** the frontend half landed — `landing/src/lib/frontendLogger.js` batches errors / warnings to `POST /api/v1/logs` and the admin Log Viewer now actually populates with `source: frontend` rows. `setLogUserId` is wired through AppLayout so user context is captured. Backend pino → DB is the remaining piece; the rest of this entry covers what's left.

**What:** Route backend (pino) logs into the database so the admin Log Viewer shows all four sources — `api`, `realtime`, and `ai` — alongside the frontend rows already flowing in. Currently pino writes to stdout (visible in the Fly.io log stream) but never reaches the `logs` table.

**Why deferred:** stdout logs are accessible via Fly.io / `docker compose logs` for now. The viewer is already useful for frontend errors. Wiring pino to the DB adds write pressure on every request.

**What it would take:**
- **Pino DB transport:** a custom pino transport (or `pino-transport` wrapper) that batches log entries and inserts them into the `logs` table, respecting the existing `pruneIfNeeded` limit. Use `source: 'api'`, `'realtime'`, or `'ai'` depending on origin.
- **Log level threshold:** only write INFO and above from the backend to avoid flooding the table with debug noise. DEBUG can remain stdout-only.
- **Live tail:** backend log entries flow through the existing `appendToStream('admin:logs:entry', ...)` path automatically once they're written via the same POST handler the frontend logger uses (or via a direct stream emit from the transport).

**Complexity:** Small-to-medium (~half a day). The DB schema, ingestion endpoint, pruning, frontend logger, and live-tail SSE are all in place — the missing piece is just the pino → DB bridge.

---

## Help System — post-launch enhancements (Sprint 5)

**Status:** Sprint 4 closed all v1 scope of the Learnable Help System (corpus + retrieval + admin editor + OpenAI-backed `/help/ask` + Guide drawer UI + feedback + browse pages + curation queue + metrics dashboard). The items below were originally tracked as "Sprint 5+" in `archive/Help_System_Sprint_Tracker.md` and moved here so the tracker stops at v1 scope. Most are data-driven — they want a few weeks of real prod traffic before they pay off.

**Source of truth for the v1 build:** `archive/Help_System_Sprint_Tracker.md` (closed sprints 1–4). For shipping new data, edit corpus docs via the admin editor at `/admin/help` (HELP_ADMIN gated). Gap-filling candidates surface on the new `/admin/help/metrics` dashboard under "Recent no-source queries".

**Triage order** (in roughly the order they'd pay off once we have prod data):

- **Corpus gap-filling from real traffic.** Mine `HelpQuery` (especially the `topNoSourceQueries` rollup from §4.3) for unanswered questions and write gap-filling docs. The "+ Doc" affordances on the curation page + metrics dashboard already seed the editor with the question text — this is editorial work, not new code. Wait until the curation queue has ~2–4 weeks of prod feedback before the first pass.
- **Reranker (v2).** Train a small ranker over (query, chunk, signal) triples once ~1k feedback rows are available. Deploy as a `HelpReranker` model behind a `SystemConfig` flag so we can A/B against the current hybrid (FTS + cosine) retrieval.
- **Embedding upgrade.** If `text-embedding-3-small@384` quality plateaus, evaluate BGE-small (same 384 dim — drop-in) or a larger-dim model (requires a `help_chunks.embedding` column-type migration + full reindex). The auto-reindex-on-model-change path from Sprint 2 §2.1 already handles drop-in swaps; the dim change is the only real lift.
- **Streaming content filter.** Today's filter runs post-stream — if the model emits a banned term mid-answer the UI sees it briefly before the replacement lands. Move filtering to the token-buffer level so banned tokens never reach the wire. Trade-off: filter cost per chunk vs. per response.
- **LoRA fine-tuning (v3).** Once high-quality Q&A pairs accumulate (target ~5k HELPFUL-graded pairs), fine-tune a small model on the best of them as a vendor-independent fallback. Complementary to the reranker, not a replacement.
- **Voice input.** Speech-to-text on the Guide chat input. Cheap once the streaming UI is stable; relevant for mobile.
- **Cross-session help history.** Profile-page view of past Q&A so users can revisit a previous answer. Schema is already there (`HelpQuery.userId` + answers); this is purely UI.
- **Per-IP rate limit.** Add an IP-keyed limiter alongside the existing per-user limiter from Sprint 2 §2.5, gated on detecting shared-account abuse in the wild. Until that signal appears, the per-user limiter is sufficient.
- **Auto-redact PII in question text.** Regex scrubber for emails / phone numbers / addresses in the user's question before it goes to OpenAI. Belt-and-suspenders: the existing disclosure ("Don't include personal details") covers the policy side; this would cover the slip.

---

## Guide as Navigation System (Command Palette Evolution)

**What:** Add a ⌘K command palette — a keyboard-invokable search overlay (Spotlight / Linear-style) that lets users jump anywhere in the app by typing rather than clicking through the nav.

**Current navigation structure:**
- **Desktop:** a top header bar with Play, Gym, Puzzles, Rankings as primary links, plus Stats / Profile / About in-line. Admin links appear for admin users.
- **Mobile:** a fixed bottom tab bar (Play, Gym, Ranks, Stats, Profile) plus a hamburger menu that expands the full link list including Settings, FAQ, and About.
- **Guide button:** a pulsing "Guide" button sits next to the logo in the header and opens the Getting Started modal, whose cards navigate directly to destinations via `target="_top"` links. Users can hide this button in Settings.

The nav works fine but requires knowing where things live. There's no way to reach a page by typing its name, and no single surface that lists every destination at once.

**How the palette would work:**
- Press ⌘K (Ctrl+K on Windows) from anywhere to open a centered overlay with a search input and a list of destinations.
- The list pre-populates with the same links in `MENU_LINKS` — Play, Gym, Puzzles, Rankings, Stats, Profile, About, FAQ, Settings — plus admin links when applicable.
- Typing filters the list instantly. Enter or clicking an item navigates and closes the palette. Escape closes without navigating.
- A small ⌘K hint badge in the header (next to the Guide button) would make it discoverable.

**Relationship to the guide:** The guide is visual and onboarding-oriented — it shows the journey from new user to competitor. The palette is speed-oriented for returning users who already know what they want. They serve different moments and can coexist.

**Why deferred:** The existing nav covers current usage. The palette pays off most when users are frequent enough to remember keyboard shortcuts.

**Complexity:** Medium (~2 days). Purely frontend — a new React component with a `keydown` listener at the app root, no backend changes needed.

---

## Tier 2/3 transport — instrumentation (partly done)

The first three items (SSE client count, presence-store size, XREAD-loop heartbeat) are wired in `resourceCounters.js`. The remaining items below are tracked more fully in **`doc/Observability_Plan.md`** (SSE broker peak/age, Redis stream XLEN + consumer lag, Web Push delivery metrics). Treat this entry as the short form; work from the Observability Plan when picking up an observability sprint.

Open nice-to-haves — wire them in once real traffic lands or when push starts behaving oddly:

- **Push subscriptions count** — snapshot `db.pushSubscription.count()` to see how many device endpoints we're pushing to. Also useful for sizing UI in the admin health dashboard.
- **Push send metrics** — expose counters from `pushService`: `pushSent`, `pushFailed` (transient, non-404/410), `pushPurged` (dead endpoints). Surfaces success-rate and catches a VAPID misconfiguration quickly.
- **Redis Stream length** — `XLEN events:tier2:stream`. Bounded by MAXLEN=5000 so it'll always cap there, but tracking the value confirms trimming is working and gives a rough "events per minute" signal when cross-referenced with snapshot timestamps.

Low priority, mentioned for completeness:

- **`/api/v1/presence/heartbeat` QPS** — normal load is `(online users) / 15s`. A sudden 10× spike indicates a client-side retry-loop bug.
- **Dispatch → push fan-out counter** — how often `notificationBus.dispatch` actually lands a push vs skips because SSE was online. Useful for tuning which event types should have `push: true` in the REGISTRY.

**Effort:** each item is ~5–10 LOC in `resourceCounters.js` plus a small `export function` in the owning module (`pushService.js`, `tournament/src/lib/redis.js` for XLEN, etc.).

---

## Tournament admin UX overhaul — ✅ SHIPPED 2026-05-10 (see Appendix)

(Original analysis kept below for archaeology — the sprint covering items (a)–(i) is described in the Appendix entry "Tournament admin UX overhaul — shipped 2026-05-10".)

The schema refactor (Phase 3.7a — `TournamentTemplate` + `templateId`) shipped: see the Appendix entry. What did **not** ship is the operator-facing UX that takes advantage of the cleaner model. Today the create/edit/manage flow for recurring tournaments is clumsy in nine concrete ways, all of which an admin runs into within their first few minutes of use.

**Symptoms of the clumsiness (observed on prod 2026-05-09):**

1. **One form does both jobs.** `landing/src/components/tournament/TournamentForm.jsx` (431 lines) creates a one-off tournament *and* a recurring template by toggling `isRecurring`. Recurrence config (interval, end date, pause, opt-out) is buried in a sub-section near the bottom of a single-column form.
2. **No schedule preview.** After creating a weekly template, nothing shows "next runs: Wed Apr 22, Wed Apr 29, Wed May 6 …". Admins can't sanity-check the schedule without waiting for the sweep to spawn the next occurrence.
3. **Looking up a recurring series is broken.** `RecurringRegistrations` (`AdminTournamentsPage.jsx:664`) requires the admin to **paste a Template ID** into a text input. There's no clickthrough from the tournaments list to its registrations.
4. **Pause / Stop / Cancel-this-occurrence semantics aren't surfaced.** `recurrencePaused` is a checkbox inside the edit modal. There's no row-level "Pause series" / "Stop series" action; admins conflate cancelling one occurrence with stopping the whole thing.
5. **No edit-template-vs-edit-occurrence branching in the UI.** The schema separates them, but the form doesn't visually distinguish "you are editing the template (affects all future runs)" from "you are editing this occurrence."
6. **Seed bots and standing human registrations are managed in a separate panel.** Most "I want a weekly cup with these 4 bots" workflows take 3 surfaces — create form, seed-bots tab, registrations panel — when they should be one.
7. **No clone affordance.** Common operator action ("make another one like this on a different day") requires retyping every field.
8. **Date input inconsistency.** `startTime` uses the custom `DateTimePicker` (Safari-safe); `recurrenceEndDate` is a bare `<input type="date">` with the just-shipped "no end date" toggle as a workaround. The fix is to drop bare native date inputs entirely and use the same picker.
9. **No timezone affordance.** Datetimes are entered in browser-local time with no display of the resolved UTC or "tournament starts 14:00 UTC for users in TZ X."

**Plus a structural near-miss:** `isTest` and `isRecurring` are 150 lines apart in the form — creating a test recurring series for QA is undocumented.

**Proposed scope (do as a single sprint):**

- **(a)** Recurring-series list view at `/admin/templates` with status pills (active / paused / stopped), next-run timestamp, subscriber count, seed-bot count. Click row → template detail page.
- **(b)** Schedule preview on the template detail page — render the next 5 occurrences (computed from `recurrenceInterval` + `recurrenceEndDate` + `recurrencePaused`) so admins can verify the schedule visually.
- **(c)** Edit-template vs edit-occurrence branching. The current `TournamentModal` should detect `templateId` and route to a "Template editor" mode with explicit "this affects all future runs" messaging; otherwise the existing single-occurrence edit.
- **(d)** Row-level actions on the templates list: **Pause series**, **Resume series**, **Stop series**, **Clone**. Mirror these on the template detail page.
- **(e)** Embedded standing-registration management — a panel inside the template detail page (not a separate lookup). Add/remove humans, view missed-counts, opt-out users.
- **(f)** Embedded seed-bot management — same idea: a panel on the template detail page, not a separate tab.
- **(g)** Clone-from action on every tournament row in `AdminTournamentsPage` — pre-fills `TournamentForm` with the source's config, clears name + dates.
- **(h)** Replace every bare `<input type="date">` with the existing `DateTimePicker`. Add a small TZ display next to start times (e.g. "14:00 ET / 18:00 UTC").
- **(i)** Reorganise `TournamentForm` into three top-level groups: **Basics** (name, game, mode, format), **Schedule** (start, registration, recurrence), **Advanced** (seed bots, pace, opt-out, isTest). Recurrence becomes a first-class section, not a buried sub-section.

**Effort:** Medium-large (~3–5 days). Most of it is React surfaces; the backend is fine. Suggest tackling in the order above (a→i) so each piece is independently shippable.

**Planned foundation sprint (~1.5–2 days):** `(h) → (i) → (c)` — date picker consistency, then `TournamentForm` reorg into Basics / Schedule / Advanced, then the template-vs-occurrence edit-mode branching. Items (a) and (f) are already shipped (the template pages + `SeedBotsPanel` exist); (b)(d)(e)(g) become parallel leaves once (c) lands.

**Why now (vs deferred again):** the schema refactor shipped without the matching operator UX, so admins have been running on the worse-of-both-worlds — new schema complexity, old single-form ergonomics. The Cora-3 / Cora-1 admin flows from 2026-05-09 surfaced this concretely.

---

## `table.released` per-reason soak monitor — ⏳ OPEN (defer until prod has traffic)

**Background:** Chunk 3 of the table-fixes sweep added a per-reason `table.released` counter to `/api/v1/admin/health/tables` (reasons: `disconnect`, `leave`, `game-end`, `gc-stale`, `gc-idle`, `admin`, `guest-cleanup`, plus `OTHER` catch-all). The shape of the per-reason histogram is the V1-acceptance success metric for "where do tables actually die" — does the disconnect bucket dominate (Safari hang regression) vs. the game-end bucket (healthy completion), is the `OTHER` bucket nonzero (typo'd reason at a call site), is `gc-idle` climbing (idle abandonment runaway), etc.

**Why deferred:** On staging the only traffic is manual QA — the per-reason distribution reflects the tester's clicks, not real user behaviour. Running a soak there would just measure the test, not the system. The metric's value scales with traffic.

**What to do post-prod:**

- Schedule a periodic poll of `/api/v1/admin/health/tables` (e.g. hourly via the same scheduler used for tournament sweeps, or a cron-driven Slack/Linear post). Diff against the previous reading and post the per-reason deltas.
- Alert thresholds (rough first cuts; tune from data):
  - `OTHER > 0` for any window → call-site typo, page on-call.
  - `disconnect / game-end > 0.5` over a 1-h window → Safari/network regression suspected; page on-call.
  - `gc-idle` rising > 5/hour while active sessions are non-zero → idle threshold misconfigured.
- Cross-reference with `tableCreateErrors.P2002` (should be ~0 post-chunk-1) and `gc.secondsSinceLastSuccess` (should be < 600s).

**Effort:** ~2 hours. Reuse the existing scheduler + a small `lib/healthDiff.js` to compute deltas. Pairs naturally with the rest of the Tier 2/3 instrumentation work (see entry above).

---

## Redis-backed `sseSessions` registry — ⏳ OPEN (defer until non-Fly hosting is on the table)

**Background:** SSE sessions are stored in a per-process `Map` in `backend/src/realtime/sseSessions.js`. With more than one backend machine, follow-up POSTs round-robin via the LB and ~50% land on the machine that doesn't have the session, returning 409 `SSE_SESSION_EXPIRED`. Surfaced on prod 2026-05-04 when prod scaled past 1 backend machine — staging was unaffected because it runs a single machine.

**What we shipped instead (2026-05-04):** `backend/src/realtime/flyReplay.js` — session ids are minted as `<FLY_MACHINE_ID>.<nanoid>` and `requireSseSession` emits a `Fly-Replay: instance=<owner>` header when a POST lands on a non-owning machine. Fly's edge proxy transparently replays the request on the right machine. Off-Fly (local dev / tests), `FLY_MACHINE_ID` is unset and the path is dormant — sessions are bare nanoids and behavior matches the original sync API.

**Why Fly-Replay was the right call now:** the actual `res` writable for an open SSE connection lives in one machine's process memory and cannot be migrated. Cross-machine *event delivery* already works today via the redis-streams broker (each machine subscribes and pushes to its own connected clients). The only thing that needs cross-machine coordination is the *session-liveness lookup* — and Fly-Replay routes that lookup back to the connection-owning machine in ~10ms with zero state migration. A Redis-backed registry would solve the same lookup with ~500 LOC of changes (async API ripples through 12 test files + 24 callsites). Until we have a concrete reason to leave Fly, the smaller fix is correct.

**When to do the Redis migration:**

Trigger on any of:

1. **Non-Fly hosting decision** — moving any backend instance to a non-Fly target (AWS/GCP/Cloudflare/self-hosted K8s) where `Fly-Replay` doesn't exist. Prerequisite for the move, not an after-the-fact fix.
2. **Multi-cloud / multi-provider deployment** — running backend simultaneously on Fly + another platform for redundancy or geo. Fly-Replay only routes within Fly, so cross-provider sessions need a portable lookup layer.
3. **Fly deprecates or rate-limits Fly-Replay** — vendor risk; if the header behavior changes, we need an exit.
4. **Replay-tax becomes a measurable problem** — if backend p95 baselines show the ~10-20ms replay penalty is dominating a hot endpoint and we want to eliminate it, redis lookup on every machine removes the round-trip. Unlikely to matter at our scale, but worth re-checking annually.

**What to build (when triggered):**

- Move `_sessions` Map to a Redis hash `sse:session:<id>` with 60s TTL, refreshed every `touch()`.
- Move `_byUser` Map to a Redis set `sse:byuser:<userId>`, expired with the parent.
- Keep `_pendingDispose` timers and `_onDispose` callbacks in-memory on the originating machine (they fire off the connection-close event, which always happens locally).
- Make `get`, `forUser`, `joinTable`, `leaveTable`, `touch`, `tablesFor`, `pongRoomsFor` async.
- Add a Lua script (or pipelined commands) for the read-modify-write of `joinedTables` to avoid races between concurrent POSTs on different machines.
- Tear down `flyReplay.js` and revert `events.js` / `realtime.js` edits — Fly-Replay becomes dead code at that point.

**Effort estimate:** 2-3 days for the rewrite + test updates, plus 1 day of staging soak before promote. Pair it with the move to whichever new hosting target triggers it — the work is mostly the same.

**Doc cross-refs:** `backend/src/realtime/flyReplay.js` (current implementation), `doc/Realtime_Channels.md` (channel namespace + POST routes affected).

---

# Appendix — Resolved & Obsolete

Entries that were once "future ideas" or open bugs but have since been fixed, superseded, or rendered obsolete. Kept for archaeology — they often explain *why* the current architecture looks the way it does. Newest at top.

## ✅ Guide Help Subsystem (Chat Interface) — shipped 2026-05-15 (Help_System Sprints 1–4)

**Problem (as originally filed):** the "Ask Guide anything…" input at the bottom of the Guide panel was an unconnected placeholder. Wiring it up required deciding on context injection, conversation persistence, and cost controls.

**What shipped:** the full **Learnable Help System** — corpus + retrieval + admin editor + OpenAI-backed Q&A + browse pages + feedback + curation + metrics — over four sprints culminating in `v1.4.0-alpha-5.4` on prod (2026-05-15). The placeholder `div` in `GuidePanel.jsx` is now a real `HelpInput` + streamed `HelpAnswer` thread. The originally-proposed `POST /api/guide/chat` endpoint became `POST /api/v1/help/ask` (SSE-streamed, grounded in the corpus, not a free-form chat). Source of truth: `archive/Help_System_Sprint_Tracker.md` (Sprints 1–4 closed) + `archive/Help_System_Plan.md`.

**Key deltas from the original sketch:**
- **Architecture:** the actual system is retrieval-augmented (corpus of 43 versioned `HelpDoc` rows + pgvector + FTS hybrid retrieval) rather than free-form chat. Cheaper, deterministic, easier to curate. Conversation persistence was scoped *out* — each turn is independent and grounded in the docs.
- **Cost controls:** in-process per-user rate limiter (5/min, 50/day) in `helpRateLimit.js`. OpenAI project `aiarena` has a $100/mo hard cap + $10/$25 alerts, $5/mo on the local-dev key.
- **Surfaces beyond the chat input:** Sprint 3 also shipped public `/help` + `/help/:slug` browse pages, and Sprint 4 shipped the admin curation queue + metrics dashboard so the corpus can be edited and grown from real traffic feedback.
- **Post-launch follow-ups** live in the "Help System — post-launch enhancements (Sprint 5)" section above (reranker v2, embedding upgrade, streaming filter, gap-filling from prod data, etc.).

## ✅ Tournament admin UX overhaul — shipped 2026-05-10

**Problem:** Phase 3.7a separated `TournamentTemplate` from `Tournament` in the schema, but the operator-facing UI never caught up — the create/edit/manage flow for recurring tournaments was clumsy across nine specific dimensions catalogued in the original "Tournament admin UX overhaul" section earlier in this doc.

**What shipped (foundation sprint then final sprint):**

- **Foundation sprint** (h → i → c): bare `<input type="date">` and `datetime-local` were swapped for the shared `<DateTimePicker>` (Safari-safe) plus a `<LocalTZ>` line showing "14:00 EDT / 18:00 UTC"; `TournamentForm` reorganised into three top-level groups — Basics / Schedule / Advanced — with recurrence promoted to a first-class subsection under Schedule; `TournamentModal` detects an occurrence's `templateId` and renders an amber banner linking to the template editor so admins know edits there are local to *this* run.
- **Schedule preview** (b): pure helper `landing/src/lib/recurrence.js#nextOccurrences` mirrors the scheduler's `advanceOne` math. New "Schedule preview" panel on `/admin/templates/:id` renders the next 5 spawn times honoring `recurrenceEndDate` and `paused` (paused → "no occurrences" message).
- **Row-level series actions** (d): templates list `ActionMenu` now offers Pause/Resume series, **Stop series** (sets `recurrenceEndDate=now()` + `paused=true` so the scheduler permanently halts; reversible via clearing the end date but distinct from Delete), and **Clone** (deep-copies template config + seed bots, drops subscriptions, opens the clone in edit mode). New backend routes: `POST /admin/templates/:id/stop` and `POST /admin/templates/:id/clone`.
- **Embedded standing-registrations panel** (e): replaces the orphaned "look up by Template ID" form on `AdminTournamentsPage` with a "Standing registrations" panel directly on the template detail page. Shows display-named subscribers with missed-counts, opt-out toggle, an "Add subscriber" input that accepts username or userId, and an "Include opted-out users" checkbox for audit. New tournament-service routes: `POST /api/recurring/:templateId/registrations` (admin enrol by username/userId, idempotent), `DELETE /api/recurring/:templateId/registrations/:userId` (sets `optedOutAt`, preserves history), and `?includeOptedOut=true` query on the existing list endpoint.
- **Clone-from on tournament rows** (g): `AdminTournamentsPage` row `ActionMenu` gained a Clone item that opens `TournamentModal` in a new `mode='clone'` — `TournamentForm` is prefilled from the source row with name suffix " (Copy)" and `startTime` / `registrationOpenAt` / `registrationCloseAt` cleared, falling through to `tournamentApi.create()` (not update).

**What did not ship:** items (a) and (f) were already present from earlier work — `AdminTemplatesPage` exists at `/admin/templates` and `SeedBotsPanel` is embedded on the template detail page.

## ✅ Bot Challenge & Discovery — shipped 2026-05-10

**Problem:** "play another player's bot" was the platform's stated key differentiator but had no UX path. `POST /rt/tables { kind: 'hvb', botUserId }` and `GET /api/v1/bots` already supported it server-side; the gap was discovery + a one-click action surface.

**What shipped (Phases A → C):**

- **Primitives** (Phase A): `useBots()` SWR hook over the public bot list, `<BotCard>`, `<ChallengeButton>` (default + icon variants, guest-friendly, posts `/rt/tables` and navigates to `/play?join=<slug>`), `<BotFilterBar>` (search, ELO range, owner toggle, game select, "show all bots" toggle).
- **Surfaces** (Phase B): new `/bots` directory (scrollable `ListTable` of Bot/Owner/ELO/Games/Play); "Challenge" sections on `BotProfilePage` and the `/rankings` bot rows; "Challenge any bot" link on Home below "Watch another match"; About moved out of primary nav into the footer, replaced by Bots.
- **Pickers** (Phase C): tabbed bot picker in the Create Table modal (My / Community / All); Quick Match button on the directory header — calls new `GET /api/v1/bots/quick-match` (guest-OK, ELO-window candidate picker that excludes own bots).
- **Skill-gating:** backend `listBots()` now returns `playableGameIds` per bot, sourced strictly from `BotSkill` rows (legacy `botModelType='minimax'` bots without a skill row were false-positives — they reject at table-create with `NO_SKILL`). The directory filters to playable bots by default; a "Show all bots" toggle reveals the rest with a greyed-out Challenge button and a "No skill for XO" hint.
- **Context-aware navigation:** every linker to `/bots/:id` (directory rows, Rankings, ProfilePage's "My bots") passes `state.from`; `BotProfilePage`'s back link prefers state with a `/bots` fallback. `ChallengeButton`/`QuickMatchButton` thread the same state into `/play`; `PlayPage.leaveHref` honors it so "Leave Table" returns the user to the directory they came from instead of a hardcoded `/tables`.
- **Guest path:** every challenge surface works for unauthenticated visitors; the existing post-game signup CTA fires after the first finished game, not as a gate.
- **Tests:** unit coverage on each primitive + page + the quick-match route; new `e2e/tests/bot-challenge-flow.spec.js` covers the guest path through directory, profile, Quick Match, and Rankings.

**Original plan doc:** `Bot_Challenge_Plan.md` (deleted on completion — this entry is the digest).

## ✅ Bot best-of-N series cap mis-formula — fixed 2026-05-09

**Symptom:** every prod tournament with bot-vs-bot matches came in 10–35% over its theoretical bracket-game ceiling. Cora 3 (6-team SINGLE_ELIM bestOf3, all bots) played 20 games against an expected 15 — three of five played matches recorded `p1Wins=0, p2Wins=0` despite COMPLETED status, and showed exactly 5 games each (all draws + deterministic-tiebreaker resolution).

**Root cause:** `backend/src/realtime/botGameRunner.js:230` had `const hardCap = Math.max(bestOfN * 2 - 1, 1)`. The `2N − 1` formula is correct for the *other* bestOf convention (where N is the wins required and `2N − 1` is the max games — e.g. "best of 3 wins" = max 5 games). But this codebase uses `bestOfN` to mean **max games** (`winsNeeded = ⌈N/2⌉` a few lines above), so the cap should just be N. For bestOf3 the cap was 5 games instead of 3. Two minimax bots playing optimally always draw → series ran the full 5-draw stretch every time before the deterministic tiebreaker resolved it.

**Fix:** extracted `seriesGameCap(bestOfN) = max(bestOfN, 1)` and used it. Existing tests only covered `bestOfN: 1`, so the broken path was never exercised. Added 4 new unit-test assertions covering bestOf1/3/5 + nullish-fallback. Bot-vs-bot tournaments now run noticeably faster and tournament game counts match the bracket math used by `expectedGameCount` and the runaway-loop guard.

## ✅ Pending PVP match registry per-process race — fixed 2026-05-09

**Symptom:** in a MIXED tournament with two human players paired in a round-1 HvH match, the second human's "Play Match" click could return "Table closed due to inactivity" — surfacing as `useGameSDK setAbandoned({reason:'stale'})` from a 404 on `POST /api/v1/rt/tournaments/matches/:id/table`. Single-machine staging never reproduced; prod intermittently did.

**Root cause:** `_pendingPvpMatches` in `backend/src/lib/tournamentBridge.js` was a per-process in-memory `Map`, populated from a Redis **pub/sub** subscription (not a stream — pub/sub does not replay missed messages). On multi-machine prod, three failure modes diverged the maps:

1. **Autoscale-up** — a new backend machine spawned after `tournament:match:ready` was published never received the event; its map stayed empty.
2. **Rolling deploy** — a redeployed machine lost its in-memory map; existing tournaments lost their entries on the restarted node.
3. **Transient Redis disconnect** — any subscriber gap during the publish missed the event.

`/rt/*` POSTs are routed via Fly-Replay to the SSE-owning machine. If user-1 and user-2's SSE sessions landed on different machines, and user-2's machine didn't have the entry, the claim returned `NOT_FOUND` → 404.

**Fix:** replaced the in-memory `Map` with a Redis hash `tournament:pending:<matchId>` (TTL via `EXPIRE`, no JS-side prune needed). Falls back to in-memory when `REDIS_URL` is unset (tests / local-only). All four operations became async; six caller sites await them. Added 9 unit tests covering get/set/delete/count round-trips, slug-only updates, null-clear-on-disconnect, missing-key no-op, and bestOfN type coercion.

**Verified on 2-machine staging:** pre-fix the same shape caught 2/10 failures during a new-machine warmup window. Post-fix: 25/25 across 25 runs on a fresh 2-machine deploy. The race window structurally closes — there is no per-process state to diverge.

## ✅ Recurring tournaments — template/occurrence schema refactor — shipped (Phase 3.7a)

**Original problem:** a recurring tournament was modelled as a single `Tournament` row with `isRecurring: true` that *also ran as the first occurrence*. The template was both a configuration row *and* a historical record of the first run, and "what recurring series exist?" couldn't be answered without filtering. Admins also conflated "cancel this occurrence" with "stop the whole series."

**What shipped (Phase 3.7a):**

- New `TournamentTemplate` table holds the recurrence config (interval, end date, paused, seed bots, human subscriptions). It never itself runs.
- Every `Tournament` row is now a pure occurrence with `templateId?: string`. The schema removed `isRecurring` / `recurrenceInterval` / `recurrencePaused` from `Tournament`.
- New `TournamentTemplateSeedBot` and `TournamentRecurringRegistration` tables key on `templateId`, not the first occurrence's tournament id.
- Admin surfaces shipped: `landing/src/pages/admin/AdminTemplatesPage.jsx` + `AdminTemplateDetailPage.jsx`. The recurring scheduler in the tournament service was rewritten to advance from the template, not the first row.

**What this entry left behind for the operator UX:** see the open "Tournament admin UX overhaul" entry above. The schema landed cleanly; the operator-facing surfaces around it (schedule preview, embedded seed/registration mgmt, edit-template-vs-occurrence branching, clone, TZ display, …) did not. That work is tracked separately.

## ✅ Tournament bot matches stuck IN_PROGRESS — fixed 2026-05-05

**Original symptom:** every Curriculum Cup on staging stuck `IN_PROGRESS` with `updatedAt === createdAt` and `p1Wins=p2Wins=0`. Bot games actually completed in-memory but the bracket never advanced; journey step 7 never fired; 4 cup-soak e2e suites timed out at 240s.

**Root cause:** `TOURNAMENT_SERVICE_URL` secret on staging was set to `http://xo-tournament-staging.flycast:3001`. `.flycast` is Fly's anycast private DNS, but only resolves when the target app has a private IPv6 IP allocated (`fly ips allocate-v6 --private`). Our deploy doesn't allocate one, so DNS lookups returned `ENOTFOUND`, every cup match completion POST silently failed (errors logged at `warn` then swallowed), and the bracket-advance pipeline never ran. Prod was using `https://xo-tournament-prod.fly.dev` (public hop) so it worked but at extra latency.

**Fix:** flip both backend services to `http://xo-<env>-tournament.internal:3001` (Fly 6PN private DNS — resolves without any IP allocation, same private network as `.flycast` would have provided). Verified: a clean cup against staging now completes in ~1 minute and step 7 credits. Runbook updated (`Prod_Bringup_Runbook.md` §xo-backend-prod) so this doesn't recur.

## ✅ Bot model half-converted state after train-guided — fixed 2026-05-05

**Symptom:** after `POST /api/v1/bots/:id/train-guided/finalize`, the bot ended up with `botModelType: 'minimax'` (unchanged) but `botModelId: <BotSkill UUID>` — half-way between Quick Bot and trained ML bot. Caused journey step-4 e2e tests (`guide-onboarding`, `guide-ui-states`, `journey-train-modal`) to fail asserting `botModelType === 'qlearning'`.

**Root cause:** `mlService.js#repointBotPrimarySkill` (and the duplicate in `skillService.js`) updated `User.botModelId` when training completed but didn't touch `botModelType`. The finalize handler at `bots.js:469` then saw `bot.botModelId === skillId` (already aligned) and skipped the qlearning flip. Verified on staging — DB rows for recent train-guided bots showed exactly this state.

**Fix:** both `repointBotPrimarySkill` functions now read `algorithm` from the BotSkill row and write `botModelType` derived from it (lower-snake-no-underscore: `Q_LEARNING → qlearning`, `MONTE_CARLO → montecarlo`, etc.). Backwards-compatible — no botModelType write when algorithm is null. 7 new unit tests across mlService + skillService.

## ✅ E2E journey suite cross-origin auth — fixed 2026-05-05

**Original symptom:** `e2e/tests/guide-onboarding.spec.js` (and 8 sibling specs) failed immediately on staging/prod with `No token in response — user may not be signed in on this context` from `helpers.js:111`. Test signed up on `xo-landing-*.fly.dev` (cookie on landing origin); `fetchAuthToken` then hit `${BACKEND_URL}/api/token` on `xo-backend-*.fly.dev` — different subdomain → no cookie → 401.

**Fix:** route every test API call through the landing host so the existing `landing/server.js` proxy (`pathFilter: ['/api', '/socket.io']`) carries the cookie + forwards to backend. Replaced `BACKEND_URL` with `LANDING_URL` across all 9 affected specs (88 references). Backend CORS already allows the landing origin via `FRONTEND_URL`; no backend changes needed. The working pattern was already proven in `smoke.journey.spec.js`.

**Files patched:** `journey-cup` · `guide-hook` · `guide-onboarding` · `guide-ui-states` · `guide-curriculum` · `journey-spar` · `journey-train-modal` · `journey-spotlight` · `guide-phase0`.

## ✅ Downstream journey-suite issues (post-cross-origin) — fixed 2026-05-05

After the cross-origin auth fix unblocked the suite, several smaller test/staging issues surfaced and were resolved in the same sprint:

- **`guide-hook` step 1 prefs 4xx** — `GET /api/v1/guide/preferences` 404'd because the BetterAuth → application User row hadn't been mirrored yet. Fix: explicit `POST /users/sync` after `fetchAuthToken`, matching the existing pattern in `guide-onboarding`/`journey-cup`.
- **`guide-hook` step 2 demo-watch credit timing** — same race; same `/users/sync` fix.
- **`guide-hook` private-table assertion** — test asserted demo `Table` rows must NOT appear in default `GET /api/v1/tables` for the creator, but backend's documented behavior is "authed users see their own private tables in default" (see `tables.js:276`). Replaced with the right privacy check: an anonymous viewer must not see the demo.
- **`guide-onboarding` step 4 model-type** — covered above (the `repointBotPrimarySkill` fix).
- **Stale slug regex** — `guide-hook.spec.js:80` and `guide-curriculum.spec.js:113` asserted `/^mt-/` but backend uses `nanoid(8)` (no prefix). Updated to `/^[A-Za-z0-9_-]{8}$/`.
- **Username collisions** — hardcoded display names (`Hook Demo`, `Phase Zero`, `Curr Spar`, etc.) collided on the lower-snake-cased username unique constraint after the first staging run. Added `uniqueName(label)` helpers that suffix a random tag.

After these fixes plus the cross-origin and `repointBotPrimarySkill` work, the full journey suite (25 tests across 9 specs) runs green end-to-end on staging.

## ✅ Real-Time Presence / Inactivity Detection — mostly done

**Status:** The core heartbeat-based presence was built during the Phase E tier-2 comms work. `backend/src/lib/presenceStore.js` tracks `onlineAt` with TTL; `landing/src/lib/useHeartbeat.js` is the client hook; `GET /api/v1/presence/online` + the `presence:changed` SSE channel expose the state.

**What's still open (small refinement, not blocking):** the hide/show behaviour uses default visibility — when a tab backgrounds, the heartbeat stops and the server evicts the user after the TTL. There's no explicit `user:away` transition and no distinction between "tab hidden" (may come back in seconds) and "tab closed" (likely gone for the day). Good enough for the admin "online" indicator in its current form.

## ✅ Multi-Game Architecture — largely done (as the Game SDK)

**Status:** The Game Adapter pattern proposed here was implemented as the `GameSDK` contract in Platform Phases 1.1–1.4. `packages/sdk` defines `GameMeta`, `GameSDK`, and `botInterface`; `@callidity/game-xo` is the reference implementation; `PlatformShell` loads any `GameMeta`-conforming package via `React.lazy`. `roomManager` was retired in Phase 3.4 — `Table` rows + `previewState` + SDK adapters replaced it.

**What's left (tracked in `doc/Platform_Implementation_Plan.md`):**
- **Phase 4** — Connect4 (2p sit-down, validates the abstraction with a second game)
- **Phase 5** — Poker (adds hidden-info via `getPlayerState`, variable player counts)
- **Phase 6** — Pong (adds `tableArchetype: 'head-to-head'` + real-time loop)

The original analysis below remains a useful reference for the per-game rendering strategy (React vs Framer Motion vs Phaser), but the high-level adapter/registry work is done. Leaving below:

---

**What:** Evolve the platform to support additional game types — Connect 4, Checkers, card games, and real-time games like Pong — without rewriting the infrastructure that already works.

**What's already generic:**
The room lifecycle (create/join/disconnect/reconnect/close), socket event envelope (`game:start`, `game:moved`), ELO system, game recording, mountain name rooms, spectator system, and credits (`appId` already on the schema) are all game-agnostic today. They need no changes to support new games.

**What's XO-hardcoded today:**
`board: Array(9).fill(null)`, `makeMove({ cellIndex })`, `getWinner`/`WIN_LINES`/`isBoardFull` called directly inside `roomManager` and `botGameRunner`, `playerMarks: X|O`, and `winLine`. `GameBoard.jsx` (~600 lines) and `gameStore.js` are XO-specific. The AI registry calls `aiImpl.move(board, difficulty, currentTurn)` — an XO-shaped interface.

**The core abstraction: a Game Adapter**

Each game type registers an adapter that owns its rules. The room manager and bot runner stop knowing anything about game logic and delegate to it:

```js
{
  appId: 'connect4',
  initialState()                         // returns a fresh game state
  applyMove(state, move)                 // returns { state, terminal, winner }
  validateMove(state, move, playerMark)  // boolean
  serializeForClient(state)              // what gets emitted over the socket
}
```

`roomManager.makeMove()` currently calls `getWinner(room.board)` directly. With adapters it becomes `adapter.applyMove(room.gameState, move)`. The room carries a `gameType` field and the manager looks up the adapter from a registry — the same pattern as the existing AI registry. On the frontend, `GameBoard.jsx` splits into a generic `GameContainer` (socket connection, room management, scores, forfeit, spectator mode) and a game-specific renderer (`XOBoard`, `Connect4Board`, etc.) that receives standardized state and emits standardized moves.

**The four game types and what each requires:**

- **Connect 4** — most similar to XO. Different board shape (7×6), gravity mechanic (move is a column index, not a cell index), 4-in-a-row win detection. Fits the adapter interface cleanly. Good first target for proving the abstraction.

- **Checkers** — still turn-based and discrete, but move validation is complex (forced captures, multi-jump chains, kinging). The adapter interface handles it — `validateMove` and `applyMove` just do more work. Socket model is unchanged because state is fully visible to both players.

- **Card games** — turn-based discrete moves, but with hidden information (hand cards). The current socket broadcast model breaks here: the server can't emit full state to the room because each player should only see their own hand. The adapter interface needs a `serializeForPlayer(state, playerMark)` method, and the socket layer must emit per-player views (`io.to(socketId).emit()`) instead of broadcasting to the room. This is the meaningful socket architecture change for card games.

- **Pong / real-time** — fundamentally different. No turns, no discrete moves. Needs a `RealtimeGameRunner` with a server-authoritative tick loop (or client-side simulation with the server recording the final result). The existing `BotGameRunner._runGameLoop` async loop is the conceptual ancestor but would need to run at ~60Hz and push continuous state. See also: *Real-Time Games Against Bots* entry above.

**Rendering strategy and Phaser:**

No single renderer fits all game types:

| Game | Renderer |
|------|----------|
| XO | React (existing) |
| Connect 4 | React + CSS transitions |
| Checkers | React + CSS transitions |
| Card games | React + Framer Motion |
| Pong / real-time | Phaser (lazy-loaded) |

**Phaser** is a complete 2D game framework (WebGL/canvas, physics engine, 60Hz game loop, sprite management, input handling). It operates outside React's DOM model — you mount it imperatively in a `useEffect` and tear it down on cleanup. It's the right tool for real-time physics games (Pong) where it saves significant manual work on collision, velocity, and game loop management. It's overkill for turn-based games.

**PixiJS** is a lighter alternative (~400KB vs Phaser's ~1MB+): WebGL rendering without the physics engine. Better fit if a game needs smooth sprite rendering but not physics — certain card game animations, animated boards.

**Critical:** Phaser (or PixiJS) must be a **lazy-loaded, per-game dependency** — not a platform-wide import. A player loading Connect 4 should never download Phaser. The game adapter architecture supports this naturally: each game's renderer is its own bundle chunk, loaded only when that game is selected.

**Recommended evolution path:**

1. **Phase 1 — Extract and prove the adapter (Connect 4):** Move XO logic out of `roomManager` and `botGameRunner` into `XOGameAdapter`. Create the `gameAdapters` registry. Add `Connect4GameAdapter` and `Connect4Board.jsx`. Split `GameBoard.jsx` into `GameContainer` + `XOBoard`. This validates the abstraction without breaking anything.

2. **Phase 2 — Checkers:** Adapter interface unchanged; more complex `validateMove`/`applyMove`. No socket changes.

3. **Phase 3 — Card games:** Add `serializeForPlayer` to the adapter interface. Add per-player socket emission to the socket layer.

4. **Phase 4 — Real-time (Pong):** Separate architecture path. `RealtimeGameRunner`, canvas renderer via Phaser, tick loop. Plan independently once at least one more turn-based game exists.

**Complexity:** Phase 1 is medium (~3–4 days — the adapter extraction plus a working Connect 4). Each subsequent phase builds on it. The real-time phase is large and largely independent.

## ❌ Persist Game State Through Deploys (Redis-backed Rooms) — obsolete

**Status:** Superseded by Phase 3.4 — `roomManager` was retired. Active games are now `Table` rows in Postgres (`previewState Json` + `seats Json`), so game state survives deploys by design. Socket reconnection after a brief drop re-joins the table room via the `TableDetailPage` flow. The scenario this item was guarding against no longer exists.

**Residual concern worth tracking separately:** when a socket drops mid-game, `useGameSDK` needs to rebind the move stream — today there's a short window where a move could be emitted to a disconnected socket. This is a socket-reconnect concern, not a state-persistence one, and is better filed as a gameplay-robustness task if it ever surfaces.

## ❌ Configurable Guide — obsolete (premise gone)

**Status:** This item was written against the old iframe-based `public/getting-started.html` + 9-balloon SVG layout. That page no longer exists — it was retired during the Phase 2 nav restructure and the Phase 3.3 Guide panel rebuild. The Guide is now a React drawer (`landing/src/components/guide/GuidePanel.jsx`) with a journey card, slots grid, and notifications feed. Any future "configurable guide" work would be a fresh design against the new shell, not a continuation of this item. Leaving the original text below for archaeology:

---

**What:** Let users personalize the Getting Started guide through a "Configure Guide" panel in Settings. Three layers of configuration, in increasing complexity:

1. **Arrow toggle** — a switch to show or hide the dashed connector arrows between balloons. Some users find them helpful for understanding the progression; returning users who use the guide as a launcher find them visual noise.

2. **Balloon count** — a slider or stepper (1–9, the current maximum) controlling how many balloon positions are shown. Fewer balloons means a less cluttered guide focused on the actions the user actually uses. Hidden positions render empty — the layout stays fixed so the guide doesn't reflow.

3. **Balloon assignment** — a drag-and-drop configurator where the user picks which function occupies each position. A palette lists all available destinations (Play, Gym, Puzzles, Rankings, Stats, Profile, About, FAQ, Settings, plus the Feedback and Have Fun easter eggs). The user drags a destination from the palette onto a slot in a miniature preview of the guide layout. The resulting assignment is saved and the guide renders accordingly.

4. **Presets** — 3–4 named configurations selectable with a single click, shown at the top of the Configure Guide panel before the manual controls. Selecting a preset populates the arrow toggle, balloon count, and slot assignments all at once; the user can then fine-tune from there. Candidate presets:
   - **Default** — the current fixed layout (all 9 balloons, arrows on, original assignments). Restores the out-of-the-box experience.
   - **Onboarding** — arrows on, all balloons visible, ordered as a learning path (FAQ → Play → Training Guide → Create Bot → Train → Compete).
   - **Launcher** — arrows off, 5–6 balloons showing only the most-used destinations (Play, Gym, Leaderboard, Profile, Puzzles). Optimized for returning users who treat the guide as a quick-action menu.
   - **Minimal** — arrows off, 3 balloons (user-chosen or defaulting to Play, Gym, Profile). Maximum signal, minimum clutter.

**Balloon actions beyond simple navigation:**

Each balloon in the palette would be associated with an *action*, not just a URL. An action is a small descriptor like `{ to: '/profile', open: 'bots' }` or `{ to: '/gym', focus: 'model-name' }`. When the user clicks the balloon, the guide posts the action to the parent via `postMessage`; the parent closes the modal and calls React Router's `navigate(to, { state: action })`. The destination page reads `location.state` on mount and performs the side effect — opening an accordion, scrolling to a section, setting focus on an input, pre-selecting a tab, etc.

This means the palette of available destinations is really a palette of *actions*, each with a label, an emoji, a destination route, and an optional UI side effect. Examples:

- **Play** → `/play` (no side effect)
- **Train a bot** → `/gym` + open the training panel
- **My Bots** → `/profile` + open the My Bots accordion
- **Leaderboard** → `/leaderboard` (no side effect)
- **Create a bot** → `/profile` + open the My Bots accordion + focus the Create New Bot input
- **Puzzles** → `/puzzles` (no side effect)
- **Settings** → `/settings` (no side effect)
- **FAQ** → `/faq` (no side effect)

This approach requires that the destination pages handle incoming `location.state` gracefully — if no state is present, they render normally; if state carries an `open` or `focus` key, they apply it on mount. It also means the current `<a target="_top">` implementation in the guide HTML must be replaced with `onclick` handlers that `postMessage` the action instead, since `<a>` tags can only carry a URL.

**Current guide architecture and the key constraint:**

The guide is a self-contained static HTML file (`/public/getting-started.html`) rendered in an iframe inside `GettingStartedModal`. The parent React app communicates with it via URL params (`?hint=faq`) and `postMessage`. The guide currently has 9 balloon positions at fixed SVG coordinates and 6 dashed arrow paths.

Making the guide configurable means the iframe must receive a config object and render dynamically rather than statically. Two approaches:

- **Pass config via postMessage (lower effort, preserves current architecture):** The parent serializes the user's guide config and sends it to the iframe after load (the guide already fires `getting-started-ready` to signal it's listening). The guide JS reads the config and shows/hides arrows, shows/hides balloon slots, and swaps each slot's emoji, label, and `href`. The drag-and-drop configurator lives entirely in the React Settings page — it never needs to be inside the iframe.

- **Convert guide to a React component (higher effort, cleaner long-term):** Remove the iframe and rewrite the SVG as a React component that reads guide config directly from the prefs store. No postMessage coordination needed. Loses the ability to link to the guide standalone, but makes all three config layers straightforward React state.

The postMessage approach is the right starting point — it extends the existing communication channel without a rewrite.

**Persistence:** Guide config is a small JSON blob (arrow visibility, balloon count, slot assignments) stored as a new field in user preferences — same pattern as `showGuideButton`, persisted via `api.users.updatePreferences` and loaded at sign-in via `api.users.getHints`.

**What it would take:**
- **Schema:** add a `guideConfig` JSON column to the user preferences table. Default: arrows on, all 9 balloons, current fixed assignments.
- **Settings UI:** a "Configure Guide" section below the existing Guide button toggle — arrow switch, balloon count stepper, and a drag-and-drop canvas showing the 9 slot positions with a destination palette beside it.
- **Guide HTML:** replace hardcoded balloon content with a JS renderer that reads config from the `postMessage` payload and builds SVG elements dynamically. Arrow `<path>` elements toggled by CSS class; balloon `<a>` elements generated from the slot assignment array.
- **`GettingStartedModal`:** after the iframe fires `getting-started-ready`, post the saved guide config to it.

**Complexity:** Medium-to-large (~3–4 days total). Arrow toggle alone is small (~2 hours). Balloon count adds half a day. The drag-and-drop configurator UI, the dynamic SVG renderer in the guide HTML, and schema/persistence together account for most of the estimate.
