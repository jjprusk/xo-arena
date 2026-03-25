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

---

## Checklist

### Phase 0 — Code Prep ✅
| # | Task | Done |
|---|------|------|
| R-01 | Delete `.github/workflows/deploy-staging.yml` and `deploy-prod.yml` | ✅ |
| R-02 | Delete `backend/Dockerfile` and `frontend/Dockerfile` (not needed by Railway) | ✅ |
| R-03 | `backend/package.json` has `"start": "node src/index.js"` | ✅ |
| R-04 | `backend/railway.json` — runs `prisma migrate deploy` before start, healthcheck on `/health` | ✅ |
| R-05 | `frontend/server.js` — Express static server for built `dist/` folder | ✅ |
| R-06 | `frontend/railway.json` — build command `npm run build`, start `node server.js` | ✅ |
| R-07 | `landing/railway.json` — start `node server.js` | ✅ |
| R-08 | `frontend/package.json` has `"start": "node server.js"` and `express` dependency | ✅ |

### Phase 1 — Railway Account & Project
| # | Task | Done |
|---|------|------|
| R-09 | Create account at railway.app (sign up with GitHub) | ✅ |
| R-10 | Create new project: **New Project → Empty Project**, name it `xo-arena` | ✅ |
| R-11 | Railway creates two default environments automatically: **Production** and **Staging** | ✅ |

### Phase 2 — Database & Cache
| # | Task | Done |
|---|------|------|
| R-12 | **+ New → Database → PostgreSQL** — Railway provisions Postgres, `DATABASE_URL` auto-injected | ✅ |
| R-13 | **+ New → Database → Redis** — Railway provisions Redis, `REDIS_URL` auto-injected | ✅ |

### Phase 3 — Backend Service
| # | Task | Done |
|---|------|------|
| R-14 | **+ New → GitHub Repo** → select `xo-arena` repo, name service `xo-backend` | ✅ |
| R-15 | Set **Root Directory** to `/backend` | ✅ |
| R-16 | Railway auto-detects Node.js and uses `railway.json` for start command (no manual override needed) | ✅ |
| R-17 | Add environment variables: | ✅ |
|       | `NODE_ENV=production` | ✅ |
|       | `BETTER_AUTH_SECRET=<strong random secret>` | ✅ |
|       | `BETTER_AUTH_URL=https://api.xo.aiarena.callidity.com` | ✅ |
|       | `FRONTEND_URL=https://xo.aiarena.callidity.com` | ✅ |
|       | `GOOGLE_CLIENT_ID=<from Google Cloud OAuth>` | ✅ |
|       | `GOOGLE_CLIENT_SECRET=<from Google Cloud OAuth>` | ✅ |
|       | `DATABASE_URL` and `REDIS_URL` auto-injected — no manual entry | ✅ |
| R-18 | Trigger first deploy — watch build logs | ✅ |
| R-19 | Verify: open Railway-provided URL + `/health` → should return `{"status":"ok"}` | ✅ |

### Phase 4 — Landing Page Service
| # | Task | Done |
|---|------|------|
| R-20 | **+ New → GitHub Repo** → select `xo-arena` repo, name service `aiarena-landing` | ✅ |
| R-21 | Set **Root Directory** to `/landing` | ✅ |
| R-22 | Trigger deploy — verify landing page loads at Railway-provided URL | ✅ |

### Phase 5 — Frontend Service ✅
| # | Task | Done |
|---|------|------|
| R-23 | **+ New → GitHub Repo** → select `xo-arena` repo again, name service `xo-frontend` | ✅ |
| R-24 | Set **Root Directory** to `/frontend` | ✅ |
| R-25 | Add env vars (see note below — approach changed from original plan) | ✅ |
| R-26 | Trigger first deploy — watch build logs | ✅ |
| R-27 | Verify frontend loads at Railway-provided URL | ✅ |

> **Note — auth cookie approach changed during deployment.**
> Cross-domain cookies (`SameSite=Lax`) don't work across different Railway subdomains.
> Solved by making `frontend/server.js` proxy all `/api/*` to the backend, so auth is same-origin.
> This changed the env var setup — see updated reference below.

---

### Deployment Issues Encountered & Fixed ✅

The following bugs were discovered and fixed during Phase 5 go-live:

| Issue | Fix |
|-------|-----|
| CORS blocked frontend Railway URL | Split `FRONTEND_URL` on commas in Express, Better Auth `trustedOrigins`, and socket.io CORS config |
| `crypto is not defined` (500 on sign-in) | Backend was on Node 18; pinned to Node 20 via `nixpacks.toml` |
| Cross-domain session cookies dropped | `frontend/server.js` now proxies `/api/*` to backend — auth is same-origin from browser's perspective |
| `auth.api.verifyJWT` not a function | Better Auth's JWT API methods require request context; rewrote `verifyToken` to use `jose` directly with JWKS keys from DB |
| Socket.io CORS blocked PvP room creation | Same comma-split fix applied to socket.io `cors.origin` |
| Game recording 400 errors | `durationMs` / `totalMoves` can be 0 (falsy) — changed `!durationMs` to `durationMs == null` |
| JWT `issuer`/`audience` check failed | Better Auth's JWT plugin doesn't set `iss`/`aud` claims; removed those options from `jwtVerify` call |
| Leaderboard always empty | `Difficulty` enum in schema was `EASY/MEDIUM/HARD`; frontend sends `novice/intermediate/advanced/master` — Prisma rejected every `createGame` silently; fixed enum + mapping |

