# Domain, DNS & OAuth Setup Guide

## Architecture Overview

```
GoDaddy:
  aiarena.callidity.com          → Railway landing service  (platform, auth, tournaments)
  *.aiarena.callidity.com        → Railway gateway service  (routes by subdomain to each game)

Railway services:
  landing    ← aiarena.callidity.com        (auth UI lives here only)
  gateway    ← *.aiarena.callidity.com      (reverse proxy — reads Host header, routes to game)
  xo         ← internal Railway URL only    (no custom domain — only reachable via gateway)
  chess      ← internal Railway URL only    (future)
```

**Key principles:**
- Sign-in happens **only** on `aiarena.callidity.com`. Game subdomains never handle auth.
- Sessions are shared via a `.aiarena.callidity.com` cookie — sign in once, all subdomains inherit the session.
- Adding a new game = deploy a Railway service + add one line to the gateway config. No DNS changes ever again.
- Game services have no custom domains — they're internal to Railway, only the gateway faces the internet.

---

## GoDaddy DNS Records

Root domain in GoDaddy is `callidity.com`. The "Host" column is what you enter in the GoDaddy UI.

| Host | Type | Points To |
|---|---|---|
| `aiarena` | CNAME | Railway landing service URL |
| `*.aiarena` | CNAME | Railway gateway service URL |
| `staging.aiarena` | CNAME | Railway landing-staging service URL |
| `*.staging.aiarena` | CNAME | Railway gateway-staging service URL |

4 records total. Never changes again regardless of how many games are added.

> **Note:** The wildcard `*.aiarena` covers `xo.aiarena.callidity.com`, `chess.aiarena.callidity.com`, etc. but does NOT cover `aiarena.callidity.com` itself — that's the separate `aiarena` record.

---

## Railway — Custom Domain Config

For each custom domain you point at a service, Railway generates a CNAME target you paste into GoDaddy.

| Railway Service | Custom Domain |
|---|---|
| `landing` (prod) | `aiarena.callidity.com` |
| `gateway` (prod) | `*.aiarena.callidity.com` |
| `landing` (staging) | `staging.aiarena.callidity.com` |
| `gateway` (staging) | `*.staging.aiarena.callidity.com` |

> **Check your Railway plan** — wildcard custom domains require Railway Pro tier.

---

## Google OAuth (Google Cloud Console)

Since sign-in only happens on `aiarena.callidity.com`, Google only needs to know about that domain. Game subdomains are invisible to it.

**Authorized JavaScript Origins:**
```
https://aiarena.callidity.com
https://staging.aiarena.callidity.com
http://localhost:5173
```

**Authorized Redirect URIs:**
```
https://aiarena.callidity.com/api/auth/callback/google
https://staging.aiarena.callidity.com/api/auth/callback/google
http://localhost:5173/api/auth/callback/google
```

---

## Apple OAuth (Apple Developer Console)

Apple is more involved — it requires domain ownership verification and only works on real HTTPS domains.

### Step 1 — App ID
In *Certificates, Identifiers & Profiles → Identifiers*, find your App ID and confirm **Sign In with Apple** capability is enabled.

### Step 2 — Service ID
Create a new Service ID (this is what web OAuth uses, separate from the native app):
- **Identifier:** `com.callidity.aiarena.web` (or similar)
- Enable **Sign In with Apple**
- Click **Configure:**
  - Primary App ID: your App ID from Step 1
  - **Domains:** `aiarena.callidity.com` and `staging.aiarena.callidity.com`
  - **Return URLs:**
    ```
    https://aiarena.callidity.com/api/auth/callback/apple
    https://staging.aiarena.callidity.com/api/auth/callback/apple
    ```
  - Apple will show a **Download** button for the domain verification file

### Step 3 — Domain Verification File
Apple requires a file hosted at a specific path on each registered domain:
```
https://aiarena.callidity.com/.well-known/apple-developer-domain-association.txt
https://staging.aiarena.callidity.com/.well-known/apple-developer-domain-association.txt
```

Add the downloaded file to both landing services:
```
landing/public/.well-known/apple-developer-domain-association.txt
```
The Express static middleware serves `public/` automatically — no code changes needed.

> **Important:** The domain must be live with HTTPS before Apple's verification will succeed. Configure Apple Sign In *after* the custom domains are live on Railway.

### Step 4 — Private Key
In *Keys*, create a key with **Sign In with Apple** enabled. Download the `.p8` file — **Apple only lets you download it once.** Store it securely.

---

## Backend Environment Variables

