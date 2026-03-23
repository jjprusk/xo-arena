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
| R-09 | Create account at railway.app (sign up with GitHub) | |
| R-10 | Create new project: **New Project → Empty Project**, name it `xo-arena` | |
| R-11 | Railway creates two default environments automatically: **Production** and **Staging** | |

### Phase 2 — Database & Cache
| # | Task | Done |
|---|------|------|
| R-12 | **+ New → Database → PostgreSQL** — Railway provisions Postgres, `DATABASE_URL` auto-injected | |
| R-13 | **+ New → Database → Redis** — Railway provisions Redis, `REDIS_URL` auto-injected | |

### Phase 3 — Backend Service
| # | Task | Done |
|---|------|------|
| R-14 | **+ New → GitHub Repo** → select `xo-arena` repo, name service `xo-backend` | |
| R-15 | Set **Root Directory** to `/backend` | |
| R-16 | Railway auto-detects Node.js and uses `railway.json` for start command (no manual override needed) | |
| R-17 | Add environment variables: | |
|       | `NODE_ENV=production` | |
|       | `BETTER_AUTH_SECRET=<strong random secret>` | |
|       | `BETTER_AUTH_URL=https://api.xo.aiarena.callidity.com` | |
|       | `FRONTEND_URL=https://xo.aiarena.callidity.com` | |
|       | `GOOGLE_CLIENT_ID=<from Google Cloud OAuth>` | |
|       | `GOOGLE_CLIENT_SECRET=<from Google Cloud OAuth>` | |
|       | `DATABASE_URL` and `REDIS_URL` auto-injected — no manual entry | |
| R-18 | Trigger first deploy — watch build logs | |
| R-19 | Verify: open Railway-provided URL + `/health` → should return `{"status":"ok"}` | |

### Phase 4 — Landing Page Service
| # | Task | Done |
|---|------|------|
| R-20 | **+ New → GitHub Repo** → select `xo-arena` repo, name service `aiarena-landing` | |
| R-21 | Set **Root Directory** to `/landing` | |
| R-22 | Trigger deploy — verify landing page loads at Railway-provided URL | |

### Phase 5 — Frontend Service
| # | Task | Done |
|---|------|------|
| R-23 | **+ New → GitHub Repo** → select `xo-arena` repo again, name service `xo-frontend` | |
| R-24 | Set **Root Directory** to `/frontend` | |
| R-25 | Add environment variable: `VITE_API_URL=<backend Railway URL from R-19>` | |
| R-26 | Trigger first deploy — watch build logs | |
| R-27 | Verify frontend loads at Railway-provided URL | |

### Phase 6 — Custom Domains
| # | Task | Done |
|---|------|------|
| R-28 | Backend → Settings → Domains → **Add Custom Domain**: `api.xo.aiarena.callidity.com` | |
| R-29 | Add CNAME record at registrar pointing to Railway-provided target | |
| R-30 | Frontend → Settings → Domains → **Add Custom Domain**: `xo.aiarena.callidity.com` | |
| R-31 | Add CNAME record for frontend domain | |
| R-32 | Landing → Settings → Domains → **Add Custom Domain**: `aiarena.callidity.com` | |
| R-33 | Add CNAME record for landing domain | |
| R-34 | Wait for SSL (Railway auto-provisions, usually < 5 min) | |
| R-35 | Update env vars: `BETTER_AUTH_URL` → `https://api.xo.aiarena.callidity.com` | |
| R-36 | Update env vars: `FRONTEND_URL` → `https://xo.aiarena.callidity.com` | |
| R-37 | Update env vars: `VITE_API_URL` → `https://api.xo.aiarena.callidity.com`, redeploy frontend | |
| R-38 | Update Google OAuth: add `https://api.xo.aiarena.callidity.com` to authorised redirect URIs | |

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
| R-46 | Sign up with email | |
| R-47 | Sign in with Google OAuth | |
| R-48 | Play a game vs AI | |
| R-49 | Create a PvP room, join from a second browser tab, play a move | |
| R-50 | Check ELO updates after game | |
| R-51 | Run stress tests against production URL: `BASE_URL=https://api.xo.aiarena.callidity.com ./stress/run.sh` | |

---

## Environment Variables Reference

### Backend (set in Railway service)
```
NODE_ENV=production
BETTER_AUTH_SECRET=<strong random secret — generate with: openssl rand -base64 32>
BETTER_AUTH_URL=https://api.xo.aiarena.callidity.com
FRONTEND_URL=https://xo.aiarena.callidity.com
GOOGLE_CLIENT_ID=<from Google Cloud OAuth>
GOOGLE_CLIENT_SECRET=<from Google Cloud OAuth>
DATABASE_URL=<auto-injected by Railway Postgres>
REDIS_URL=<auto-injected by Railway Redis>
```

### Frontend (set in Railway service — baked in at build time by Vite)
```
VITE_API_URL=https://api.xo.aiarena.callidity.com
```

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
