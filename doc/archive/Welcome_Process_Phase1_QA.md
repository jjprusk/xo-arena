---
title: "Welcome Process — Phase 1 QA Walkthrough"
subtitle: "Intelligent Guide v1, Sprint 1 + Sprint 2 (Phase 0 funnel)"
author: "Joe Pruskowski"
date: "2026-04-25"
---

## What this document covers

This is the manual QA script for the work landed across **Sprint 1 (foundation)** and **Sprint 2 (Phase 0 — visitor → registered user funnel)** of the Intelligent Guide v1 effort. It exercises the entire welcome flow end-to-end: a true-guest visitor lands on the homepage, watches the demo, plays a guest game, signs up via the contextual CTA, lands in Curriculum step 3 with Hook progress pre-credited, and you verify the resulting state on the server with the `um` CLI.

Companion docs:

- **What** — `Intelligent_Guide_Requirements.md` (the spec)
- **How / when** — `Intelligent_Guide_Implementation_Plan.md` (sprints + checklists)
- **QA (this doc)** — concrete steps to confirm the Phase 0 + journey wiring works on local dev

---

## Stage 0 — Prereqs

1. Docker stack running — `docker compose ps` should show `backend`, `landing`, `tournament`, `postgres`, and `redis` all healthy.
2. Open http://localhost:5174/ in a **private / incognito window** so you start as a true guest. (Existing localStorage from a prior session will skew the test.)
3. A terminal handy to run `um` commands.

---

## Stage A — Guest experience (no signup yet)

### A1. Landing page hero

Land on `/`. You should see:

- A live tic-tac-toe board playing itself in the hero, with player labels like *Rusty Hinge* vs *Copper Coil* and a status line reading *"X thinking…"* / *"Copper Coil wins"*.
- Three CTAs underneath, in this order:
  - `↻ Watch another match` (tertiary)
  - `Play against a bot` (secondary, links to `/play?action=vs-community-bot`)
  - `Build your own bot →` (primary)
- A line below the CTAs: *"Free account, no credit card. Your bot competes in tournaments against bots built by other players."*

### A2. Demo arena re-roll

Click `Watch another match`. The demo board resets and starts a fresh match, possibly with a different pairing from the curated allowlist (Copper Coil / Sterling Knight / Rusty Hinge / Patina / Verdigris / Polished Argent / Moonlit Blade).

### A3. Confirm guest-mode is empty

Open DevTools → Application → Local Storage → http://localhost:5174.

Confirm `guideGuestJourney` is **absent**. If you see it, you're not actually a guest — clear all site data and reload before continuing.

### A4. Hook step 1 — play a PvAI game

Click `Play against a bot`. You'll be on `/play?action=vs-community-bot` against the community bot.

Lose, win, or draw — just finish a full game until you see "You win" / "Opponent wins" / "Draw".

Refresh DevTools' localStorage view. You should see:

```json
guideGuestJourney = {"hookStep1CompletedAt":"2026-04-25T..."}
```

Play another game and refresh again — the timestamp **stays the same**. The `recordGuestHookStep1()` helper is idempotent.

### A5. Hook step 2 — watch the demo for 2 minutes

> This is the slow one. If you're impatient, skip to Stage B and watch only step 1 get credited; or paste a fake `hookStep2CompletedAt` into localStorage by hand to simulate.

Go back to `/`. Leave the DemoArena visible for a real **2 minutes** (set a timer). After the threshold passes, localStorage should gain:

```json
{
  "hookStep1CompletedAt": "2026-04-25T...",
  "hookStep2CompletedAt": "2026-04-25T..."
}
```

Step 2 is also idempotent — leaving the demo running longer doesn't bump the timestamp.

---

## Stage B — Signup (the conversion moment)

### B1. Open the build-bot signup variant

Click `Build your own bot →`. The signup modal opens with the **build-bot copy variant**:

- Heading: **"Build your first bot"** (not the generic *"Create your account"*).
- Sub-line: *"Free account. Your bot competes in tournaments against bots built by other players."*

This contextual variant fires only when the modal is opened from the homepage Build-your-own-bot CTA. The plain `Sign in` button up in the nav opens the *same* modal but with the generic title.

### B2. Fill the form and submit

Fill the form:

- **Display name:** anything (`QA Phase Zero` is a good marker so you can find the row later)
- **Email:** a fresh one — `qa-$(date +%s)@dev.local` works well
- **Password:** ≥ 8 characters
- **Confirm password:** same

> **Wait at least 3 seconds** between opening the modal and clicking submit. The form has an anti-bot guard that rejects sub-3-second submissions with *"Please wait a moment before submitting."*

Click `Create account`.

### B3. Confirm what happens on success

You should see:

1. **Modal closes immediately.** No "Check your email" wall — that's the deferred-verification change.
2. **A soft amber banner** appears across the top of the app: *"Verify your email to enter tournaments. Most of the platform works without it."* with a `Resend` link and `✕`.
3. **DevTools localStorage:** `guideGuestJourney` is **gone** (cleared after the guest-credit POST succeeded).