```bash
# Auth base URL — must match the landing site's custom domain
BETTER_AUTH_URL=https://aiarena.callidity.com

# Allowed CORS origins — comma-separated, covers landing + all game subdomains
FRONTEND_URL=https://aiarena.callidity.com,https://xo.aiarena.callidity.com

# Shared session cookie — the one change that makes cross-subdomain auth work
BETTER_AUTH_COOKIE_DOMAIN=.aiarena.callidity.com

# Google (already configured)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# Apple (new)
APPLE_CLIENT_ID=com.callidity.aiarena.web    # Service ID from Step 2
APPLE_PRIVATE_KEY=<contents of .p8 file>
APPLE_KEY_ID=<10-char key ID from Apple Developer console>
APPLE_TEAM_ID=<10-char team ID from Apple Developer console>
```

Staging gets the same vars with `staging.aiarena.callidity.com` substituted where appropriate.

---

## Gateway Service — Adding a New Game

The gateway is a small Express reverse proxy. Adding a game is one line:

```js
const GAMES = {
  'xo':    'https://xo-frontend.up.railway.app',
  'chess': 'https://chess-frontend.up.railway.app',  // ← add this line
}

app.use((req, res) => {
  const sub = req.hostname.split('.')[0]
  const target = GAMES[sub]
  if (!target) return res.status(404).send('Unknown game')
  proxy.web(req, res, { target })
})
```

No DNS changes. No Railway custom domain changes. Deploy the gateway update and the new subdomain is live.

---

## Tournament Service — Railway Setup

The tournament service lives in `tournament/` in this monorepo and is deployed as its own Railway service.

### Step 1 — Create the Railway service

In the Railway dashboard, add a new service to the project:
- **Source:** this GitHub repo
- **Builder:** Dockerfile
- **Dockerfile path:** `tournament/Dockerfile`
- **Watch paths:** `tournament/**`, `packages/db/**`

Railway will detect `tournament/railway.json` automatically if you use the Railway CLI (`railway up`).

### Step 2 — Environment variables

Set these on the **tournament** Railway service:

```bash
DATABASE_URL=<same Postgres instance as backend>
REDIS_URL=<same Redis instance as backend>
FRONTEND_URL=https://aiarena.callidity.com,https://xo.aiarena.callidity.com
PORT=<set by Railway automatically — do not override>
```

For staging:
```bash
FRONTEND_URL=https://staging.aiarena.callidity.com,https://xo.staging.aiarena.callidity.com
```

### Step 3 — Wire TOURNAMENT_URL into other services

Once the tournament service is deployed, Railway gives it an internal URL (e.g. `https://tournament-production.up.railway.app`). Set this on:

| Service | Variable | Value |
|---|---|---|
| `landing` | `TOURNAMENT_URL` | `https://tournament-production.up.railway.app` |
| `backend` | *(no HTTP calls — uses Redis pub/sub directly)* | — |

### Step 4 — No DNS changes needed

The tournament service has no custom domain — it is internal to Railway, only reachable by other Railway services and the landing's Vite proxy. No GoDaddy records needed.

### Adding a second game's tournament service

Each game can share this same tournament service (the `game` field on `Tournament` distinguishes them), or run its own. To share: the new game's landing/backend just needs `TOURNAMENT_URL` pointing at this same service.

---

## Local Dev — All Services

All six services run via `docker compose up`:

| Service | Port | Purpose |
|---|---|---|
| postgres | 5432 | Shared database |
| redis | 6379 | Pub/sub + caching |
| backend | 3000 | Auth, game API, sockets |
| tournament | 3001 | Tournament CRUD, classification, matches |
| frontend (xo) | 5173 | XO game UI |
| landing | 5174 | AI Arena platform UI |

Cross-site env vars set in `docker-compose.yml`:
- `frontend`: `VITE_PLATFORM_URL=http://localhost:5174`
- `landing`: `VITE_XO_URL=http://localhost:5173`, `TOURNAMENT_URL=http://tournament:3001`
- `backend`: `FRONTEND_URL=http://localhost:5173,http://localhost:5174`
- `tournament`: `FRONTEND_URL=http://localhost:5174,http://localhost:5173`

---

## Order of Operations

1. Get Railway custom domain CNAME targets (from each service's Settings → Domains)
2. Add the 4 GoDaddy records pointing at those targets
3. Wait for DNS propagation (5 min to a few hours — verify with `dig aiarena.callidity.com`)
4. Confirm Railway shows the domains as verified with valid SSL
5. Deploy the Apple domain verification file to the landing service
6. Configure Apple Service ID — register domains and return URLs (domain must be live first)
7. Configure Google — add origins and redirect URIs (no domain verification needed)
8. Update backend env vars (`BETTER_AUTH_COOKIE_DOMAIN`, `BETTER_AUTH_URL`, Apple vars)
9. Redeploy backend
10. Test: sign in on `aiarena.callidity.com`, navigate to `xo.aiarena.callidity.com` — session should carry over automatically
