# AI Arena — Tournament System Design & Implementation Plan

## Overview

This document covers the architecture, technical design, and phased implementation plan for the AI Arena tournament system. It is intended as the engineering companion to the Tournament Requirements document and assumes familiarity with that document.

The tournament system is the first feature built at the platform level — above any individual game — and establishes the service-oriented architecture that will support future games and platform-level features.

---

## Phased Release Plan

Each phase delivers a working, deployable slice of the system. The architecture is designed upfront to support the full requirements; phases add features on top of a solid foundation without requiring rework.

| Phase | Scope |
|-------|-------|
| 0 | Shared database infrastructure — migrate Prisma schema to `packages/db` |
| 1 | Planned tournaments, PVP mode, single elimination, core engine, basic notifications |
| 2 | Player classification system — tiers, merits, promotion, demotion |
| 3 | BOT_VS_BOT mode, bot eligibility validation, server-side match execution |
| 4 | Open tournaments, Flash tournaments, round robin bracket, recurring tournaments |
| 5 | MIXED mode, full notification preferences, replay retention, full admin configurability |

Phase 0 is a prerequisite infrastructure step with no user-facing changes. It must be completed and verified in production before Phase 1 begins. Classification (Phase 2) is deliberately placed before bots (Phase 3) so that merit tracking and tier assignment are in place before any rated tournament play occurs. Retroactive merit assignment is avoided entirely.

---

## Architecture Overview

### Guiding Principles

- The tournament system is a **separate backend service** within the existing monorepo, deployed independently on Railway.
- Services communicate via **Redis pub/sub** — no direct service-to-service API calls for real-time events.
- **PostgreSQL is shared** across all services — data consistency is maintained at the database level, not through inter-service APIs.
- The **Socket.io server remains in the backend service** for Phase 1–5. Extraction into a dedicated socket service is planned for when a second game requiring real-time delivery is added (see Futures).
- All services share the **same BetterAuth instance** — one session, one user record, one token across the platform.

### Service Map

```
Client (Browser)
├── aiarena.callidity.com      (Landing / Platform Hub)
└── xo-arena.callidity.com     (XO Arena Game)
         │                              │
         │ HTTPS + WebSocket            │ HTTPS + WebSocket
         ▼                              ▼
┌────────────────────┐     ┌───────────────────────┐
│ Tournament Service │     │    Backend Service     │
│ (Railway)          │     │    (Railway)           │
│                    │     │                        │
│ • REST API         │     │ • REST API             │
│ • Tournament logic │     │ • Game logic (XO)      │
│ • Bot scheduler    │     │ • Socket.io server     │
│ • Merit/class.     │     │ • Auth middleware       │
│ • Notifications    │     │ • Activity service     │
└─────────┬──────────┘     └───────────┬────────────┘
          │  publish                   │  subscribe +
          │  events                    │  forward to clients
          └────────────┐  ┌────────────┘
                       ▼  ▼
               ┌───────────────┐
               │     Redis     │
               │   (Railway)   │
               │               │
               │ • Pub/Sub bus │
               │ • Job queue   │
               │ • Activity    │
               │   cache       │
               └───────┬───────┘
                       │
                       ▼
               ┌───────────────┐
               │  PostgreSQL   │
               │  (Railway)    │
               │               │
               │ • Shared DB   │
               │ • All schemas │
               └───────────────┘

Monorepo (packages/)
├── ai/        ← shared ML inference (backend + tournament)
├── auth/      ← shared auth utilities
└── types/     ← shared TypeScript types (future)
```

### Inter-Service Communication

The tournament service and backend service never call each other directly. All real-time communication flows through Redis pub/sub:

1. Tournament service publishes an event to a named Redis channel (e.g., `tournament:events`)
2. Backend service subscribes to that channel and receives the event
3. Backend service forwards the event to the appropriate connected clients via Socket.io

