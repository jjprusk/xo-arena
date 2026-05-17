# Help System — Question Backlog

A running log of questions users have asked (or that we want the Help System to handle well) plus the current state of each.

This file is the authoritative list of "questions I expect the Guide to answer." It pairs with the corpus in `/doc/Help_Corpus/` (the source of truth for answers) and the retrieval/prompt code in `backend/src/services/help/` (the mechanics).

---

## Workflow

**Status per entry:**

| Mark | Meaning |
|---|---|
| `[ ]` | **Pending** — added to the backlog; not yet investigated |
| `[x]` | **Ingested** — Guide answers this well; a short note records the fix (new doc / edited doc / alias / already worked) |
| `[-]` | **Deferred** — depends on out-of-scope work (feature that doesn't exist, future sprint, etc.); a short note records why |

**Adding new questions:** append at the bottom of the list as a `[ ]` line. Keep one question per line. Verbatim phrasing of how a user would actually type it (typos, casing, whatever) — the retrieval pipeline is supposed to handle real-world input, so we test with real-world input.

**Inline hints (optional):** if you have a hunch about what's wrong or where the fix belongs, you can add a `— suggest: ...` clause. I'll use it as a starting point, but I always verify against `um help-ask` first and will push back if the actual gap is different. Examples:

```markdown
- [ ] "How do I cancel a tournament" — suggest: add to tournaments.md
- [ ] "What's ELO" — suggest: probably retrieval, try alias
- [ ] "How do I delete my account"
- [ ] "Why is my bot losing every game" — shape: this is a debug flow not a fact lookup
```

First two: you guide where to start. Third: my judgment. Fourth: a shape hint, no prescribed fix.

**Reply convention (Claude side):** when I check an item off, the note records what I actually did. If my fix doesn't match your suggestion, the note says so — so you can see the divergence at a glance:

```markdown
- [x] "What's ELO" — added alias `ELO → activity tiers`; doc already existed (your suggestion was right)
- [x] "How do I cancel a tournament" — added section to tournament-how-to-enter.md (your suggestion of tournaments.md was close; the registration-specific doc was a better fit)
```

**Processing (Claude side):** work through unchecked items in order. For each:
1. Run `docker compose exec -T backend node --experimental-transform-types --no-warnings src/cli/um.js help-ask "<question>"` against local dev.
2. Classify the gap:
   - **no source** → answer comes back as the rule-1 refusal ("I don't have that in the docs yet…") → write or expand a doc in `/doc/Help_Corpus/`.
   - **wrong source** → retrieval grabbed unrelated chunks → either tune the corpus phrasing or add a `QUERY_ALIASES` entry.
   - **bad synthesis** → source is good, model's answer is poor → rewrite the source intro chunk; this almost always fixes synthesis.
   - **works** → check the box, note "already worked".
3. Apply the fix; restart backend (`docker compose restart backend`) so the seed picks up corpus changes.
4. Re-run the question to verify; check the box with a one-line note.

**Regression sweep:** before each `/stage` (and definitely before `/promote`), re-run every `[x]` entry to confirm prior fixes still hold. If anything regressed, flip back to `[ ]` and triage.

**Out-of-scope items:** if a question depends on something we can't deliver yet (e.g., "how do I export my Gym data" before that feature exists), mark `[-]` with a note like `[- deferred: needs Gym export feature, Sprint N]`.

---

## Backlog

<!-- Append new questions here. One per line. Verbatim phrasing. -->
- [x] "how to I manage my notes" — rewrote the lead of `research-notes-and-journal.md` so chunk 0 leads with **"Profile → Training Journal"** + the Gym session-notes drawer *before* CRUD steps. Bad-synthesis-via-weak-lead, fixed by rephrasing the position-0 chunk in the user's own words ("manage", "my notes", path-first). Verified: answer now leads with the path then walks through Add/Edit/Delete.
- [x] "what is the recipe for training an alpha zero bot" — added `alpha zero → alphazero session recipe simulations temperature episodes` query alias. Corpus already had the full session-recipe table in `algorithm-alphazero.md`; the two-word spelling just wasn't matching. (Your suggestion was a new doc — the existing one was already complete, so an alias was the smaller, safer fix.)
- [x] "take me to page x" — added a new corpus doc `using-the-guide.md` that names the navigation question explicitly: the Guide can tell you *where* a page is but can't navigate for you; use the link in the reply / top nav / URL bar. Verified: answer now reads "I can tell you where to find the page, but I can't navigate there myself…" instead of the off-topic refusal.
- [x] "specific settings for my mc bot" — added `mc → monte carlo` query alias; corpus already had `algorithm-monte-carlo.md`; now surfaces the recommended-settings table.
- [x] "is this system fun to use" — bumped prompt to `help.v3` and added rule 4d (open-ended platform meta). Model now gives a short factual brand reply under 40 words and invites a specific question. We landed on warm-not-witty per design discussion (jokes age badly, hard to keep on-brand). Adversarial fixtures pin: rule 4d works AND jailbreak prefixes (greeting+hate, greeting+sonnet) still refuse via 4a/4b.
- [x] "can i become a game developer" — added new corpus doc `game-sdk.md` covering the Game SDK, who can contribute, and what kinds of games fit; pulls from Feedback button as the entry point.
- [x] "can i play against my friends' bots" — added "Playing against other users' bots (and your friends' bots)" section to `bots-overview.md`; answers "go to the Bot Directory, find their bot, Challenge or Quick Match".
- [x] "can i play against my friends" — added "Can I play against my friends? (Human vs human)" section to `tables-and-spectating.md` (private Table + share link). Cross-link from bots-overview so the bots-route answer also mentions this option.
- [x] "how do i get an account" — rewrote `getting-started.md` intro + added explicit "Creating an account" section with email+password and Google paths; now answers cleanly.
- [x] "how do i get started" — added `get(ting) started → first time new user welcome onboarding tutorial walkthrough quick play guide drawer` query alias + restructured `getting-started.md` pos-0 with stronger anchor phrasing. Was previously hijacked by tournament-how-to-enter; now correctly routes to the 3-step quickstart.
- [x] "what can i do without registering" — added "What can I do without registering (guest mode / no account)" section to `getting-started.md` covering guest-allowed vs. account-required actions.
- [x] "hello" — bumped prompt to `help.v3` and added rule 4c (greetings). Model now replies warmly in one sentence under 25 words and invites a real question. Compound queries like "hi, how do i train a bot" pivot to the real answer (greeting acknowledged then answered). Adversarial fixtures pin both happy-path and jailbreak guards.
- [x] "what is xo arena" — added `xo arena → AI Arena platform overview` query alias; rewrote `getting-started.md` intro to lead with "AI Arena (formerly known as XO Arena)..." so legacy-name queries land on the canonical overview.

### Notes on this batch
- All 8 corpus-style items above answered correctly in `um help-ask` after fixes. Backend tests 149/149 green.
- The two remaining items (`is this system fun to use` and `hello`) are conversational / tonal — they need a prompt-design conversation before becoming changes, since current `help.v2` rule 4b routes "hello" to the off-topic refusal. Flagged for follow-up.
- New query aliases added in this batch: `mc → monte carlo`, `dqn → deep q network`, `rl → reinforcement learning`, `xo arena → AI Arena`, `get(ting) started → first time new user welcome onboarding tutorial`, `where do i begin/start → first time onboarding`, `how do i begin → first time onboarding`.
- New corpus doc: `game-sdk.md`.
- Edited corpus docs: `getting-started.md` (substantial), `bots-overview.md` (added friend-bots section), `tables-and-spectating.md` (added human-vs-human friend section), `faq.md` (added Getting started Q&A section).
- One workflow note: the corpus seeder is additive-only by design, so when iterating on edits in dev I deleted+reseeded via Prisma. Long-term: either a `--force` flag on the seeder or just use the `/admin/help` editor.


