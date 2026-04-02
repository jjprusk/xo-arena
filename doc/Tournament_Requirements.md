# AI Arena — Tournament Requirements

## Overview

Tournaments are a platform-level feature shared across all games (XO Arena, Connect4 Arena, etc.).
They support both human players competing against each other and AI models competing against each other.
Tournament management requires the `tournament` role (or `admin`).

---

## Tournament Types by Format

### 1. Open Tournament
- Always-on or time-bounded; any logged-in user can join at any time up to the start
- No registration window — users enter the lobby and are placed in the bracket/pool as they arrive
- Suitable for low-commitment, casual competitive play

### 2. Planned Tournament
- Defined start time and end time set in advance by the organiser
- Users explicitly register during a registration window (opens and closes before the start time)
- Bracket/pool is seeded from the registered participant list at registration close
- Notifications sent to registered users before start (e.g., 1 hour and 15 minutes prior)
- Late entry not permitted once the tournament has started

### 3. Flash Tournament
- Spontaneous; organiser fires it with two parameters: **notice period N** (minutes until start) and **duration M** (minutes the tournament runs)
- All logged-in users receive a real-time notification: *"A flash tournament starts in N minutes"*
- Users have the notice period to opt in
- Tournament auto-starts at T+N and auto-closes at T+N+M regardless of match completion state
- Incomplete matches at close time are resolved by current score or forfeit rules

---

## Tournament Types by Mode

### Player vs Player (PvP)
- Human players compete directly against each other
- Standard bracket or round-robin format
- Uses the existing real-time PvP game infrastructure (Socket.io rooms)
- ELO and game history are updated on completion of each match

### AI vs AI
- Users enter one of their trained ML models as a competitor
- The user's model plays on their behalf — the user does not interact during matches
- Users can watch matches in spectator mode in real time
- **Winner determination:** each match is decided by a best-of-N series against a designated Minimax benchmark opponent (e.g., best of 5 against the Advanced minimax)
  - The benchmark difficulty is chosen by the organiser at tournament setup time: Novice, Intermediate, Advanced, or Master
  - The model with the higher win count against the benchmark advances; ties broken by average moves-per-win (fewer is better)
  - Models play all their benchmark games before head-to-head bracket matches begin
  - Head-to-head matches between two qualified models use the same best-of-N format directly against each other (not the benchmark)
- Models are run server-side; no client connection required once entered
- Model ELO is updated based on tournament match outcomes

---

## Tournament Structure / Bracket Formats

| Format | Best for |
|--------|----------|
| Single elimination | Fast, large fields |
| Double elimination | Fairer, medium fields |
| Round robin | Small fields (≤8), most accurate ranking |
| Swiss | Large fields, many rounds without elimination |

Organiser selects format at creation time. Initial implementation: **single elimination** and **round robin** only.

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
| `DRAFT` | Created but not yet published; only visible to organiser |
| `REGISTRATION_OPEN` | Published; users can register/enter |
| `REGISTRATION_CLOSED` | Registration window has ended; bracket is being seeded |
| `IN_PROGRESS` | Matches are running |
| `COMPLETED` | All matches finished; final standings recorded |
| `CANCELLED` | Cancelled by organiser or admin; no ELO impact |

Flash tournaments skip `DRAFT` and `REGISTRATION_CLOSED` — they go directly from creation to `REGISTRATION_OPEN` then `IN_PROGRESS` at T+N.

---

## Tournament Configuration Fields

| Field | Type | Applies to | Description |
|-------|------|-----------|-------------|
| `name` | string | All | Display name |
| `game` | string | All | e.g., `xo`, `connect4` |
| `mode` | enum | All | `PVP` \| `AI_VS_AI` |
| `format` | enum | All | `OPEN` \| `PLANNED` \| `FLASH` |
| `bracketType` | enum | All | `SINGLE_ELIM` \| `ROUND_ROBIN` |
| `maxParticipants` | int? | All | Cap on entries; null = unlimited |
| `startTime` | datetime | Planned | When tournament begins |
| `endTime` | datetime | Planned, Flash | When tournament auto-closes |
| `registrationOpenAt` | datetime | Planned | When registration opens |
| `registrationCloseAt` | datetime | Planned | When registration closes |
| `noticePeriodMinutes` | int | Flash | N — notice before start |
| `durationMinutes` | int | Flash | M — how long tournament runs |
| `bestOfN` | int | All | Number of games per match (must be odd, e.g. 3, 5, 7) |
| `allowSpectators` | bool | All | Whether matches are publicly watchable |
| `description` | string? | All | Optional organiser notes |
| `createdBy` | userId | All | Organiser |