This pattern is invisible to the client — it maintains a single WebSocket connection to the backend service, unaware that events may originate in the tournament service. As new game services are added, they follow the same pattern: publish to Redis, backend delivers to clients.

### Monorepo Structure

The tournament system adds one new workspace to the existing monorepo:

```
xo-arena/
├── frontend/          ← XO Arena game frontend (existing)
├── backend/           ← XO Arena game backend (existing)
├── landing/           ← Platform hub frontend (new)
├── packages/
│   ├── ai/            ← Shared ML inference (existing)
│   ├── tournament/    ← Tournament service (new)
│   └── auth/          ← Shared auth utilities (future)
├── e2e/               ← End-to-end tests (existing)
└── package.json       ← Monorepo root
```

---

## Landing Page

The landing page (`aiarena.callidity.com`) is the front door to the entire AI Arena platform. It is built as a new `landing/` workspace using the same React + Vite + Tailwind stack as the XO Arena frontend.

### Page Structure

```
aiarena.callidity.com/
├── /                  ← Platform home (featured tournaments, news, highlights)
├── /tournaments       ← Tournament hub (browse, register, watch, results)
├── /rankings          ← Cross-game leaderboards
├── /replays           ← Game replay browser
├── /games             ← Directory of available games
└── /profile           ← Platform-level player profile
```

### Authentication

The landing page shares the same BetterAuth instance as all game sites. Users sign in once and are authenticated across the entire platform. Guest users may view tournaments, rankings, and replays without an account. Registration is required to enter tournaments or play games.

### Player Profile Hierarchy

| Level | URL | Content |
|---------------|-------------------------------|------------------------------------------------------|
| Platform | aiarena.callidity.com/profile | Cross-game overview, tournament classification, credits, links to game profiles |
| Game-specific | xo-arena.callidity.com/profile | XO ELO, XO stats, XO bots, XO game history |

### Rankings

The `/rankings` page provides two views:

- **Overall** — cross-game leaderboard ranked by tournament classification tier (primary), activity score (secondary), combined ELO (tertiary)
- **By game** — per-game leaderboard with a game selector; mirrors the leaderboard on each game site

---

## Bot Match Execution

### Job Queue

Bot vs Bot matches are executed asynchronously via a Redis list-based job queue. When a match is scheduled, the tournament service pushes a job onto the queue. A background worker within the tournament service pulls jobs and executes them, keeping the main request/response cycle unblocked.

### Concurrency Control

Two levels of concurrency control govern bot match execution:

| Level | Controlled by | Description |
|-------|--------------|-------------|
| Global concurrency limit | Platform admin | Maximum simultaneous bot matches across all tournaments |
| Per-tournament pace | Tournament organizer | Rate of match execution within a single tournament |

Both values are database-driven and admin-configurable.

### Restart Resilience

Bot match execution is resilient to tournament service restarts through two complementary mechanisms:

1. **Durable jobs** — match jobs are not removed from the Redis queue until the worker explicitly acknowledges completion. A mid-match restart leaves the job on the queue; the next worker instance picks it up automatically.

2. **Startup reconciliation** — on service startup, the tournament service queries PostgreSQL for any matches in `IN_PROGRESS` state with no corresponding active job and re-queues them. This handles edge cases where the Redis queue and database state diverged.

---

## Futures

The following items are explicitly deferred but should be revisited as the platform grows.

### Dedicated Socket Service

As the platform adds more games, all real-time event delivery is currently funnelled through the backend service's Socket.io server. When a second game requiring real-time delivery is added, the Socket.io server should be extracted into its own independently deployable service. The Redis pub/sub architecture already in place supports this extraction with minimal rework — all services already publish to Redis; only the subscriber changes.

```
Tournament Service  ─┐
Backend (XO)        ─┤─► Redis ─► Socket Service ─► Client
Future Game         ─┘
```

### Socket Instrumentation & Monitoring

Before or alongside the socket service extraction, the instrumentation plan documented in `Socket_Instrumentation_Plan.md` must be implemented — listener leak detection, connection counts, memory monitoring, and the admin health endpoint. This is critical to prevent resource exhaustion and crashes as the number of connected clients and services grows.