---

### Phase 6 — Custom Domains ✅
| # | Task | Done |
|---|------|------|
| R-28 | Backend → Settings → Domains → **Add Custom Domain**: `api.xo.aiarena.callidity.com` | ✅ |
| R-29 | Add CNAME + `_railway-verify` TXT record at GoDaddy | ✅ |
| R-30 | Frontend → Settings → Domains → **Add Custom Domain**: `xo.aiarena.callidity.com` | ✅ |
| R-31 | Add CNAME + `_railway-verify` TXT record for frontend domain | ✅ |
| R-32 | Landing custom domain (`aiarena.callidity.com`) | ⏭ Skipped — Hobby plan allows 2 domains; landing stays on Railway-provided URL for now |
| R-34 | SSL provisioned by Railway | ✅ |
| R-35 | `BETTER_AUTH_URL` → `https://xo.aiarena.callidity.com` (frontend URL — proxy approach) | ✅ |
| R-36 | `FRONTEND_URL` → `https://xo.aiarena.callidity.com` | ✅ |
| R-37 | `VITE_API_URL` left empty (proxy), `VITE_SOCKET_URL` → `https://api.xo.aiarena.callidity.com` | ✅ |
| R-38 | Google OAuth: redirect URI → `https://xo.aiarena.callidity.com/api/auth/callback/google` | ✅ |

> **Note — custom domain port:** Railway injects `PORT=8080` at runtime. Custom domains must be configured to port 8080, not 3000/4173.
>
> **Note — BETTER_AUTH_URL must be the frontend URL** so Google's OAuth callback routes through the frontend proxy, setting cookies on the correct domain.

### Phase 7 — Staging Environment
| # | Task | Done |
|---|------|------|
| R-39 | In Railway project, switch to **Staging** environment | |
| R-40 | Railway clones all services into staging automatically | |
| R-41 | Backend (staging): set **Deploy Branch** to `staging` | |
| R-42 | Frontend (staging): set **Deploy Branch** to `staging` | |
| R-43 | Landing (staging): set **Deploy Branch** to `staging` | |
| R-44 | Push to `staging` branch — verify auto-deploy triggers | |
| R-45 | Verify production still deploys on push to `main` | |

### Phase 8 — Smoke Test
| # | Task | Done |
|---|------|------|
| R-46 | Sign up with email | ✅ |
| R-47 | Sign in with Google OAuth | ✅ |
| R-48 | Play a game vs AI, verify it appears on leaderboard | ✅ |
| R-49 | Create a PvP room, join from a second browser tab, play a move | ✅ |
| R-50 | Check ELO updates after game | |
| R-51 | Run stress tests against production URL: `BASE_URL=https://api.xo.aiarena.callidity.com ./stress/run.sh` | |

---

## Environment Variables Reference

> Values shown are for **custom-domain** setup (Phase 6). Until custom domains are live,
> use the Railway-provided `*.up.railway.app` URLs.

### Backend (set in Railway service)
```
NODE_ENV=production
BETTER_AUTH_SECRET=<strong random secret — generate with: openssl rand -base64 32>
BETTER_AUTH_URL=https://api.xo.aiarena.callidity.com   # backend's own public URL
FRONTEND_URL=https://xo.aiarena.callidity.com           # comma-separate if multiple origins needed
GOOGLE_CLIENT_ID=<from Google Cloud OAuth>
GOOGLE_CLIENT_SECRET=<from Google Cloud OAuth>
DATABASE_URL=<auto-injected by Railway Postgres>
REDIS_URL=<auto-injected by Railway Redis>
```

### Frontend (set in Railway service)
```
# Auth proxy approach — frontend server.js proxies /api/* to backend (same-origin cookies)
BACKEND_URL=https://api.xo.aiarena.callidity.com   # used by server.js proxy; NOT exposed to browser

# Baked in at build time by Vite:
VITE_API_URL=                                       # empty — API calls go through same-origin proxy
VITE_SOCKET_URL=https://api.xo.aiarena.callidity.com  # socket.io connects directly to backend
```

> **Why this approach?** Browser `SameSite=Lax` cookies don't cross Railway subdomains.
> Proxying `/api/*` through the frontend makes auth same-origin. Socket.io connects
> directly to the backend (bypassing the proxy) via `VITE_SOCKET_URL`.

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
