# XO Arena — Railway Hosting Plan

## Architecture Overview

```
Railway Project: xo-arena
├── aiarena-landing  (/landing → aiarena.callidity.com)
├── xo-frontend      (/frontend → xo.aiarena.callidity.com)
├── xo-backend       (/backend → api.xo.aiarena.callidity.com)
├── Postgres         (Railway managed, DATABASE_URL auto-injected)
└── Redis            (Railway managed, REDIS_URL auto-injected)
```

As new games are added (Connect4, Checkers, etc.), each gets its own frontend + backend
service in the same Railway project, sharing the same Postgres and Redis.

### URLs
```
Landing:      aiarena.callidity.com          → aiarena-landing service
XO Arena:     xo.aiarena.callidity.com       → xo-frontend service
XO API:       api.xo.aiarena.callidity.com   → xo-backend service
Staging:      Provided by Railway (*.up.railway.app subdomains)
```

### How deploys work
- Push to `staging` branch → Railway staging environment auto-deploys
- Push to `main` branch → Railway production environment auto-deploys
- No GitHub Actions deploy workflows needed — Railway handles it natively

### Builder notes
- **xo-frontend**: Uses `frontend/Dockerfile` (Docker builder). Required because Vite 8
  needs Node 22.12+ and nixpacks' nodejs_22 resolves to 22.11.0. `node:22-alpine` from
  Docker Hub gives the current Node 22 LTS (22.14+).
- **xo-backend**: Uses nixpacks with `NIXPACKS_NODE_VERSION = "20"` (Node 20 is sufficient).
- **aiarena-landing**: Uses nixpacks defaults.
- All services: **Metal Build Environment** enabled on both Production and Staging.

---

## Checklist

### Phase 0 — Code Prep ✅
| # | Task | Done |
|---|------|------|
| R-01 | Delete `.github/workflows/deploy-staging.yml` and `deploy-prod.yml` | ✅ |
| R-02 | `backend/railway.json` — runs `prisma migrate deploy` before start, healthcheck on `/health` | ✅ |
| R-03 | `backend/package.json` has `"start": "node src/index.js"` | ✅ |
| R-04 | `frontend/Dockerfile` — multi-stage build using `node:22-alpine` | ✅ |
| R-05 | `frontend/railway.json` — builder `DOCKERFILE`, start `node server.js` | ✅ |
| R-06 | `frontend/server.js` — Express static server for built `dist/` folder | ✅ |
| R-07 | `landing/railway.json` — start `node server.js` | ✅ |
| R-08 | `frontend/package.json` has `"start": "node server.js"` and `express` dependency | ✅ |
| R-09 | `backend/nixpacks.toml` — pins Node 20 | ✅ |
| R-10 | `frontend/nixpacks.toml` — kept for reference (builder is DOCKERFILE, not NIXPACKS) | ✅ |

### Phase 1 — Railway Account & Project ✅
| # | Task | Done |
|---|------|------|
| R-11 | Create account at railway.app (sign up with GitHub) | ✅ |
| R-12 | Create new project: **New Project → Empty Project**, name it `xo-arena` | ✅ |
| R-13 | Railway creates two default environments automatically: **Production** and **Staging** | ✅ |

### Phase 2 — Database & Cache ✅
| # | Task | Done |
|---|------|------|
| R-14 | **+ New → Database → PostgreSQL** — Railway provisions Postgres, `DATABASE_URL` auto-injected | ✅ |
| R-15 | **+ New → Database → Redis** — Railway provisions Redis, `REDIS_URL` auto-injected | ✅ |

### Phase 3 — Backend Service ✅
| # | Task | Done |
|---|------|------|
| R-16 | **+ New → GitHub Repo** → select `xo-arena` repo, name service `xo-backend` | ✅ |
| R-17 | Set **Root Directory** to `/backend` | ✅ |
| R-18 | Add environment variables: | ✅ |
|       | `NODE_ENV=production` | ✅ |
|       | `BETTER_AUTH_SECRET=<strong random secret>` | ✅ |
|       | `BETTER_AUTH_URL=<backend Railway URL>` | ✅ |
|       | `FRONTEND_URL=<frontend Railway URL>` | ✅ |
|       | `GOOGLE_CLIENT_ID=<from Google Cloud OAuth>` | ✅ |
|       | `GOOGLE_CLIENT_SECRET=<from Google Cloud OAuth>` | ✅ |
|       | `DATABASE_URL` and `REDIS_URL` auto-injected — no manual entry | ✅ |
| R-19 | Trigger first deploy — watch build logs | ✅ |
| R-20 | Verify: open Railway-provided URL + `/health` → should return `{"status":"ok"}` | ✅ |

### Phase 4 — Landing Page Service ✅
| # | Task | Done |
|---|------|------|
| R-21 | **+ New → GitHub Repo** → select `xo-arena` repo, name service `aiarena-landing` | ✅ |
| R-22 | Set **Root Directory** to `/landing` | ✅ |
| R-23 | Trigger deploy — verify landing page loads at Railway-provided URL | ✅ |