---

## Database Schema

The tournament system's full schema target is documented here. It will be delivered in phases — each phase applies a Prisma migration that adds only the tables and columns it needs. The complete schema below is the end-state across all five phases; phase annotations mark which migration introduces each group.

The schema lives in `packages/db/prisma/schema.prisma` — a shared workspace owned by neither the backend nor the tournament service, serving as the single migration authority for the shared PostgreSQL database.

### Enums

```prisma
// Phase 1
enum TournamentMode {
  PVP
  BOT_VS_BOT
  MIXED
}

enum TournamentFormat {
  OPEN
  PLANNED
  FLASH
}

enum BracketType {
  SINGLE_ELIM
  ROUND_ROBIN
}

enum TournamentStatus {
  DRAFT
  REGISTRATION_OPEN
  REGISTRATION_CLOSED
  IN_PROGRESS
  COMPLETED
  CANCELLED
}

enum ParticipantStatus {
  REGISTERED
  ACTIVE
  ELIMINATED
  WITHDRAWN
}

enum MatchStatus {
  PENDING
  IN_PROGRESS
  COMPLETED
  CANCELLED
}

enum RoundStatus {
  PENDING
  IN_PROGRESS
  COMPLETED
}

enum ResultNotifPref {
  AS_PLAYED
  END_OF_TOURNAMENT
}

// Phase 2
enum ClassificationTier {
  RECRUIT
  CONTENDER
  VETERAN
  ELITE
  CHAMPION
  LEGEND
}

// Phase 4
enum RegistrationMode {
  SINGLE
  RECURRING
}

enum RecurrenceInterval {
  DAILY
  WEEKLY
  MONTHLY
  CUSTOM
}
```

### Phase 1 — Tournament Core

```prisma
model Tournament {
  id                    String              @id @default(cuid())
  name                  String
  description           String?
  game                  String              // e.g. "xo", "connect4"
  mode                  TournamentMode
  format                TournamentFormat
  bracketType           BracketType
  status                TournamentStatus    @default(DRAFT)
  minParticipants       Int                 @default(2)
  maxParticipants       Int?
  bestOfN               Int                 @default(3)
  botMinGamesPlayed     Int?
  allowSpectators       Boolean             @default(true)
  replayRetentionDays   Int                 @default(30)
  startTime             DateTime?
  endTime               DateTime?
  registrationOpenAt    DateTime?
  registrationCloseAt   DateTime?
  noticePeriodMinutes   Int?
  durationMinutes       Int?
  isRecurring           Boolean             @default(false)
  recurrenceInterval    RecurrenceInterval?
  recurrenceEndDate     DateTime?
  autoOptOutAfterMissed Int?
  createdById           String
  createdAt             DateTime            @default(now())
  updatedAt             DateTime            @updatedAt

  participants          TournamentParticipant[]
  rounds                TournamentRound[]
  games                 Game[]

  @@index([status])
  @@index([game])
  @@index([createdById])
  @@map("tournaments")
}

model TournamentParticipant {
  id                String           @id @default(cuid())
  tournamentId      String
  userId            String
  seedPosition      Int?
  eloAtRegistration Float?
  status            ParticipantStatus @default(REGISTERED)
  resultNotifPref   ResultNotifPref   @default(AS_PLAYED)
  finalPosition     Int?
  finalPositionPct  Float?           // 0.0 = first, 1.0 = last; used for Finish Ratio (Phase 2)
  registeredAt      DateTime         @default(now())

  tournament        Tournament       @relation(fields: [tournamentId], references: [id], onDelete: Cascade)
  user              User             @relation(fields: [userId], references: [id])

  @@unique([tournamentId, userId])
  @@index([tournamentId])
  @@index([userId])
  @@map("tournament_participants")
}

model TournamentRound {
  id           String      @id @default(cuid())
  tournamentId String
  roundNumber  Int
  status       RoundStatus @default(PENDING)
  createdAt    DateTime    @default(now())

  tournament   Tournament      @relation(fields: [tournamentId], references: [id], onDelete: Cascade)
  matches      TournamentMatch[]

  @@unique([tournamentId, roundNumber])
  @@index([tournamentId])
  @@map("tournament_rounds")
}

model TournamentMatch {
  id              String      @id @default(cuid())
  tournamentId    String
  roundId         String
  participant1Id  String?     // null = BYE
  participant2Id  String?     // null = BYE
  winnerId        String?
  status          MatchStatus @default(PENDING)
  drawResolution  String?     // "WINS" | "ELO" | "RANDOM" — which cascade step resolved a draw
  p1Wins          Int         @default(0)
  p2Wins          Int         @default(0)
  drawGames       Int         @default(0)
  completedAt     DateTime?
  createdAt       DateTime    @default(now())

  round           TournamentRound @relation(fields: [roundId], references: [id], onDelete: Cascade)
  games           Game[]

  @@index([tournamentId])
  @@index([roundId])
  @@map("tournament_matches")
}
```

