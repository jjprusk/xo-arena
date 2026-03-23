# AI Arena — Hosting Plan

## Architecture Overview

```
aiarena.callidity.com          → Landing page  (Firebase Hosting)
xo.aiarena.callidity.com       → XO Arena      (Firebase Hosting → Cloud Run backend)
connect4.aiarena.callidity.com → Connect4 Arena (Firebase Hosting → Cloud Run backend)
checkers.aiarena.callidity.com → Checkers Arena (Firebase Hosting → Cloud Run backend)
```

### Infrastructure (one GCP project, shared)

| Resource | Service | Shared? |
|----------|---------|---------|
| User accounts & auth | Better Auth on XO Arena backend | Yes — all games |
| Database | Cloud SQL (Postgres 16) | Yes — one instance, one DB per game |
| Cache / PvP sessions | Memorystore (Redis) | Yes — one instance |
| Game backends | Cloud Run | No — one service per game |
| Game frontends | Firebase Hosting | No — one site per game |
| Container images | Artifact Registry | Yes — one repo, namespaced by game |
| Secrets | Secret Manager | Yes — one project |

### Auth strategy
One shared auth backend (XO Arena's Cloud Run service handles `/api/auth` for all games).
All game frontends point their `auth-client` at `xo.aiarena.callidity.com/api/auth`.
One user account works across all games.

---

## DNS Setup

> **Important:** DNS records for Firebase Hosting cannot be created until after Firebase
> provisioning (Phase 2), because Firebase provides the IP addresses/CNAME targets during
> domain verification. Add DNS records as the last step of each phase, not before.

### Record types needed (per subdomain)

Firebase Hosting custom domains require two `A` records (IPv4) and two `AAAA` records
(IPv6). Firebase provides the exact values during domain setup. The pattern will be:

```
aiarena.callidity.com        A      <IP from Firebase>
xo.aiarena.callidity.com     A      <IP from Firebase>
connect4.aiarena.callidity.com  A   <IP from Firebase>
```

### Wildcard vs individual records
A wildcard `*.aiarena.callidity.com` pointing to Firebase works but requires Firebase to
recognise each subdomain individually. Individual records per subdomain are safer and
easier to debug.

---

## Checklist

### Phase 0 — GCP Project Setup
| # | Task | Done |
|---|------|------|
| H-01 | Create GCP project `aiarena` + enable billing | ✓ |
| H-02 | Enable APIs in GCP project `aiarena`: Cloud Run Admin API (`run.googleapis.com`), Cloud SQL Admin API, Redis API (Memorystore), Artifact Registry API (may already be enabled as a dependency), Secret Manager API, Firebase Management API | ✓ |
| H-03 | Create Artifact Registry repository: `us-east1-docker.pkg.dev/aiarena/games` | ✓ |
| H-04 | Create GCP service account `github-actions-deploy` and grant roles: Cloud Run Admin (or Developer), Artifact Registry Writer, Firebase Hosting Admin, Secret Manager Secret Accessor. Note: service account email includes GCP-assigned project number, e.g. `github-actions-deploy@aiarena-<number>.iam.gserviceaccount.com` | ✓ |
| H-05 | Configure GitHub Actions auth: Workload Identity Federation (preferred) or download SA key | ✓ |
| H-06 | Add GCP credentials to GitHub repo secrets: `GCP_PROJECT_ID`, `WIF_PROVIDER`, `WIF_SERVICE_ACCOUNT` (or `GCP_SA_KEY`) | ✓ |

### Phase 1 — Shared Infrastructure
| # | Task | Done |
|---|------|------|
| H-07 | Provision Cloud SQL instance: Postgres 16, `db-f1-micro` (scale up later), region `us-east1` | ✓ |
| H-08 | Create databases: `xo_arena`, `connect4_arena` (add per game) | ✓ |
| H-09 | Create Cloud SQL user `app` with strong password, store in Secret Manager as `db-password` and full connection string as `database-url` | ✓ |
| H-10 | Provision Memorystore Redis instance: 1GB Basic tier, same region | ✓ |
| H-11 | Note the Redis host IP (used as `REDIS_URL` in all game backends) | ✓ |
| H-12 | Create Firebase project linked to GCP project `aiarena` | ✓ |
| H-13 | Enable Firebase Hosting in the Firebase project | ✓ |

### Phase 2 — XO Arena (first game, establishes the template)
| # | Task | Done |
|---|------|------|
| H-14 | Add all backend secrets to Secret Manager: `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DATABASE_URL` (Cloud SQL socket format), `REDIS_URL`, `FRONTEND_URL` | ✓ |
| H-15 | Deploy XO Arena backend to Cloud Run: service name `xo-backend`, region `us-east1`, min-instances=1, Cloud SQL connection attached | |
| H-16 | Verify backend health: `curl https://<cloud-run-url>/health` | |
| H-17 | Create Firebase Hosting site `xo-arena` | |
| H-18 | Add `firebase.json` to XO Arena repo (rewrites `/api/**` → Cloud Run service URL) | |
| H-19 | Deploy XO Arena frontend to Firebase Hosting site `xo-arena` | |
| H-20 | Add Firebase custom domain `xo.aiarena.callidity.com` — Firebase provides DNS records | |
| H-21 | **DNS:** Add A/AAAA records for `xo.aiarena.callidity.com` at registrar using values from H-20 | |
| H-22 | Wait for SSL cert provisioning (Firebase auto-provisions via Let's Encrypt, up to 24h) | |
| H-23 | Update Google OAuth: add `https://xo.aiarena.callidity.com` to authorised redirect URIs | |
| H-24 | Set `BETTER_AUTH_URL=https://xo.aiarena.callidity.com` in Cloud Run env | |
| H-25 | Smoke test: sign up, play a game, PvP room creation | |

### Phase 3 — Landing Page
| # | Task | Done |
|---|------|------|
| H-26 | Create `aiarena-landing` repo (or folder) — simple static site listing all games | |
| H-27 | Create Firebase Hosting site `aiarena-landing` | |
| H-28 | Deploy landing page to Firebase | |
| H-29 | Add Firebase custom domain `aiarena.callidity.com` — Firebase provides DNS records | |
| H-30 | **DNS:** Add A/AAAA records for `aiarena.callidity.com` at registrar | |
| H-31 | Verify landing page loads and links to `xo.aiarena.callidity.com` | |

### Phase 4 — CI/CD Pipelines
| # | Task | Done |
|---|------|------|
| H-32 | Write `deploy-staging.yml`: on push to `staging` → build image → push to Artifact Registry → deploy Cloud Run → deploy Firebase | |
| H-33 | Write `deploy-prod.yml`: on push to `main` → same targets, production services | |
| H-34 | Add `FIREBASE_SERVICE_ACCOUNT` secret to GitHub (from Firebase project settings) | |
| H-35 | Test staging deploy end-to-end: push to staging branch, verify auto-deploy | |
| H-36 | Test production deploy end-to-end: merge to main, verify auto-deploy | |

### Phase 5 — Per Additional Game (repeat for each)
| # | Task | Done |
|---|------|------|
| H-37 | Create new game repo from XO Arena template | |
| H-38 | Create database in shared Cloud SQL instance | |
| H-39 | Add game-specific secrets to Secret Manager | |
| H-40 | Deploy backend to new Cloud Run service (e.g., `connect4-backend`) | |
| H-41 | Create Firebase Hosting site for the game | |
| H-42 | Add `firebase.json` with rewrites to new Cloud Run service | |
| H-43 | Deploy frontend | |
| H-44 | Add custom domain (e.g., `connect4.aiarena.callidity.com`) in Firebase | |
| H-45 | **DNS:** Add A/AAAA records at registrar | |
| H-46 | Update landing page to include the new game | |
| H-47 | Point game's auth-client at `xo.aiarena.callidity.com/api/auth` (shared auth) | |

### Phase 6 — Production Hardening
| # | Task | Done |
|---|------|------|
| H-48 | Set Cloud Run min-instances=1 on all services (prevents cold-start WebSocket drops) | |
| H-49 | Configure Cloud SQL automated backups (daily, 7-day retention) | |
| H-50 | Set up Cloud Monitoring uptime checks on each game's `/health` endpoint | |
| H-51 | Configure alerting: notify on Cloud Run error rate spike or instance restarts | |
| H-52 | Set budget alert in GCP Billing (e.g., alert at $50/month) | |
| H-53 | Review Cloud Run CPU/memory sizing under load | |

---

## Environment Variables Reference

### Backend (Cloud Run) — set via Secret Manager or Cloud Run env
```
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://app:<password>@/xo_arena?host=/cloudsql/aiarena:us-east1:<instance>
REDIS_URL=redis://<memorystore-ip>:6379
BETTER_AUTH_SECRET=<strong random secret>
BETTER_AUTH_URL=https://xo.aiarena.callidity.com
FRONTEND_URL=https://xo.aiarena.callidity.com
GOOGLE_CLIENT_ID=<from GCP OAuth>
GOOGLE_CLIENT_SECRET=<from GCP OAuth>
```

### Frontend (build-time, injected by CD workflow)
```
VITE_API_URL=https://xo.aiarena.callidity.com
VITE_APP_VERSION=<from package.json>
```

> Note: `VITE_API_URL` must be set at build time (Vite bakes it in).
> In production this is the full subdomain URL, not empty string.

---

## `firebase.json` structure (per game)

No API rewrites — all backend traffic (REST + WebSocket + auth) goes directly to Cloud Run
via `VITE_API_URL`. Firebase Hosting serves static files only.

```json
{
  "hosting": {
    "site": "xo-arena",
    "public": "dist",
    "ignore": ["firebase.json", "**/.*"],
    "rewrites": [
      {
        "source": "**",
        "destination": "/index.html"
      }
    ]
  }
}
```

---

## Cost Estimate (all games running)

| Resource | Tier | Est. monthly |
|----------|------|-------------|
| Cloud SQL (db-f1-micro) | Shared core | ~$10 |
| Memorystore Redis (1GB) | Basic | ~$25 |
| Cloud Run (per service, low traffic) | Pay-per-use | ~$0–5 each |
| Firebase Hosting | Spark/Blaze | ~$0–2 |
| Artifact Registry | Storage | ~$1 |
| **Total (3 games)** | | **~$50–60/month** |

Cloud Run scales to zero when not in use (except min-instances=1 services).