### Phase 5 — Frontend Service ✅
| # | Task | Done |
|---|------|------|
| R-24 | **+ New → GitHub Repo** → select `xo-arena` repo again, name service `xo-frontend` | ✅ |
| R-25 | Set **Root Directory** to `/frontend` | ✅ |
| R-26 | Add environment variables: | ✅ |
|       | `BACKEND_URL=<backend Railway URL>` (used by proxy in server.js) | ✅ |
|       | `VITE_API_URL=''` (empty — API calls go through proxy) | ✅ |
|       | `VITE_SOCKET_URL=<backend Railway URL>` (Socket.io bypasses proxy) | ✅ |
| R-27 | Trigger first deploy — watch build logs | ✅ |
| R-28 | Verify frontend loads at Railway-provided URL | ✅ |

### Phase 6 — Custom Domains ✅
| # | Task | Done |
|---|------|------|
| R-29 | Backend → Settings → Domains → **Add Custom Domain**: `api.xo.aiarena.callidity.com` | ✅ |
| R-30 | Add CNAME record at registrar pointing to Railway-provided target | ✅ |
| R-31 | Frontend → Settings → Domains → **Add Custom Domain**: `xo.aiarena.callidity.com` | ✅ |
| R-32 | Add CNAME record for frontend domain | ✅ |
| R-33 | Landing → Settings → Domains → **Add Custom Domain**: `aiarena.callidity.com` | ✅ |
| R-34 | Add CNAME record for landing domain | ✅ |
| R-35 | Wait for SSL (Railway auto-provisions, usually < 5 min) | ✅ |
| R-36 | Update env vars: `BETTER_AUTH_URL` → `https://api.xo.aiarena.callidity.com` | ✅ |
| R-37 | Update env vars: `FRONTEND_URL` → `https://xo.aiarena.callidity.com` | ✅ |
| R-38 | Update env vars: `BACKEND_URL` → `https://api.xo.aiarena.callidity.com`, redeploy frontend | ✅ |
| R-39 | Update Google OAuth: add `https://api.xo.aiarena.callidity.com` to authorised redirect URIs | ✅ |

### Phase 7 — Staging Environment ✅
| # | Task | Done |
|---|------|------|
| R-40 | In Railway project, switch to **Staging** environment | ✅ |
| R-41 | Duplicate all production services into staging (use right-click → Duplicate) | ✅ |
| R-42 | Backend (staging): set **Deploy Branch** to `staging` | ✅ |
| R-43 | Frontend (staging): set **Deploy Branch** to `staging` | ✅ |
| R-44 | Landing (staging): set **Deploy Branch** to `staging` | ✅ |
| R-45 | Enable **Metal Build Environment** on all 3 services in both Production and Staging | ✅ |
| R-46 | Push to `staging` branch — verify auto-deploy triggers | ✅ |
| R-47 | Verify production still deploys on push to `main` | ✅ |

### Phase 8 — Smoke Test
| # | Task | Done |
|---|------|------|
| R-48 | Sign up with email | |
| R-49 | Sign in with Google OAuth | ✅ |
| R-50 | Play a game vs AI | |
| R-51 | Create a PvP room, join from a second browser tab, play a move | |
| R-52 | Check ELO updates after game | |
| R-53 | Run stress tests against production URL: `BASE_URL=https://api.xo.aiarena.callidity.com ./stress/run.sh` | |

---

## Environment Variables Reference

### Backend (set in Railway service)
```
NODE_ENV=production
BETTER_AUTH_SECRET=<strong random secret — generate with: openssl rand -base64 32>
BETTER_AUTH_URL=<backend Railway URL or custom domain>
FRONTEND_URL=<frontend Railway URL or custom domain>
GOOGLE_CLIENT_ID=<from Google Cloud OAuth>
GOOGLE_CLIENT_SECRET=<from Google Cloud OAuth>
DATABASE_URL=<auto-injected by Railway Postgres>
REDIS_URL=<auto-injected by Railway Redis>
```

### Frontend (set in Railway service)
```
BACKEND_URL=<backend Railway URL or custom domain>  ← used by server.js proxy
VITE_API_URL=''                                     ← empty, API goes through proxy
VITE_SOCKET_URL=<backend Railway URL or custom domain>  ← Socket.io direct connection
```

### Auth architecture note
Better Auth session cookies are `SameSite=Lax` and don't cross Railway subdomains.
`frontend/server.js` proxies all `/api/*` to the backend, making auth same-origin.
Socket.io connects directly to backend via `VITE_SOCKET_URL` (bypasses the proxy).

---

## Cost Estimate

| Resource | Tier | Est. monthly |
|----------|------|-------------|
| Backend service | Hobby ($5/mo flat) | ~$5 |
| Frontend service | Included in Hobby | ~$0 |
| Landing service | Included in Hobby | ~$0 |
| Postgres | $0.000231/GB-hr | ~$1–3 |
| Redis | $0.000231/GB-hr | ~$1 |
| **Total** | | **~$7–10/month** |

Railway Hobby plan: $5/month gives 8 GB RAM / 100 GB bandwidth.