**Modifications to existing tables — Phase 1:**

```prisma
// Game — add nullable tournament linkage
model Game {
  // ... existing fields ...
  tournamentId      String?
  tournamentMatchId String?

  tournament        Tournament?      @relation(fields: [tournamentId], references: [id])
  tournamentMatch   TournamentMatch? @relation(fields: [tournamentMatchId], references: [id])

  // add index
  @@index([tournamentId])
}

// User — add back-relation (no new column)
model User {
  // ... existing fields ...
  tournamentParticipations TournamentParticipant[]
}
```

### Phase 2 — Player Classification

```prisma
model PlayerClassification {
  id        String             @id @default(cuid())
  userId    String             @unique
  tier      ClassificationTier @default(RECRUIT)
  merits    Int                @default(0)
  createdAt DateTime           @default(now())
  updatedAt DateTime           @updatedAt

  user      User                   @relation(fields: [userId], references: [id], onDelete: Cascade)
  meritTx   MeritTransaction[]
  history   ClassificationHistory[]

  @@map("player_classifications")
}

model MeritTransaction {
  id               String   @id @default(cuid())
  classificationId String
  tournamentId     String?
  delta            Int      // positive = earned; negative = reset on promotion
  reason           String   // "finish_1st" | "best_overall_bonus" | "promotion_reset" | "demotion_reset"
  createdAt        DateTime @default(now())

  classification   PlayerClassification @relation(fields: [classificationId], references: [id], onDelete: Cascade)

  @@index([classificationId])
  @@index([tournamentId])
  @@map("merit_transactions")
}

model ClassificationHistory {
  id               String              @id @default(cuid())
  classificationId String
  fromTier         ClassificationTier?
  toTier           ClassificationTier
  reason           String              // "initial" | "promotion" | "demotion"
  tournamentId     String?
  createdAt        DateTime            @default(now())

  classification   PlayerClassification @relation(fields: [classificationId], references: [id], onDelete: Cascade)

  @@index([classificationId])
  @@map("classification_history")
}

// Merit award table — seeded with requirement defaults, admin-configurable
model MeritThreshold {
  id        String @id @default(cuid())
  bandMin   Int    // minimum players-in-tier count for this row (3, 10, 20, 50)
  bandMax   Int?   // null = no upper bound
  pos1      Int    // merits for 1st place
  pos2      Int    // merits for 2nd place
  pos3      Int    // merits for 3rd place
  pos4      Int    // merits for 4th place

  @@map("merit_thresholds")
}

// Classification tier thresholds and demotion parameters — admin-configurable
// Uses existing SystemConfig key-value store with the following keys:
//   classification.tiers.<tier>.meritsRequired  (e.g. 4, 6, 10, 18, 25)
//   classification.demotion.finishRatioThreshold (default 0.70)
//   classification.demotion.minQualifyingMatches
//   classification.demotion.reviewCadenceDays
//   classification.bestOverallBonus.minParticipants (default 10)
```

