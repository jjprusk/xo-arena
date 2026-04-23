<!-- Copyright © 2026 Joe Pruskowski. All rights reserved. -->
# Production Bringup Runbook

> **One-time runbook for the first `xo-*-prod` deploy.** Applies when `xo-backend-prod`, `xo-landing-prod`, and `xo-tournament-prod` are in `pending` state (never deployed) and `xo-db-prod` is empty. After this runbook completes, future releases use the normal `/promote` flow (staging → main → auto-deploy).

## Preconditions (verify before starting)

- `aiarena.callidity.com` DNS points at `xo-landing-prod.fly.dev` anycast IP
- Fly cert for `aiarena.callidity.com` issued to `xo-landing-prod`
- `xo-redis-prod` Upstash instance exists (`fly redis list`)
- `xo-db-prod` Fly Postgres app deployed and empty
- No lingering `xo-frontend-prod` Fly app (retired in Phase 3.0)
- No real users on prod — the DB-wipe step assumes this

## Step 1 — Attach Postgres to each app

Generates a fresh DB user per app and sets `DATABASE_URL` atomically. Safe on an empty DB; idempotent detach suppresses errors.

```sh
fly postgres detach --app xo-backend-prod    xo-db-prod 2>/dev/null || true
fly postgres detach --app xo-tournament-prod xo-db-prod 2>/dev/null || true

fly postgres attach --app xo-backend-prod    xo-db-prod
fly postgres attach --app xo-tournament-prod xo-db-prod
```

## Step 2 — Set the known-safe URL / env secrets

### `xo-backend-prod` (two gaps vs staging)

```sh
fly secrets set -a xo-backend-prod \
  BETTER_AUTH_URL="https://xo-backend-prod.fly.dev" \
  JWT_SECRET="$(openssl rand -hex 32)"
```

### `xo-landing-prod` (no secrets at all)

```sh
fly secrets set -a xo-landing-prod \
  BACKEND_URL="https://xo-backend-prod.fly.dev" \
  TOURNAMENT_URL="https://xo-tournament-prod.fly.dev"
```

### `xo-tournament-prod` (missing three)

```sh
fly secrets set -a xo-tournament-prod \
  FRONTEND_URL="https://aiarena.callidity.com" \
  NODE_ENV="production" \
  REDIS_URL="$(fly redis status xo-redis-prod --json | jq -r '.PrivateURL')"
```

## Step 3 — Overwrite `REDIS_URL` on backend-prod

Even if a value was staged earlier, reset to be certain it points at prod.

```sh
fly secrets set -a xo-backend-prod \
  REDIS_URL="$(fly redis status xo-redis-prod --json | jq -r '.PrivateURL')"
```

## Step 4 — OAuth credentials

Two options — pick one before first deploy.

**Option 1 (simpler, for launch with zero users):** reuse the Google and Apple OAuth credentials already staged on `xo-backend-prod`. Add `https://aiarena.callidity.com/api/auth/callback/*` to the allowed redirect URIs at each provider.

**Option 2 (cleaner long-term):** register prod-specific OAuth apps at Apple and Google, set fresh secrets:

```sh
fly secrets set -a xo-backend-prod \
  APPLE_CLIENT_ID="..." \
  APPLE_CLIENT_SECRET="..." \
  APPLE_KEY_ID="..." \
  APPLE_TEAM_ID="..." \
  APPLE_PRIVATE_KEY="..." \
  GOOGLE_CLIENT_ID="..." \
  GOOGLE_CLIENT_SECRET="..." \
  RESEND_API_KEY="..."
```

## Step 5 — Wipe the prod DB schema

```sh
fly postgres connect -a xo-db-prod
# inside psql:
#   \c xo_arena
#   DROP SCHEMA public CASCADE;
#   CREATE SCHEMA public;
#   \q
```

On first backend startup, `prisma migrate deploy` recreates the schema from the committed migration set.

## Step 6 — Fast-forward `main` to `staging`

```sh
git checkout main
git pull origin main
git merge --ff-only origin/staging
git push origin main
```

This triggers `.github/workflows/deploy-prod.yml`, which builds and deploys backend + landing + tournament to their prod Fly apps in parallel.

## Step 7 — Smoke prod

```sh
cd e2e
BACKEND_URL=https://xo-backend-prod.fly.dev \
LANDING_URL=https://aiarena.callidity.com \
TOURNAMENT_URL=https://xo-tournament-prod.fly.dev \
npx playwright test smoke --project=chromium
```

Journey tests will skip (no QA user seeded on prod); the remaining smoke tests should all pass.

## Step 8 — 24-hour soak

Keep staging untouched for 24 hours after prod goes live. If prod develops a bug, your rollback target is the last-deployed Fly image:

```sh
# See recent deploys
fly releases -a xo-backend-prod | head
# Roll back a single service
fly deploy --image registry.fly.io/xo-backend-prod:<digest> -a xo-backend-prod
```

After the soak window, staging is free to receive the next feature (Connect4 or whatever comes next).

## After this runbook

Future releases use the normal pipeline:

```
dev ─(/stage)─> staging ─(/promote)─> main ─(deploy-prod.yml)─> prod
```

Nothing in this runbook needs to run again.
