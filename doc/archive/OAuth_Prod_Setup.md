<!-- Copyright © 2026 Joe Pruskowski. All rights reserved. -->
# OAuth Prod Setup — Google & Apple

> Standalone runbook for wiring Sign In with Google and Sign In with Apple into the prod stack (`xo-backend-prod` + `aiarena.callidity.com`). Apply once during prod bringup, or whenever the prod custom domain changes.

Better Auth's callback URL pattern is fixed: `https://<host>/api/auth/callback/<provider>`. Every redirect URI you register at a provider must match this shape exactly (https, no trailing slash, no path drift).

## Choose a path

- **Path A — Reuse staging's OAuth apps.** Fastest. Copy staging secrets to prod, add the prod callback URL alongside the staging one at each provider. Risk: rotating either side rotates both.
- **Path B — Fresh prod OAuth apps.** Cleaner. Independent client IDs, secrets, and callback registrations — staging and prod can be rotated independently. Recommended once you have any real users.

---

## Path A — Reuse staging credentials

```sh
# Copy from staging to prod
for k in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET \
         APPLE_CLIENT_ID APPLE_CLIENT_SECRET APPLE_KEY_ID APPLE_TEAM_ID APPLE_PRIVATE_KEY \
         RESEND_API_KEY; do
  v=$(fly ssh console -a xo-backend-staging -C "printenv $k" 2>/dev/null | tail -1 | tr -d '\r')
  [ -n "$v" ] && fly secrets set "$k=$v" -a xo-backend-prod
done
```

Then at each provider, add the prod callback URL alongside the staging one:

- **Google Cloud Console** → APIs & Services → Credentials → existing OAuth client → Authorized redirect URIs:
  - `https://aiarena.callidity.com/api/auth/callback/google`
  - `https://xo-backend-prod.fly.dev/api/auth/callback/google` *(fallback)*

- **Apple Developer** → Certificates, IDs & Profiles → Identifiers → existing Services ID → Configure Sign In with Apple:
  - Domains: add `aiarena.callidity.com`
  - Return URLs: add `https://aiarena.callidity.com/api/auth/callback/apple`

Done — proceed to **Verify** below.

---

## Path B — Fresh prod OAuth apps

### 1. Google

In Google Cloud Console (same project as staging is fine, or a new one):

1. APIs & Services → Credentials → **Create credentials → OAuth 2.0 Client ID**, type **Web application**.
2. **Authorized JavaScript origins:**
   - `https://aiarena.callidity.com`
   - `https://xo-backend-prod.fly.dev`
3. **Authorized redirect URIs:**
   - `https://aiarena.callidity.com/api/auth/callback/google`
   - `https://xo-backend-prod.fly.dev/api/auth/callback/google`
4. Save. Copy the **Client ID** and **Client Secret** (the secret is shown once on creation; you can also download the JSON later from the credential row).

### 2. Apple

Apple's "client secret" is not a single string — it's a JWT signed on the fly from four pieces of secret material. Collect all four.

1. Apple Developer portal → Certificates, IDs & Profiles → **Identifiers** → **+** → **Services IDs**.
   - Choose a recognizable identifier (e.g. `com.callidity.aiarena.web`). This becomes `APPLE_CLIENT_ID`.
   - Enable **Sign In with Apple**, click **Configure**:
     - **Domains:** `aiarena.callidity.com`
     - **Return URLs:** `https://aiarena.callidity.com/api/auth/callback/apple`
2. Apple Developer portal → **Keys** → **+** → enable **Sign In with Apple**, choose the primary App ID, register.
   - Download the `.p8` immediately — **Apple will not let you re-download it**.
   - Note the **Key ID** (10 chars). This becomes `APPLE_KEY_ID`.
3. **Team ID** (10 chars) — top-right of the Apple Developer portal. This becomes `APPLE_TEAM_ID`. (Same value across all your Apple apps; reuse staging's.)

### 3. Resend (transactional email — optional but recommended)

Better Auth sends verification emails on first signup via Resend. If you want fresh isolation:

- Resend dashboard → **API Keys** → **Create API Key**. Save it as `RESEND_API_KEY`.

If you don't, Path A's staging-shared key works for prod too.

### 4. Set the prod secrets

```sh
fly secrets set -a xo-backend-prod \
  GOOGLE_CLIENT_ID="..." \
  GOOGLE_CLIENT_SECRET="..." \
  APPLE_CLIENT_ID="com.callidity.aiarena.web" \
  APPLE_TEAM_ID="..." \
  APPLE_KEY_ID="..." \
  APPLE_PRIVATE_KEY="$(cat AuthKey_<KEYID>.p8)" \
  RESEND_API_KEY="re_..."
```

> If your Better Auth setup expects a pre-baked JWT in `APPLE_CLIENT_SECRET` instead of generating it from the `.p8`, run `scripts/generate-apple-secret.mjs` first and paste its output as `APPLE_CLIENT_SECRET`. The default Better Auth Apple plugin signs the JWT for you on each auth call — no separate secret needed.

After `fly secrets set`, the backend machines auto-restart with the new env. Wait ~10 seconds, then verify.

---

## Verify

Browse to `https://aiarena.callidity.com`, click Sign in.

- **Google** — should land at the account chooser, then bounce back signed in.
- **Apple** — should land at Apple's confirmation, then bounce back signed in.

Common failures:

- **Google: `redirect_uri_mismatch`** — the URI in Cloud Console doesn't byte-match the callback (https vs http, trailing slash, hostname typo). Fix the Console entry; it propagates immediately.
- **Apple: `invalid_client`** — the Services ID, Team ID, or Key ID don't match the `.p8` you uploaded as `APPLE_PRIVATE_KEY`. Re-check all four values.
- **Apple: `invalid_grant`** — the JWT signed with the `.p8` is being rejected, usually because the Services ID's domain config doesn't include the callback host. Re-open the Services ID, click Configure, ensure `aiarena.callidity.com` is in Domains.

---

## Rollback

To revoke prod's auth without rotating staging:

- **Path A** — at each provider, remove the prod callback URLs from the existing OAuth client. Prod sign-in immediately fails; staging keeps working.
- **Path B** — delete the prod-specific OAuth client at Google and the prod-specific Services ID + Key at Apple. Or simpler: `fly secrets unset GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET APPLE_CLIENT_ID APPLE_TEAM_ID APPLE_KEY_ID APPLE_PRIVATE_KEY -a xo-backend-prod` to disable auth on prod without touching the providers.
