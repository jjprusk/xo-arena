# XO Arena — Railway Hosting Plan

## Architecture Overview

```
Railway Project: aiarena
├── aiarena-landing  (Static site, /landing subdirectory → aiarena.callidity.com)
├── xo-frontend      (Static site, /frontend subdirectory → xo.aiarena.callidity.com)
├── xo-backend       (Node.js, /backend subdirectory → api.xo.aiarena.callidity.com)
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
- Push to `main` branch (merge) → Railway production environment auto-deploys
- No GitHub Actions workflows needed — Railway handles it natively

---

## Checklist

### Phase 0 — Cleanup
| # | Task | Done |
|---|------|------|
| R-01 | Delete `.github/workflows/deploy-staging.yml` and `deploy-prod.yml` (no longer needed) | |
| R-02 | Delete `backend/Dockerfile` (Railway auto-detects Node.js) | |
| R-03 | Verify `backend/package.json` has a `"start"` script (`node src/index.js`) | |

### Phase 1 — Railway Account & Project
| # | Task | Done |
|---|------|------|
| R-04 | Create account at railway.app (sign up with GitHub) | |
| R-05 | Create new project: **New Project → Empty Project**, name it `xo-arena` | |
| R-06 | In project settings, note the project has two default environments: **Production** and **Staging** | |

### Phase 2 — Database & Cache
| # | Task | Done |
|---|------|------|
| R-07 | In Railway project: **+ New → Database → PostgreSQL** — Railway provisions Postgres and injects `DATABASE_URL` automatically | |
| R-08 | In Railway project: **+ New → Database → Redis** — Railway provisions Redis and injects `REDIS_URL` automatically | |
| R-09 | Note: `DATABASE_URL` and `REDIS_URL` are available as shared variables — no manual configuration needed | |

### Phase 3 — Backend Service
| # | Task | Done |
|---|------|------|
| R-10 | In Railway project: **+ New → GitHub Repo** → select `xo-arena` repo | |
| R-11 | Set **Root Directory** to `/backend` in service settings | |
| R-12 | Railway will detect Node.js and use `npm install` + `npm start` automatically | |
| R-13 | Add environment variables in the backend service settings: | |
|      | `NODE_ENV=production` | |
|      | `BETTER_AUTH_SECRET=<strong random secret>` | |
|      | `BETTER_AUTH_URL=https://api.xo.aiarena.callidity.com` | |
|      | `FRONTEND_URL=https://xo.aiarena.callidity.com` | |
|      | `GOOGLE_CLIENT_ID=<from GCP OAuth>` | |
|      | `GOOGLE_CLIENT_SECRET=<from GCP OAuth>` | |
|      | `DATABASE_URL` and `REDIS_URL` are auto-injected from the Postgres/Redis services — no manual entry needed | |
| R-14 | Add start command override if needed: `npx prisma migrate deploy && node src/index.js` | |
| R-15 | Trigger first deploy — watch build logs | |
| R-16 | Verify backend health: open the Railway-provided URL + `/health` | |

### Phase 4 — Landing Page Service
| # | Task | Done |
|---|------|------|
| R-17 | In Railway project: **+ New → GitHub Repo** → select `xo-arena` repo, name service `aiarena-landing` | |
| R-18 | Set **Root Directory** to `/landing` | |
| R-19 | Set **Build Command** to `npm install && npm run build` | |
| R-20 | Set **Start Command** to `npm start` | |
| R-21 | Trigger first deploy — verify landing page loads at Railway-provided URL | |

### Phase 5 — Frontend Service
| # | Task | Done |
|---|------|------|
| R-17 | In Railway project: **+ New → GitHub Repo** → select `xo-arena` repo again (second service) | |
| R-18 | Set **Root Directory** to `/frontend` | |
| R-19 | Set **Build Command** to `npm install && npm run build` | |
| R-20 | Set **Start Command** to blank or use a static file server (see note below) | |
| R-21 | Add environment variable: `VITE_API_URL=<Railway backend URL>` (get from backend service after R-15) | |
| R-22 | Trigger first frontend deploy — watch build logs | |
| R-23 | Verify frontend loads at Railway-provided URL | |

