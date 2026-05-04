<!-- Copyright © 2026 Joe Pruskowski. All rights reserved. -->
# Production Bringup Runbook

> **One-time runbook for the first `xo-*-prod` deploy.** Applies when `xo-backend-prod`, `xo-landing-prod`, and `xo-tournament-prod` are in `pending` state (never deployed) and `xo-db-prod` is empty. After this runbook completes, future releases use the normal `/promote` flow (staging → main → auto-deploy).

## Preconditions (verify before starting)

- `aiarena.callidity.com` DNS points at `xo-landing-prod.fly.dev` anycast IP
- Fly cert for `aiarena.callidity.com` issued to `xo-landing-prod`
- `xo-redis-prod` Upstash instance exists (`fly redis list`)
- `xo-db-prod` Fly Postgres app deployed and empty, with **≥ 512MB memory** —
  the Fly default of 256MB OOM-kills postgres under any real load (seed +
  startup pool + first user request is enough). Bump immediately after
  creation: `fly machine update <id> --vm-memory 512 -a xo-db-prod`
- No lingering `xo-frontend-prod` Fly app (retired in Phase 3.0)
- No real users on prod — the DB-wipe step assumes this

## Step 1 — Attach Postgres to backend, share with tournament

Both services share the **same** database (matching staging's topology). Backend's
`prisma migrate deploy` on boot is the single owner of the schema; tournament
service connects to the same DB and reads/writes the same tables.

```sh
fly postgres detach --app xo-backend-prod    xo-db-prod 2>/dev/null || true
fly postgres detach --app xo-tournament-prod xo-db-prod 2>/dev/null || true

# Backend gets a fresh attach — this creates xo_backend_prod DB + user
# and sets DATABASE_URL on xo-backend-prod.
fly postgres attach --app xo-backend-prod xo-db-prod

# Tournament uses backend's DATABASE_URL verbatim. Do NOT run
# `fly postgres attach --app xo-tournament-prod` — that would create a
# second, empty database (xo_tournament_prod) that nobody migrates,
# and tournament queries would 500 on every request.
BACKEND_DB_URL="$(fly ssh console -a xo-backend-prod -C 'printenv DATABASE_URL' | tr -d '\r' | tail -1)"
fly secrets set DATABASE_URL="$BACKEND_DB_URL" -a xo-tournament-prod
```

> **Lesson from prod cut 2026-05-03:** The original runbook attached postgres
> to both apps separately, which produced two databases (`xo_backend_prod`
> and `xo_tournament_prod`). Backend migrated its DB on first boot; tournament's
> DB stayed empty because the tournament Dockerfile doesn't run
> `prisma migrate deploy`. Every `/api/tournaments` request 500'd with
> *"The table `public.tournaments` does not exist"*. Fix at the time was to
> point tournament at backend's DB (matching staging). Don't repeat the mistake.

## Step 2 — Set the known-safe URL / env secrets

### `xo-backend-prod` (two gaps vs staging)

```sh
# INTERNAL_SECRET — must be IDENTICAL to the value set on xo-tournament-prod
# below, so the backend's bot-match completion calls can authenticate into
# the tournament service. Generate once, then reuse it below.
INTERNAL_SECRET="$(openssl rand -hex 32)"

fly secrets set -a xo-backend-prod \
  BETTER_AUTH_URL="https://xo-backend-prod.fly.dev" \
  JWT_SECRET="$(openssl rand -hex 32)" \
  FRONTEND_URL="https://xo-landing-prod.fly.dev,https://aiarena.callidity.com" \
  TOURNAMENT_SERVICE_URL="http://xo-tournament-prod.flycast:3001" \
  INTERNAL_SECRET="$INTERNAL_SECRET"
```

> **Lessons from staging 2026-04-24:**
>
> - `TOURNAMENT_SERVICE_URL` was unset on staging, defaulting to
>   `http://localhost:3001`. The backend's bot runner completes each
>   bot-vs-bot match by POSTing results to the tournament service — a
>   localhost default on Fly means "this machine" (nothing there), so
>   the fetch threw `TypeError: fetch failed`, matches stayed PENDING
>   forever, and the bot runner restarted the series in an infinite
>   loop. 514 runaway game records before we caught it.
> - `INTERNAL_SECRET` (the shared auth token between backend and
>   tournament service's `/api/matches/:id/complete`) was also unset,
>   which would have been a second failure even if the URL was right —
>   the endpoint gates on `x-internal-secret` header matching
>   `INTERNAL_SECRET`, and an empty secret falls through to JWT-only
>   auth. Set the SAME value on both services.

> **Lesson from staging 2026-04-23:** `FRONTEND_URL` is the CORS allowlist
> (comma-separated). It must include **every** origin the site may be
> served from — the Fly default URL *and* every custom/aliased domain.
> Missing an origin manifests as
> `CORS: origin <origin> not allowed` on any authed call. Mirror staging's
> shape exactly. When adding a new alias later, update this secret on
> both `xo-backend-*` and `xo-tournament-*` simultaneously.

### `xo-landing-prod` (no secrets at all)

```sh
fly secrets set -a xo-landing-prod \
  BACKEND_URL="https://xo-backend-prod.fly.dev" \
  TOURNAMENT_URL="https://xo-tournament-prod.fly.dev"
```

### `xo-tournament-prod` (missing five)

```sh
# INTERNAL_SECRET here MUST match the value set on xo-backend-prod above.
# Reuse the $INTERNAL_SECRET variable from Step 2 backend block.
fly secrets set -a xo-tournament-prod \
  FRONTEND_URL="https://xo-landing-prod.fly.dev,https://aiarena.callidity.com" \
  NODE_ENV="production" \
  REDIS_URL="$(fly redis status xo-redis-prod --json | jq -r '.PrivateURL')" \
  INTERNAL_SECRET="$INTERNAL_SECRET"
```

> CORS allowlist on the tournament service must match backend's **exactly**
> — recurring-template creation, seed-bot add, and other tournament-admin
> calls hit this service, not backend. Staging was initially set up with
> only the Fly URL on tournament but all three on backend, which produced
> a silent mismatch that only surfaced when a human admin loaded the site
> from the custom domain and tried to create a recurring tournament.

> **`INTERNAL_SECRET` must be byte-identical on both services.** Confirm
> after the secrets land:
>
> ```sh
> diff <(fly ssh console -a xo-backend-prod    -C 'printenv INTERNAL_SECRET') \
>      <(fly ssh console -a xo-tournament-prod -C 'printenv INTERNAL_SECRET')
> ```
>
> Empty output = match. Any diff = backend's match-completion calls will
> silently 403.

> **`min_machines_running` must be ≥ 1 on xo-tournament-prod.** The
> tournament service hosts the 60s sweep (auto-cancel / auto-start / bot
> match recovery) and the recurring-occurrence scheduler; both are
> background jobs that need a machine alive even when no HTTP traffic is
> hitting the app. Fly auto-stopped a staging machine during an idle
> window and the sweep went dark, leaving IN_PROGRESS tournaments with
> stuck PENDING matches. `tournament/fly.toml` sets
> `min_machines_running = 1` — verify with `fly scale show -a
> xo-tournament-prod` after first deploy. Backend + landing can stay at
> 0 (they only matter when users are on-site).

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

### 7a. CORS preflight spot-check

Before running the full smoke suite, verify CORS is wired correctly for
both `xo-backend-prod` and `xo-tournament-prod` against every origin in
`FRONTEND_URL`. Pure curl — no auth needed:

```sh
for origin in \
  "https://aiarena.callidity.com" \
  "https://xo-landing-prod.fly.dev"; do
  for svc in "xo-backend-prod" "xo-tournament-prod"; do
    echo "--- $origin → $svc ---"
    curl -s -o /dev/null -w "%{http_code}\n" \
      -X OPTIONS "https://$svc.fly.dev/api/version" \
      -H "Origin: $origin" \
      -H "Access-Control-Request-Method: GET"
  done
done
```

All eight should return `204`. A `500` or a CORS-error body (`origin ... not allowed`) means the `FRONTEND_URL` allowlist on that service is missing that origin — fix before continuing.

### 7b. Playwright smoke

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