### B4. Banner dismissal behaviour

Click the `✕` on the banner. It dismisses for the session (sessionStorage flag). Refresh the page — the banner stays dismissed. Open a new tab — the banner is back. **Per-tab dismissal**, intentional.

---

## Stage C — Verify server state with `um`

Open a terminal at the repo root.

### C1. The list view

```sh
um list | head -20
```

Find your new account in the list. You should see clean output (no `[INFO] db query` log spam after the table — that was fixed in the most recent `um` cleanup).

The `JOURNEY` column shows:

- `H 2/7` if you got both Hook steps via the demo + PvAI flow
- `H 1/7` if you only played the PvAI game and skipped the 2-minute watch
- `H 0/7` if neither (e.g. you signed up directly without the funnel)

The format is `<phase> <completed>/<total>` plus a `D` suffix if the user dismissed the journey panel. Phase tags: `H` = Hook, `C` = Curriculum, `S` = Specialize.

### C2. The rich journey view

```sh
um journey <your-username>
```

You'll see a single rich line like:

```
"username"  [●●○○○○○]  1100000  (2/7)  [hook]  next: Watch a bot match  active
```

The orbs `●●○○○○○` mirror the binary string `1100000`: filled = step done, hollow = pending. The `next:` text changes based on which step is the next-uncompleted one.

### C3. The Sprint 1 journey shortcuts

These are admin-only fast-forwards built in Sprint 1 — useful for testing later phases without playing through every step manually.

```sh
um journey <user> --phase curriculum    # mark Hook (steps 1-2) done; lands at step 3
um journey <user> --phase specialize    # all 7 steps done, phase = specialize
um journey <user> --graduate            # alias for --phase specialize
um journey <user> --reset               # clears everything (back to phase=hook, 0/7)
```

After each command, re-run `um journey <user>` to confirm the state changed. `um list` will reflect the new phase tag (`C`, `S`, etc.) in the JOURNEY column.

### C4. Cleanup

When you're done QA'ing, reset your test account so it doesn't show up as graduated in metrics:

```sh
um journey <your-username> --reset
```

Or delete the test account entirely:

```sh
um delete <your-username>
```

---

## Stage D — Tournament gate (proves email-verify is real)

This stage proves the email-verification gate isn't just a banner — the server actually blocks tournament entry until the address is verified.

### D1. Try to enter a tournament unverified

While still signed in (and the verify banner still showing), navigate to `/tournaments`. Pick any tournament in the open registration phase and click `Register`.

The backend should respond `403 EMAIL_VERIFICATION_REQUIRED`. The UI surfaces this as a toast or inline error referring you to verify.

### D2. Verify the email and retry

Click `Resend` in the verify banner. Find the verification link in the resulting email — in dev, fish it out of the `backend` container logs:

```sh
docker compose logs backend --tail 200 | grep -i 'verif'
```

Click the link. Refresh the app. The verify banner disappears (because `user.emailVerified` flipped to `true`), and tournament registration now succeeds.

---

## Stage E — Optional: the Playwright E2E

If you want the deterministic, scripted version of stages A–B + part of C:

```sh
cd e2e
npx playwright test guide-phase0 --project=chromium
```

Four tests cover:

1. Hero CTAs render for guests (DemoArena + 3 buttons).
2. Build-bot copy variant on the modal.
3. Signup completes without the verify-email wall, and the soft banner appears.
4. Pre-seeded localStorage gets credited to the new account on signup (skipping the 2-minute watch).

These run against your local docker stack — same environment as the manual flow.

---

## Known gaps (deferred to later sprints)

A few things you'll *not* see in Phase 1, by design:

- **No Demo Table macro yet.** The hero arena is a self-contained client-side demo with inline minimax, not a server-driven Demo Table. The full §5.1 macro lands in Sprint 3.
- **No Quick Bot wizard.** The `Build your own bot →` CTA today opens the signup modal; once signed in, the user manually goes to `/gym`. The 3-step Quick Bot wizard ships in Sprint 3.
- **No JourneyCard rewrite.** The post-signup Curriculum view still uses the legacy guide panel. The phase-aware hero+checklist `JourneyCard` ships in Sprint 3.
- **No Curriculum Cup, Spar, or Coaching card.** All Sprint 4. After Phase 0 the user lands at Curriculum step 3 but can't yet complete steps 5/6/7 through the polished UX (only via raw bot creation + tournament entry).
- **No Specialize phase.** All Sprint 7+ (post 30-day observation window).

---

## What "good" looks like

If you can complete Stages A–C end-to-end on a fresh guest session in under ~5 minutes (excluding the optional 2-minute watch in A5), and `um journey <new-user>` shows the expected steps credited and phase tag, **Phase 1 (Sprint 1 + Sprint 2) is working as intended**.

If anything in Stages A or B doesn't match this doc, note the deviation and check the implementation-plan checklist (`doc/Intelligent_Guide_Implementation_Plan.md` §9) for whether the relevant deliverable is marked done.
