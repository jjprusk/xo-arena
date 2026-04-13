<!-- Copyright © 2026 Joe Pruskowski. All rights reserved. -->
# XO Arena — Fly.io Migration Plan

**From:** Railway  
**To:** Fly.io  
**Reason:** Railway repeatedly ignored Dockerfile configuration in the monorepo, falling back to Railpack auto-detection and failing to build. Fly.io reads `fly.toml` unconditionally and runs Dockerfiles exactly as written.  
**Database migration:** Not required — starting fresh (no users to migrate).

---

## Architecture

```
GitHub
  ├── staging branch → tests → fly deploy → Fly.io (staging apps)
  └── main branch    → tests → fly deploy → Fly.io (production apps)
```

### Services

| Service | Staging App | Production App |
|---|---|---|
| xo-frontend | xo-frontend-staging | xo-frontend-prod |
| aiarena-landing | xo-landing-staging | xo-landing-prod |
| xo-backend | xo-backend-staging | xo-backend-prod |
| xo-tournament | xo-tournament-staging | xo-tournament-prod |

### Infrastructure

| Component | Fly.io Service | Notes |
|---|---|---|
| PostgreSQL | Fly Postgres | One instance per environment |
| Redis | Upstash (Fly integration) | Free tier, auto-attached |
| Docker images | Built by Fly remote builder | No separate registry needed |

---

## Responsibility Split

### You do (browser only — 3 steps)

1. Create account at **fly.io**
2. Add billing info
3. Run `fly auth login` in terminal once

### Claude does (everything else via CLI)

- Create all 8 Fly apps
- Create and attach Postgres databases
- Set up Upstash Redis
- Write all `fly.toml` config files
- Write GitHub Actions deploy workflows
- Set all environment variables and secrets
- Run first deploys and verify

---

## Phase 1 — Account & CLI Setup

**You do:**

1. Create account at fly.io
2. Add billing (required even for free tier)
3. Install CLI:
```bash
brew install flyctl
```
4. Authenticate:
```bash
fly auth login
```

---

## Phase 2 — Create Apps

**Claude runs:**

```bash
# Production
fly apps create xo-backend-prod
fly apps create xo-frontend-prod
fly apps create xo-landing-prod
fly apps create xo-tournament-prod

# Staging
fly apps create xo-backend-staging
fly apps create xo-frontend-staging
fly apps create xo-landing-staging
fly apps create xo-tournament-staging
```

---

## Phase 3 — Databases

**Claude runs:**

```bash
# Postgres — one instance per environment
fly postgres create --name xo-db-prod \
  --region iad --initial-cluster-size 1 \
  --vm-size shared-cpu-1x --volume-size 10

fly postgres create --name xo-db-staging \
  --region iad --initial-cluster-size 1 \
  --vm-size shared-cpu-1x --volume-size 10

# Attach databases to backend and tournament
fly postgres attach xo-db-prod --app xo-backend-prod
fly postgres attach xo-db-prod --app xo-tournament-prod
fly postgres attach xo-db-staging --app xo-backend-staging
fly postgres attach xo-db-staging --app xo-tournament-staging

# Redis via Upstash (free tier)
fly ext upstash-redis create \
  --name xo-redis-prod --app xo-backend-prod
fly ext upstash-redis create \
  --name xo-redis-staging --app xo-backend-staging
```

Prisma runs `migrate deploy` on first boot — database tables are created automatically.

---

## Phase 4 — fly.toml Configuration Files

**Claude writes** one `fly.toml` per service directory:

- `backend/fly.toml`
- `frontend/fly.toml`
- `landing/fly.toml`
- `tournament/fly.toml`

Build context is the repo root — Dockerfiles access `packages/xo`, `packages/ai`, and `packages/db` directly. No monorepo workarounds needed.

Example (`backend/fly.toml`):

```toml
app = "xo-backend"
primary_region = "iad"

[build]
  dockerfile = "backend/Dockerfile"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true

[env]
  NODE_ENV = "production"
  PORT = "3000"

[[vm]]
  memory = "512mb"
  cpu_kind = "shared"
  cpus = 1
```

---

## Phase 5 — GitHub Actions

**Claude writes** two deploy workflows:

**`.github/workflows/deploy-staging.yml`** — triggers on push to `staging`:

1. Run existing tests (unchanged)
2. Deploy all 4 staging apps in parallel

**`.github/workflows/deploy-prod.yml`** — triggers on push to `main`:

1. Run existing tests (unchanged)
2. Deploy all 4 production apps in parallel

**You add one GitHub secret:**

```
FLY_API_TOKEN
```

Generated via:
```bash
fly tokens create deploy
```

---

## Phase 6 — Environment Variables

**Claude prepares** the full list of secrets from current Railway config.  
**You paste** the values once per environment:

```bash
fly secrets set \
  JWT_SECRET="..." \
  BETTER_AUTH_SECRET="..." \
  GOOGLE_CLIENT_ID="..." \
  GOOGLE_CLIENT_SECRET="..." \
  --app xo-backend-prod
```

`DATABASE_URL` and `REDIS_URL` are set automatically by the attach commands in Phase 3.

---

## Phase 7 — First Deploy

**Claude runs:**

```bash
fly deploy --config backend/fly.toml --app xo-backend-prod
fly deploy --config frontend/fly.toml --app xo-frontend-prod
fly deploy --config landing/fly.toml --app xo-landing-prod
fly deploy --config tournament/fly.toml --app xo-tournament-prod
```

After this, all future deploys are automatic via GitHub Actions on every push to `staging` or `main`.

---

## Phase 8 — Smoke Tests & Cutover

1. Run smoke tests against Fly.io staging URLs
2. Update any custom domain DNS to point to Fly.io
3. Decommission Railway services

---

## Cost Estimate

| Item | Cost/month |
|---|---|
| 4 production services (shared-cpu-1x 256MB) | ~$8 |
| 4 staging services (scale to zero) | ~$0 |
| Fly Postgres × 2 (staging + prod) | ~$4 |
| Upstash Redis | ~$0 |
| **Total** | **~$12** |

Staging services scale to zero when not in use — no cost when idle.

---

## Why Fly.io vs Railway

| | Fly.io | Railway |
|---|---|---|
| Dockerfile | Always used, no exceptions | Frequently overridden by Railpack |
| Monorepo | No issues | Actively fights shared packages |
| Config file | `fly.toml` — always respected | `railway.toml/json` — frequently ignored |
| Build debugging | Clear, predictable | Opaque auto-detection |
| Cost | ~$12/month | Similar |
| Reputation | Well-regarded, production-proven | Newer, less stable |