**Modifications to existing tables — Phase 2:**

```prisma
// User — add back-relation (no new column)
model User {
  // ... existing fields ...
  classification PlayerClassification?
}
```

### Phase 3 — BOT_VS_BOT Mode

No new tables. Phase 3 enables tournaments with `mode = BOT_VS_BOT` using the schema already in place from Phase 1. All bot match execution is handled at the service layer:

- **Job queue** — the tournament service pushes a match job onto a Redis list when a `TournamentMatch` transitions to `IN_PROGRESS`. The worker pulls jobs and runs the match server-side, then writes results back to `TournamentMatch` and `Game` (with `tournamentId` and `tournamentMatchId` set).
- **Concurrency** — the global concurrency limit and per-tournament pace are stored in `SystemConfig`:
  - `tournament.botMatch.globalConcurrencyLimit` (default: admin-set)
  - `tournament.botMatch.defaultPaceMs` (default delay between job dispatches within a tournament)
- **Bot eligibility** — enforced at registration time by reading `botActive`, `botAvailable`, `botProvisional`, and `botGamesPlayed` from the existing `User` record. No new columns needed.
- **Restart resilience** — on service startup, the tournament service queries for any `TournamentMatch` rows in `IN_PROGRESS` status with no active worker and re-queues them.

```
SystemConfig keys added in Phase 3:
  tournament.botMatch.globalConcurrencyLimit
  tournament.botMatch.defaultPaceMs
```

---

### Phase 4 — Recurring Tournament Registrations

```prisma
// Tracks participants who have opted into all future occurrences of a recurring tournament
model RecurringTournamentRegistration {
  id           String    @id @default(cuid())
  templateId   String    // FK to the parent Tournament (isRecurring=true)
  userId       String
  missedCount  Int       @default(0)
  optedOutAt   DateTime?
  createdAt    DateTime  @default(now())

  @@unique([templateId, userId])
  @@index([templateId])
  @@index([userId])
  @@map("recurring_tournament_registrations")
}
```

**Modifications to existing tables — Phase 4:**

```prisma
// TournamentParticipant — add registration mode column
model TournamentParticipant {
  // ... existing fields ...
  registrationMode RegistrationMode @default(SINGLE)
}
```

### Phase 5 — MIXED Mode, Notification Preferences, Replay Retention

No new tables. Phase 5 activates `mode = MIXED` tournaments and fills in the remaining configurable surfaces using existing schema.

**MIXED mode execution:** When a human plays a bot in a MIXED tournament, the match runs client-side (bot inference in the browser). This decision is made because:
- It reuses the existing client-side bot inference path already in place for free play.
- It avoids server-side compute for matches that already have a connected human client.
- All game results are recorded identically to BOT_VS_BOT — `Game` rows with `tournamentId` and `tournamentMatchId` set.

Server-side execution for MIXED matches is deferred — it will be reconsidered if client-side latency or bot model size makes browser inference impractical.

**Notification preferences:** The `resultNotifPref` column already exists on `TournamentParticipant` (added in Phase 1, defaulting to `AS_PLAYED`). Phase 5 wires the delivery logic:
- `AS_PLAYED` — the tournament service publishes a match result event to Redis immediately on completion; the backend delivers it via Socket.io.
- `END_OF_TOURNAMENT` — result events are queued internally and flushed as a batch when the tournament reaches `COMPLETED` status.

A user-level default preference is stored in `SystemConfig` per user using the existing key-value store, or as a `preferences` JSON field on the `User` record (to be decided during Phase 5 implementation).

**Replay retention:** `replayRetentionDays` is already on the `Tournament` model. Phase 5 adds the background job that archives or removes `Game` and `Move` records for completed tournaments after the retention window expires. No schema changes required.

```
SystemConfig keys added in Phase 5:
  tournament.replay.defaultRetentionDays   (platform default, overridden per tournament)
```