---

## Notifications

| Event | Who is notified | Channel |
|-------|----------------|---------|
| Flash tournament announced | All logged-in users | Real-time (Socket.io broadcast) + in-app banner |
| Flash tournament starting in 2 min | Opted-in users | Real-time |
| Planned tournament registration opens | All users (opt-in to tournament alerts) | In-app notification |
| Planned tournament starts in 1 hour | Registered users | In-app notification |
| Planned tournament starts in 15 min | Registered users | Real-time |
| Your match is ready | Participant | Real-time |
| Your match result | Participant | Real-time + persistent notification |
| Tournament completed | All participants | In-app notification |

---

## AI vs AI — Match Execution

1. Organiser creates AI vs AI tournament and selects best-of-N (must be odd, e.g., best of 5)
2. Users enter their ML models during registration (one model per user per tournament)
3. At tournament start, bracket is seeded by current model ELO rating
4. Each match is a best-of-N series played **head-to-head between the two models** directly:
   - Models alternate who plays X and who plays O across games in the series
   - The model that wins more than half the series advances (e.g., first to 3 wins in a best-of-5)
   - Ties are not possible with an odd N; draws within a single game count as half a point for each model
5. Matches run server-side, sequentially or in parallel up to a concurrency limit
6. Results update the bracket in real time; spectators can watch any match
7. At completion, final standings are recorded and model ELO ratings are updated

---

## Player vs Player — Match Execution

1. When a participant's match is ready, both players receive a real-time notification
2. A game room is automatically created and both players are connected
3. Players have a **check-in window** (e.g., 2 minutes) to join their room; failure to join forfeits the match
4. Match plays out using the existing PvP game infrastructure
5. Winner advances in the bracket; result is recorded and ELO updated
6. If a player disconnects mid-match, the existing reconnection window applies; expiry = forfeit

---

## Data Model (high level)

```
Tournament
  id, game, mode, format, bracketType, status
  name, description, createdBy
  maxParticipants, bestOfN, allowSpectators
  startTime, endTime
  registrationOpenAt, registrationCloseAt
  noticePeriodMinutes, durationMinutes (Flash only)

TournamentEntry
  id, tournamentId, userId
  modelId (AI vs AI — the entered ML model)
  seed, finalRank
  registeredAt

TournamentMatch
  id, tournamentId, round, matchNumber
  entry1Id, entry2Id
  winnerId
  status (PENDING | IN_PROGRESS | COMPLETED | FORFEITED)
  games []  → links to existing Game records
  startedAt, completedAt

TournamentStanding
  id, tournamentId, entryId
  rank, wins, losses, points
```

---

## ELO

- Single ELO rating per player (and per ML model) shared across all play — tournament and non-tournament outcomes update the same rating
- Tournament match results are recorded in `UserEloHistory` / `MLEloHistory` with an `opponentType` of `tournament` so the source is traceable
- Cancelled tournaments have no ELO impact

---

## Competitive Ranking Tiers

Tournament standings and leaderboards use a competitive ranking tier system based on ELO
rating and tournament performance. These are distinct from the participation tiers in the
Credits system (Bronze → Diamond), which reward engagement. Competitive tiers reward skill.

| Tier | Name | Icon |
|------|------|------|
| 0 | Newcomer | — |
| 1 | Player | ▲ |
| 2 | Competitor | ◆ |
| 3 | Champion | ★ |
| 4 | Legend | ⚡ |

Thresholds, promotion/demotion rules, and display placement are to be defined when the
tournament leaderboard feature is implemented.

---

## Out of Scope (initial version)

- Prize / reward system
- Team tournaments
- Cross-game tournaments
- Recurring / scheduled tournament series
- Spectator chat
- Replay viewing after tournament completion
