<!-- Copyright © 2026 Joe Pruskowski. All rights reserved. -->
# Recurring Tournaments — Template vs Occurrence Refactor

> **Status:** Scope-only document. Not yet scheduled. Decide *before* prod has real user data whether to do this now (cheap) or later (migration-sensitive).

## Today's model

A recurring tournament is a single `Tournament` row with `isRecurring: true`. That row *also runs as the first occurrence*. When it transitions to `COMPLETED`, the recurring scheduler creates child `Tournament` rows with `isRecurring: false` on the configured interval. The chain continues because `_nextOccurrenceStart` advances from the template's `startTime` and the dedup check prevents re-spawns.

This works, ships, and all the flows we've built (recurring subscriptions, seed bots, unfilled auto-drop, subscriber notifications) operate against this model.

## What's awkward about it

- **Configuration and history collide.** The template is both the editable config and a historical record of the first run's results. Editing the template can have weird side effects on the past run. Changing the start time in particular breaks the dedup chain.

- **"Cancel this occurrence" vs "stop the series" is ambiguous.** The `recurrencePaused` flag added later papers over this but doesn't resolve the semantic mix — admins still have to know which row represents *the series* and which ones represent *runs*.

- **Querying gets contorted.** "What recurring series exist?" means `Tournament.findMany({ where: { isRecurring: true } })`, which excludes paused templates and all historical occurrences. "Show me all runs of the Daily 3-Player series" has no clean query — there's no parent pointer on children; the name+startTime pattern is the only link.

- **Subscribers attach to the first run.** `RecurringTournamentRegistration.templateId` points at the `Tournament` row that *is* the template. If you ever wanted to edit/rename the series, the subscription table ties you to that specific row.

## Proposed cleaner model

Split config from runs.

### New table: `TournamentTemplate`

Holds recurrence config only. Never itself runs.

```
TournamentTemplate {
  id                   String   @id
  name                 String
  description          String?
  game                 String   // gameId
  mode                 String   // PVP / HVB / MIXED / BOT_VS_BOT
  format               String   // SINGLE_ELIM / ROUND_ROBIN / ...
  bracketType          String
  minParticipants      Int
  maxParticipants      Int
  bestOfN              Int
  durationMinutes      Int?
  noticePeriodMinutes  Int?
  botMinGamesPlayed    Int?
  allowNonCompetitiveBots Boolean @default(false)

  // Recurrence
  recurrenceInterval   String   // DAILY / WEEKLY / MONTHLY / CUSTOM
  recurrenceStart      DateTime // first occurrence start
  recurrenceEndDate    DateTime?
  recurrenceRule       Json?    // custom cron-like
  paused               Boolean  @default(false)

  createdById          String
  createdBy            User     @relation(fields: [createdById], references: [id])
  isTest               Boolean  @default(false)

  // Relations
  subscriptions        RecurringTournamentRegistration[]
  seedBots             TournamentTemplateSeedBot[]
  occurrences          Tournament[]

  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
}
```

### Updated: `Tournament`

Every row is a pure occurrence. Recurrence fields move out. New optional `templateId` back-link.

```diff
 Tournament {
   id                     String   @id
   name                   String
-  isRecurring            Boolean  @default(false)
-  recurrenceInterval     String?
-  recurrenceStart        DateTime?
-  recurrenceEndDate      DateTime?
-  recurrenceRule         Json?
-  recurrencePaused       Boolean  @default(false)
+  templateId             String?
+  template               TournamentTemplate? @relation(fields: [templateId], references: [id])
   status                 TournamentStatus
   startTime              DateTime?
   ...
 }
```

### Table moves

- `RecurringTournamentRegistration.templateId` → points at `TournamentTemplate.id` (same name, new FK target).
- New `TournamentTemplateSeedBot` table (mirror of `TournamentSeedBot` but keyed on `templateId`). `TournamentSeedBot` stays for per-occurrence overrides if we ever want them; can also be retired.

## Migration sketch (data that exists today)

Empty prod DB means **migration is trivial right now**. For staging (has test data), the migration is:

1. `CREATE TABLE TournamentTemplate LIKE Tournament` (schema for config fields only).
2. For each existing `Tournament` with `isRecurring: true`:
   a. Insert a `TournamentTemplate` with all config fields.
   b. If the Tournament row has results / participants (i.e. already ran as the first occurrence), keep it as a `Tournament` occurrence and set `templateId` to the newly minted template.
   c. If it hasn't run yet, delete the Tournament row — the scheduler will spawn a fresh occurrence from the template.
3. Move each `RecurringTournamentRegistration.templateId` from old-Tournament-id to new-template-id via the mapping built in step 2.
4. Move each `TournamentSeedBot` attached to a template-Tournament into `TournamentTemplateSeedBot` similarly.
5. Drop the recurrence columns from `Tournament`.

With zero prod data, steps 2b/c/3/4 collapse to "delete templates, create empty TournamentTemplate rows nobody points at yet" — very fast.

## Code that needs to change

| File | Change |
|---|---|
| `tournament/src/lib/recurringScheduler.js` | Reads from `TournamentTemplate` instead of `Tournament where isRecurring=true`. Writes `templateId` on created occurrences. |
| `tournament/src/lib/tournamentSweep.js` | `allParticipantsAreBots` → delete path unchanged, but the "mark series cancelled" logic is gone (it wasn't there today but was coming). |
| `tournament/src/routes/tournaments.js` | Splits: `POST /api/templates` (create recurrence), `POST /api/tournaments` (one-shot). `GET /api/templates` for admin. |
| `backend/src/routes/adminTournaments.js` | Admin UI lists templates separately from tournaments. |
| `landing/src/pages/admin/AdminTournamentsPage.jsx` | Two tabs: Tournaments, Templates. |
| `landing/src/pages/TournamentsPage.jsx` | No change — this page only lists actual occurrences, which is what users want anyway. |
| `backend/src/lib/tournamentBridge.js` | `tournament:recurring:occurrence` case reads `templateId` from the occurrence row instead of the dedup name pattern (cleaner). |

## Estimate

~4–6 hours *if prod is empty when we do it*. ~2 days *after* prod has a meaningful number of recurring templates and subscriptions (because of the migration + staging validation).

## Recommendation

Do the refactor **before prod launches** if we want the clean model long-term. If we're comfortable shipping with today's model and only refactoring when a concrete bug forces it, also fine — nothing user-facing is broken. Status quo choice: ship Connect4 and Multi-Skill Bots first, revisit this after.