> **Note on static serving:** Railway doesn't serve static files natively. Two options:
> - Add `"serve": "npx serve dist -s -l $PORT"` to `frontend/package.json` scripts and set start command to `npm run serve`
> - Or add a minimal `frontend/server.js` (see appendix below)

### Phase 6 — Custom Domains
| # | Task | Done |
|---|------|------|
| R-24 | Backend service → Settings → Domains → **Add Custom Domain**: `api.xo.aiarena.callidity.com` | |
| R-25 | Railway provides a CNAME target — add it as a DNS CNAME record at your registrar | |
| R-26 | Frontend service → Settings → Domains → **Add Custom Domain**: `xo.aiarena.callidity.com` | |
| R-27 | Add CNAME record for frontend domain at registrar | |
| R-28 | Wait for SSL certificates (Railway auto-provisions, usually < 5 minutes) | |
| R-29 | Update `BETTER_AUTH_URL` env var to `https://api.xo.aiarena.callidity.com` | |
| R-30 | Update `FRONTEND_URL` env var to `https://xo.aiarena.callidity.com` | |
| R-31 | Update `VITE_API_URL` env var to `https://api.xo.aiarena.callidity.com` and redeploy frontend | |
| R-32 | Update Google OAuth: add `https://api.xo.aiarena.callidity.com` to authorised redirect URIs | |

### Phase 7 — Staging Environment
| # | Task | Done |
|---|------|------|
| R-33 | In Railway project, switch to **Staging** environment | |
| R-34 | Railway clones all services into staging — configure staging-specific env vars if needed | |
| R-35 | In backend service (staging): set **Deploy Branch** to `staging` | |
| R-36 | In frontend service (staging): set **Deploy Branch** to `staging` | |
| R-37 | Push to `staging` branch — verify staging auto-deploys | |
| R-38 | Verify production still deploys on push to `main` | |

### Phase 8 — Smoke Test
| # | Task | Done |
|---|------|------|
| R-39 | Sign up with email | |
| R-40 | Sign in with Google OAuth | |
| R-41 | Play a game vs AI | |
| R-42 | Create a PvP room, join from a second browser tab, play a move | |
| R-43 | Check ELO updates after game | |

---

## Environment Variables Reference

### Backend (set in Railway service)
```
NODE_ENV=production
BETTER_AUTH_SECRET=<strong random secret>
BETTER_AUTH_URL=https://api.xo.aiarena.callidity.com
FRONTEND_URL=https://xo.aiarena.callidity.com
GOOGLE_CLIENT_ID=<from GCP OAuth>
GOOGLE_CLIENT_SECRET=<from GCP OAuth>
DATABASE_URL=<auto-injected by Railway Postgres>
REDIS_URL=<auto-injected by Railway Redis>
```

### Frontend (set in Railway service, baked in at build time by Vite)
```
VITE_API_URL=https://api.xo.aiarena.callidity.com
VITE_APP_VERSION=<set manually or via Railway variable>
```

---

## Appendix — Static File Server for Frontend

If Railway can't serve the built `dist/` folder directly, add this file:

**`frontend/server.js`**
```js
import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const app = express()
const __dirname = dirname(fileURLToPath(import.meta.url))

app.use(express.static(join(__dirname, 'dist')))
app.get('*', (req, res) => res.sendFile(join(__dirname, 'dist', 'index.html')))

app.listen(process.env.PORT || 3000)
```

And add to `frontend/package.json`:
```json
"start": "node server.js"
```

---

## Cost Estimate

| Resource | Tier | Est. monthly |
|----------|------|-------------|
| Backend service | Hobby ($5/mo flat) | ~$5 |
| Frontend service | Included in Hobby | ~$0 |
| Postgres | $0.000231/GB-hr | ~$1–3 |
| Redis | $0.000231/GB-hr | ~$1 |
| **Total** | | **~$7–10/month** |

Railway Hobby plan: $5/month gives 8GB RAM / 100GB bandwidth.
Much cheaper than GCP for low-to-medium traffic.

---

## GCP Cleanup (when ready)

Once Railway is stable, these GCP resources can be deleted to stop any charges:
- Cloud Run services (`xo-backend`, `xo-backend-staging`)
- Cloud SQL instance (`aiarena-db`)
- Memorystore Redis instance
- Artifact Registry images
- Firebase Hosting sites (keep if using for landing page)