---

## Implementation Checklist

Check items off as each phase is built and shipped. Tests are an implicit part of every item — no item is complete without passing test coverage.

### Phase 0 — Shared Database Infrastructure

This phase has no user-facing changes and no new tournament tables. Its sole purpose is to move the Prisma schema out of `backend/` into a shared `packages/db` workspace so that the tournament service (Phase 1) can import the same generated client without duplicating the schema. It ships as a standalone PR, verified end-to-end in staging and production before Phase 1 begins.

**Workspace setup**
- [ ] Create `packages/db/` workspace — `package.json`, `prisma/schema.prisma`, `src/index.js` (re-exports PrismaClient)
- [ ] Copy `backend/prisma/schema.prisma` into `packages/db/prisma/schema.prisma` (content unchanged)
- [ ] Copy existing migration history (`backend/prisma/migrations/`) into `packages/db/prisma/migrations/`
- [ ] Update root `package.json` to include `packages/db` as a workspace
- [ ] Add `packages/db` as a dependency in `backend/package.json` and verify Prisma client generates correctly

**Backend wiring**
- [ ] Update `backend/src/lib/db.js` to import PrismaClient from `packages/db` instead of the local generated path
- [ ] Update all other backend files that import from `../generated/prisma` to use the shared package
- [ ] Remove `backend/prisma/` directory (schema, migrations, and generated client now live in `packages/db`)
- [ ] Update `backend/package.json` scripts — `prisma migrate deploy`, `prisma generate`, `prisma studio` — to run from `packages/db`

**Railway / deployment**
- [ ] Update backend `Dockerfile` — `prisma migrate deploy` command now points to `packages/db`
- [ ] Confirm Railway staging deploy runs migrations successfully from the new path
- [ ] Confirm backend service starts and all existing API endpoints and tests pass against the migrated schema

**Verification**
- [ ] All existing backend tests pass unchanged
- [ ] `prisma migrate deploy` runs cleanly from `packages/db` in CI
- [ ] Staging smoke tests pass
- [ ] Production deploy confirmed stable before Phase 1 begins

---

### Phase 1 — Planned Tournaments, PVP, Single Elimination

**Infrastructure**
- [ ] Apply Phase 1 migration from `packages/db` (Tournament, TournamentParticipant, TournamentRound, TournamentMatch, Game FK additions)
- [ ] Scaffold `packages/tournament` service (Express, Prisma client from `packages/db`, Redis client, BetterAuth middleware)
- [ ] Deploy tournament service to Railway (staging, then production)
- [ ] Wire Redis pub/sub: tournament service publishes → backend service subscribes and forwards via Socket.io

**Tournament Management**
- [ ] Create tournament (PLANNED format, PVP mode, SINGLE_ELIM bracket)
- [ ] Publish tournament (DRAFT → REGISTRATION_OPEN)
- [ ] Registration open/close window enforcement
- [ ] Participant registration and withdrawal
- [ ] Minimum participant check — auto-cancel if not met at start time
- [ ] Bracket seeding by ELO at registration close
- [ ] Single elimination bracket generation (rounds + matches)
- [ ] BYE handling for non-power-of-2 fields

**Match Execution**
- [ ] Match lifecycle: PENDING → IN_PROGRESS → COMPLETED
- [ ] Series win tracking (p1Wins, p2Wins, drawGames)
- [ ] Draw resolution cascade for single elimination (total wins → ELO → random), all steps logged
- [ ] Advance winner, eliminate loser
- [ ] Tournament completion — final standings recorded
- [ ] Game rows linked to tournament via `tournamentId` and `tournamentMatchId`
- [ ] Confirm ELO is NOT updated for tournament games

**Notifications (basic)**
- [ ] Planned tournament starts in 1 hour — notify registered participants (in-app)
- [ ] Planned tournament starts in 15 min — notify registered participants (real-time)
- [ ] Match ready — notify participant (real-time)
- [ ] Match result — notify participant (real-time + persistent)
- [ ] Tournament completed — notify all participants (in-app)

