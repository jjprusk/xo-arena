# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout

npm workspaces monorepo. Four runtime services + shared packages:

- `backend/` — Express + Prisma + Socket.io. Auth, games, bots, journey, admin. Port 3000. CLI lives at `backend/src/cli/` (the `um` tool).
- `landing/` — React + Vite SPA (the user-facing site). Port 5174 in dev. `server.js` proxies `/api/*` → backend, `/api/v1/*` and tournament endpoints → backend, `/api/(classification|recurring|tournaments)/*` → tournament service.
- `tournament/` — Express + Prisma microservice for classification/merits, recurring tournaments, tier ladder. Port 3001. **Important:** the tournament service runs in its own container with its own Prisma client; the landing proxy routes specific paths to it (see `landing/server.js`).
- `packages/` — shared code: `db` (Prisma schema + generated client, used by both `backend` and `tournament`), `ai` (game AI engines, including the tiered minimax), `game-xo` / `game-pong` (game implementations), `nav` (shared nav UI), `sdk` (game contract), `auth`, `ui`.
- `e2e/` — Playwright E2E tests + the `qa` runner (`node e2e/qa.mjs`).
- `doc/` — all design docs and runbooks. **Always start here for context** — see "Doc index" below.

The Prisma schema (`packages/db/prisma/schema.prisma`) generates into `packages/db/src/generated/prisma/` and is consumed by both `backend` and `tournament` via the bind-mounted volume in `docker-compose.yml`.

## Common commands

Most dev work happens in Docker. The DB is not reachable from the host directly.

| Task | Command |
|---|---|
| Start dev (backend + landing) | `docker compose up -d backend landing` |
| Start tournament service | `docker compose up -d tournament` |
| Tail logs | `docker compose logs -f backend` (or landing/tournament) |
| Restart one service | `docker compose restart backend` |
| Run migrations | `docker compose run --rm backend npx prisma migrate deploy` |
| Backend tests (full) | `docker compose exec -T backend npx vitest run` |
| Backend single test | `docker compose exec -T backend npx vitest run path/to/file.test.js` |
| Landing tests | `cd landing && npx vitest run` (host-direct is fine) |
| Landing single test | `cd landing && npx vitest run src/path/to/file.test.jsx` |
| Tournament tests | `docker compose exec -T tournament npx vitest run` |
| E2E tests | `cd e2e && npm test` (requires services running) |
| Smoke QA | `npm run qa` (interactive; needs TTY) |
| `um` CLI (user mgmt) | `docker compose exec -T backend node --experimental-transform-types --no-warnings src/cli/um.js <cmd>` |

**Run backend Vitest via `docker compose exec`, not from the host** — host-direct invocation produces phantom 15s-timeout flakes. The DB hostname is `postgres` inside the network and not resolvable on the host.

After any schema or migration change, run `docker compose run --rm backend npx prisma migrate deploy` before starting services.

## Deployment flow

`dev` → `staging` → `main`. Never the reverse. Hotfixes applied directly to staging must be merged back to `dev` immediately.

`/dev`, `/stage`, and `/promote` are slash commands the **user** invokes. Claude does not run pushes or deploys autonomously, even when CI is green. Wait for explicit invocation.

Production lives on Fly.io (apps: `xo-backend-prod`, `xo-landing-prod`, `xo-tournament-prod`, `xo-db-prod`). See `doc/Prod_Bringup_Runbook.md` for one-time bringup, and `doc/Guide_Operations.md` for ops procedures.

## Conventions

- All design docs go in `/doc` (not `/docs`). Each `.md` should have a matching `.pdf` rendered via the project's tuned pandoc command — default pandoc settings produce overlapping/runout PDFs; mirror an existing doc's pandoc invocation when adding new ones.
- Write tests for new backend endpoints and new service branches before declaring a feature complete.
- Keep responses concise. Verbose dev output and chatty assistant messages grow context faster than the work warrants.

## Architecture pointers

When work touches one of these areas, read the doc *first* — they encode constraints not visible in the code:

- **Intelligent Guide / onboarding journey** — `doc/Intelligent_Guide_Requirements.md` + `doc/Intelligent_Guide_Implementation_Plan.md`. The 7-step Hook + Curriculum + Specialize flow lives in `backend/src/services/journeyService.js`; UI in `landing/src/components/guide/`. Step triggers are server-detected (no client-posted step events). Phase derivation is pure (`deriveCurrentPhase`).
- **V1 acceptance** — `doc/V1_Acceptance.md` is the end-to-end QA script. When debugging a journey/onboarding issue, find the matching stage in this doc; it tells you the expected user-visible behavior.
- **Tables / realtime** — `doc/Table_Paradigm.md`. Tables are the primitive; seated players live in `db.table.seats`, spectators are tracked in-memory via `tablePresence`. Bot games run in `botGameRunner` (separate from PvP table flow). Demo tables (Hook step 2) are private `isDemo=true` Tables that route spectators through the bot-game branch in `socketHandler.js`.
- **Bot training / ML** — `doc/ML_Training_Architecture.md`. Quick Bots (minimax) "training" is a tier label bump (`user:<id>:minimax:<tier>`), not real training — see `backend/src/routes/bots.js` `train-quick` and `packages/ai/src/minimax.js`. Real ML training (Q-learning, DQN, AlphaZero) lives in `mlService` + `skillService` and operates on `BotSkill` rows.
- **Game SDK** — `doc/Game_SDK_Developer_Guide.md`. Adding a new game means a `packages/game-<name>/` package conforming to the contract in `packages/sdk/`.
- **Multi-skill bots (Phase 3.8)** — `doc/Platform_Implementation_Plan.md`. A bot's primary skill is `User.botModelId` (a UUID FK into `BotSkill` for ML bots, or the `builtin:minimax:<tier>` / `user:<id>:minimax:<tier>` form for built-in / Quick Bots).
- **Observability** — `doc/Observability_Plan.md`.

## Doc index

Authoritative references in `/doc`:

- `V1_Acceptance.md` — end-to-end QA script
- `Intelligent_Guide_Requirements.md` / `Intelligent_Guide_Implementation_Plan.md` — onboarding journey spec + status
- `Guide_Operations.md` — runbook for the journey + admin panels
- `Platform_Implementation_Plan.md` — broader platform roadmap (multi-skill, Tables, etc.)
- `Table_Paradigm.md` — Tables-as-primitive design
- `ML_Training_Architecture.md` — bot training pipelines
- `Game_SDK_Developer_Guide.md` — adding a new game
- `Prod_Bringup_Runbook.md` — first-time prod deploy
- `Registry_Switch_Guide.md` — container registry migration
- `Observability_Plan.md` — logging/metrics/alerts
- `Realtime_Migration_Plan.md` — Socket.io → SSE+POST migration plan (active workstream)
