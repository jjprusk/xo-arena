# XO Arena — Orchestrator Checklist

Tracks every task from the Development Plan. `Done` = implementation complete. `Tested` = tests passing.

| # | Task | Done | Tested |
|---|------|------|--------|
| **PHASE 0 — Machine Preparation** |
| P0-01 | Node.js installed and verified | ✓ | — |
| P0-02 | Docker Desktop running, no orphaned containers | ✓ | — |
| P0-03 | Git configured with identity | ✓ | — |
| P0-04 | No port conflicts on :3000, :5173, :5432, :6379 | ✓ | — |
| **PREREQUISITES — Scaffolding** |
| PRE-01 | Root package.json with npm workspaces | ✓ | — |
| PRE-02 | .gitignore | ✓ | — |
| PRE-03 | .env.example | ✓ | — |
| PRE-04 | CHECKLIST.md (this file) | ✓ | — |
| PRE-05 | Backend scaffold (Express + Prisma + pino + Vitest) | ✓ | ✓ |
| PRE-06 | Frontend scaffold (React + Vite + Tailwind + Zustand + Howler) | ✓ | ✓ |
| PRE-07 | Docker Compose (all 4 services) | ✓ | — |
| PRE-08 | Husky pre-commit hook (unit tests gate) | ✓ | ✓ |
| **v1 — Local-First Foundation** |
| DB-01 | Prisma schema — Users table | ✓ | — |
| DB-02 | Prisma schema — Games table | ✓ | — |
| DB-03 | Prisma schema — Moves + AIErrors tables | ✓ | — |
| DB-04 | Initial migration applied | | |
| AUTH-01 | Clerk integration (backend JWT middleware) | | |
| AUTH-02 | Protected route middleware | | |
| AUTH-03 | Guest play support (unauthenticated) | | |
| AUTH-04 | User sync on first login | | |
| AI-01 | AI implementation registry | ✓ | ✓ |
| AI-02 | Minimax engine — Hard (full lookahead) | ✓ | ✓ |
| AI-03 | Minimax engine — Medium (rule-based) | ✓ | ✓ |
| AI-04 | Minimax engine — Easy (random) | ✓ | ✓ |
| AI-05 | GET /api/v1/ai/implementations endpoint | ✓ | ✓ |
| AI-06 | POST /api/v1/ai/move endpoint | ✓ | ✓ |
| AI-T1 | Minimax correctness tests (fixed board fixtures) | ✓ | ✓ |
| AI-T2 | Difficulty behavioral tests | ✓ | ✓ |
| AI-T3 | Performance regression test (Hard ≤500ms) | ✓ | ✓ |
| API-01 | GET /users/:id | | |
| API-02 | PATCH /users/:id | | |
| API-03 | GET /users/:id/stats | | |
| API-04 | GET /users/:id/games | | |
| API-05 | GET /leaderboard | | |
| API-06 | POST /api/v1/logs (log ingestion) | ✓ | — |
| API-07 | GET /api/v1/logs (admin) | ✓ | — |
| FE-01 | App shell — desktop layout (sidebar + top nav) | ✓ | ✓ |
| FE-02 | App shell — mobile layout (bottom 3-tab nav) | ✓ | ✓ |
| FE-03 | Theme toggle (light / dark / system) | ✓ | ✓ |
| FE-04 | Design tokens applied (colors, fonts) | ✓ | — |
| FE-05 | React Router routes for all screens | ✓ | ✓ |
| FE-06 | Mode selection screen | ✓ | ✓ |
| FE-07 | Game board — PvAI (move, turn, score, win/draw) | ✓ | ✓ |
| FE-08 | Game board — AI thinking state (spinner, board dim) | ✓ | ✓ |
| FE-09 | Game board — Howler.js sound effects | ✓ | — |
| FE-10 | Game board — forfeit dialog + rematch/new game | ✓ | ✓ |
| FE-11 | Account / Profile screen | | |
| FE-12 | Settings screen (all sections) | ✓ | — |
| FE-13 | Log transport (batch → POST /api/v1/logs) | ✓ | — |
| **v2 — PvP, Real-Time & Full Feature Set** |
| RT-01 | Socket.io server + Redis adapter | ✓ | ✓ |
| RT-02 | Room lifecycle (create, join, leave, disconnect) | ✓ | ✓ |
| RT-03 | Mountain name pool (≥1000 names) | ✓ | ✓ |
| RT-04 | 60s reconnection window + forfeit | ✓ | ✓ |
| RM-01 | POST /rooms (create room) | ✓ | ✓ |
| RM-02 | GET /rooms/:name (look up room) | ✓ | ✓ |
| RM-03 | GET /rooms (list active rooms) | ✓ | ✓ |
| FE-14 | Room creation screen | ✓ | ✓ |
| FE-15 | Room join screen + invite link | ✓ | ✓ |
| FE-16 | PvP game board | ✓ | ✓ |
| FE-17 | Spectator view | ✓ | ✓ |
| LB-01 | Leaderboard screen (desktop) | ✓ | ✓ |
| LB-02 | Game history screen | ✓ | — |
| LOG-01 | Log viewer screen (admin) | ✓ | ✓ |
| E2E-01 | Full PvAI game flow | | |
| E2E-02 | Full PvP game flow | | |
| E2E-03 | Spectator flow | | |
| AID-01 | AI dashboard data collection (game/move logging) | ✓ | ✓ |
| AID-02 | AI dashboard API endpoints | ✓ | ✓ |
| AID-03 | AI dashboard frontend (Recharts) | ✓ | ✓ |
| **v3 — Cloud Deployment** |
| OPS-01 | AWS RDS Postgres provisioned | | |
| OPS-02 | AWS ElastiCache Redis provisioned | | |
| OPS-03 | AWS Elastic Beanstalk (backend) provisioned | | |
| OPS-04 | AWS S3 + CloudFront (frontend) provisioned | | |
| OPS-05 | Clerk production instance configured | | |
| OPS-06 | GitHub Actions CI pipeline (test + build) | | |
| OPS-07 | GitHub Actions CD — staging (on push to staging) | | |
| OPS-08 | GitHub Actions CD — production (on push to main) | | |
| OPS-09 | Staging deployment verified | | |
| OPS-10 | E2E tests pass on staging | | |
| OPS-11 | Load test (AI ≤500ms, Socket.io under load) | | |
| OPS-12 | Production go-live sign-off | | |