**Admin**
- [ ] Create / edit / cancel tournament (tournament role or admin)
- [ ] View tournament bracket and match status
- [ ] `tournament.admin` role enforcement on all management endpoints

**Tests**
- [ ] Bracket generation — seeding, round structure, BYE placement
- [ ] Draw resolution cascade — all three steps, audit log entries
- [ ] Series completion — correct winner advancement
- [ ] Auto-cancel on minimum participant not met
- [ ] ELO not modified for tournament game records
- [ ] Registration open/close window enforcement
- [ ] Role-based access control on management endpoints

---

### Phase 2 — Player Classification

**Infrastructure**
- [ ] Apply Phase 2 migration (PlayerClassification, MeritTransaction, ClassificationHistory, MeritThreshold)
- [ ] Seed MeritThreshold table with default values (3–9, 10–19, 20–49, 50+)
- [ ] Seed SystemConfig with default classification thresholds and demotion parameters

**Classification**
- [ ] Create PlayerClassification record on first tournament registration (RECRUIT, 0 merits)
- [ ] Create PlayerClassification for bots independently from their owner's record

**Merit Awards**
- [ ] Calculate tier-peer count (players of same tier in same tournament) at tournament end
- [ ] Look up correct MeritThreshold band and award merits by finish position
- [ ] Handle ties at same finish position — shared merit award
- [ ] Best Overall bonus — award 1 merit to top finisher across all tiers (minimum 10 participants)
- [ ] Write MeritTransaction row for every award
- [ ] Promotion check after merit award — advance tier, reset merits to 0, write ClassificationHistory

**Demotion**
- [ ] Periodic demotion review job — configurable cadence
- [ ] Finish Ratio calculation across qualifying matches in review period
- [ ] Demotion eligibility check (did not promote, minimum matches, FR above threshold)
- [ ] Apply demotion — drop one tier, reset merits, write ClassificationHistory
- [ ] Per-player opt-out of demotion (once per review period)

**Admin**
- [ ] View and edit player classification in admin panel
- [ ] Configure merit thresholds, promotion thresholds, demotion parameters via admin UI
- [ ] Admin override: manually promote or demote a player

**Tests**
- [ ] Merit award — each band size, each position, ties
- [ ] Best Overall bonus — awarded correctly, minimum participant threshold enforced
- [ ] Promotion — triggers at correct merit count, resets merits, writes history
- [ ] Demotion — Finish Ratio calculation, eligibility conditions, opt-out
- [ ] Bot classification is independent of owner classification
- [ ] SystemConfig overrides apply correctly to all thresholds

---

### Phase 3 — BOT_VS_BOT Mode

**Infrastructure**
- [ ] Redis list-based job queue in tournament service
- [ ] Background worker: pull jobs, execute bot match, write results, acknowledge job
- [ ] Startup reconciliation: re-queue IN_PROGRESS matches with no active worker on service start
- [ ] Seed SystemConfig: `tournament.botMatch.globalConcurrencyLimit`, `tournament.botMatch.defaultPaceMs`

**Bot Eligibility**
- [ ] Enforce bot eligibility at registration: active, available, non-provisional, min games played
- [ ] `botMinGamesPlayed` per tournament — read from Tournament config, fall back to SystemConfig default

**Match Execution**
- [ ] Server-side bot match execution using shared `packages/ai` inference
- [ ] Global concurrency limit enforcement across all concurrent bot tournaments
- [ ] Per-tournament pace control (configurable delay between job dispatches)
- [ ] Match result written to TournamentMatch and Game with tournament linkage
- [ ] Worker crash resilience — job remains on queue until explicitly acknowledged

**Admin**
- [ ] Configure global concurrency limit and default pace via admin UI
- [ ] Live view of active bot match jobs and queue depth

**Tests**
- [ ] Bot eligibility checks — each condition independently
- [ ] Concurrency limit — worker respects global cap
- [ ] Startup reconciliation — IN_PROGRESS matches re-queued correctly
- [ ] Job acknowledgement — job not removed until match confirmed written
- [ ] Pace control — dispatch delay applied between jobs within a tournament

---

### Phase 4 — Open Tournaments, Flash Tournaments, Round Robin, Recurring

**Open Tournaments**
- [ ] Tournament starts at scheduled time with no REGISTRATION_CLOSED state
- [ ] Organizer early-start override (minimum participants must be met)
- [ ] Registration closes implicitly when tournament starts; late entry rejected

**Flash Tournaments**
- [ ] Flash tournament creation with notice period and duration parameters
- [ ] Broadcast notification to all logged-in users on creation (real-time + in-app banner)
- [ ] "Starting in 2 min" notification to opted-in users
- [ ] Auto-start at T+N, auto-close at T+N+M
- [ ] Incomplete match resolution at close time — current series score; draw cascade if level

**Round Robin Bracket**
- [ ] Round robin bracket generation — all participants play all others
- [ ] Draw recorded as draw (1 point each); win = 2 points, loss = 0
- [ ] Final standings by total points
- [ ] Handle ties in final standings

**Recurring Tournaments**
- [ ] Apply Phase 4 migration (RecurringTournamentRegistration, registrationMode on TournamentParticipant)
- [ ] SINGLE vs RECURRING registration mode at enrollment
- [ ] Auto-enroll RECURRING participants in each new occurrence
- [ ] Occurrence generation on schedule (DAILY, WEEKLY, MONTHLY, CUSTOM)
- [ ] Auto-opt-out after N consecutive missed occurrences (configurable)
- [ ] Participant opt-out at any time

**Tests**
- [ ] Flash tournament lifecycle — creation to auto-close
- [ ] Incomplete match resolution at flash tournament close time
- [ ] Round robin bracket generation and scoring
- [ ] Round robin final standings with tiebreakers
- [ ] Recurring enrollment — SINGLE and RECURRING modes
- [ ] Auto-opt-out after missed occurrences threshold
- [ ] Open tournament early-start enforcement

---

### Phase 5 — MIXED Mode, Notification Preferences, Replay Retention

**MIXED Mode**
- [ ] MIXED tournament accepts both human and bot registrations
- [ ] Client-side match execution when human plays a bot
- [ ] All MIXED match results recorded to Game with tournament linkage (identical to BOT_VS_BOT)

**Notification Preferences**
- [ ] `AS_PLAYED` delivery — emit match result immediately via Redis pub/sub → Socket.io
- [ ] `END_OF_TOURNAMENT` delivery — queue results internally, flush batch at COMPLETED
- [ ] User-level default preference (stored in User preferences JSON)
- [ ] Per-tournament preference override at registration time
- [ ] Email delivery for match results (respects `emailAchievements` preference)

**Replay Retention**
- [ ] Background job — archive or remove Game and Move records after `replayRetentionDays`
- [ ] Retention job runs per-tournament after COMPLETED status
- [ ] Seed SystemConfig: `tournament.replay.defaultRetentionDays`

**Tests**
- [ ] MIXED match recorded correctly regardless of execution side
- [ ] AS_PLAYED vs END_OF_TOURNAMENT delivery — correct timing for each
- [ ] Per-tournament preference override takes precedence over global default
- [ ] Replay retention job — records removed after window, not before

---

## Open Items for Design

The following items were flagged in the Tournament Requirements addendum as requiring architectural decisions during the design phase. They will be resolved as each relevant phase is designed in detail.

| Item | Relevant Phase |
|------|---------------|
| Mixed-mode execution (Human vs Bot) — client-side vs server-side | Phase 5 |
| Server-side bot match pacing and concurrency scheduling logic | Phase 3 |
| Best Overall merit bonus — cross-tier scoring comparison method | Phase 2 |
| Full database schema | Phase 1 onwards |

---
