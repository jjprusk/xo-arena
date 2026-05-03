<!-- Copyright © 2026 Joe Pruskowski. All rights reserved. -->
# Clerk → Better Auth Migration Plan

## Overview

Replace Clerk authentication with Better Auth across the full stack. The migration preserves the existing stateless Bearer JWT token pattern, replicates Clerk's UI (sign-in modal, user button/popover), and handles existing user data via an email-based auto-link strategy on first sign-in.

Better Auth runs **in-process** alongside Express — no separate auth server. All user data stays in your own PostgreSQL database.

---

## Why Better Auth

| Requirement | Better Auth |
|---|---|
| Stateless Bearer JWT (SPA + API pattern) | ✅ JWT plugin — RS256, JWKS endpoint |
| Prisma adapter | ✅ Official, clean |
| OAuth (Google, Apple, GitHub) | ✅ 40+ providers |
| Email + password + verification | ✅ Built-in |
| CAPTCHA | ✅ Cloudflare Turnstile, hCaptcha, reCAPTCHA |
| Admin plugin (ban, roles) | ✅ Built-in |
| Self-hosted | ✅ In-process |
| License | MIT |

---

## Scope of Change

Clerk currently serves three roles that Better Auth must replace:

1. **Token issuer/verifier** — stateless asymmetric JWTs for HTTP and WebSocket auth
2. **User identity store** — profile data fetched via `clerk().users.getUser(userId)`
3. **Role/metadata store** — `publicMetadata.role === 'admin'` used everywhere

### Backend touch points
- `middleware/auth.js` — `clerkVerifyToken()`, `requireAuth`, `requireAdmin`, `isAdmin()`, `optionalAuth`
- `routes/users.js` — Clerk API call in `/sync` endpoint; ownership checks against `user.clerkId`
- `routes/admin.js` — creator lookup by `clerkId`
- `routes/ml.js` — model limit check uses `clerkId` to find user record
- `routes/games.js` — `getUserByClerkId()`
- `realtime/socketHandler.js` — second independent Clerk JWT verification path (PvP rooms)
- `services/userService.js` — `getUserByClerkId()`, `syncUser()` with Clerk params
- `prisma/schema.prisma` — `User.clerkId`, `MLModel.createdBy`, `MLPlayerProfile.userId` all store raw Clerk IDs

### Frontend touch points
- `main.jsx` — `<ClerkProvider>`
- `components/layout/AppLayout.jsx` — `useUser()`, `useAuth()`, `<SignedIn>`, `<SignedOut>`, `<SignInButton mode="modal">`, `<UserButton>`
- `components/admin/AdminRoute.jsx` — `user?.publicMetadata?.role === 'admin'`
- ~15 call sites using `window.Clerk?.session?.getToken()` or `useAuth().getToken()`
- `store/pvpStore.js` — `window.Clerk?.session?.getToken?.()` in Zustand actions (non-React context)

---

## Phase 1 — Package Changes

### Backend
```
# Remove
npm uninstall @clerk/backend

# Install
npm install better-auth @better-auth/prisma-adapter
```

### Frontend
```
# Remove
npm uninstall @clerk/clerk-react

# Install
npm install better-auth
```
Better Auth ships `better-auth/react` for hooks and `better-auth/client` for the browser client — no separate package installs needed.

---

## Phase 2 — Database Schema Migration

### Strategy: keep your `users` table, add `betterAuthId` foreign key

Do **not** merge into BA's user table. Your `users` table has 15+ domain-specific columns and is the FK target for `Game`, `UserEloHistory`, etc. Keeping the tables separate maintains a clean boundary between auth concerns (BA tables) and domain concerns (your table).

### New column on existing `User` model

```prisma
betterAuthId  String?  @unique   // null until user signs in post-migration
```

Keep `clerkId` in place during the cutover window. Drop it in a follow-up migration after all users have linked their BA identity.

### Four new Better Auth tables

Add to `schema.prisma` with `ba_` prefix to avoid colliding with your existing `users` table:

```prisma
model user {
  id            String    @id
  name          String
  email         String    @unique
  emailVerified Boolean
  image         String?
  role          String?   // "admin" | null — used by BA admin plugin
  createdAt     DateTime
  updatedAt     DateTime

  sessions  session[]
  accounts  account[]
  appUser   User?     @relation(fields: [id], references: [betterAuthId])

  @@map("ba_users")
}

model session {
  id        String   @id
  expiresAt DateTime
  token     String   @unique
  createdAt DateTime
  updatedAt DateTime
  ipAddress String?
  userAgent String?
  userId    String
  user      user     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("ba_sessions")
}

model account {
  id                    String    @id
  accountId             String
  providerId            String
  userId                String
  accessToken           String?
  refreshToken          String?
  idToken               String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  password              String?
  createdAt             DateTime
  updatedAt             DateTime
  user                  user      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("ba_accounts")
}

model verification {
  id         String    @id
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime?
  updatedAt  DateTime?

  @@map("ba_verifications")
}
```

### Migration file

Create: `backend/prisma/migrations/YYYYMMDDHHMMSS_add_better_auth_tables/migration.sql`

Adds `ba_users`, `ba_sessions`, `ba_accounts`, `ba_verifications` tables and `ALTER TABLE "users" ADD COLUMN "betterAuthId" TEXT UNIQUE`.

---

## Phase 3 — Backend Changes

### 3.1 New file: `backend/src/lib/auth.js`

Central Better Auth instance. All plugin config lives here.

```
betterAuth({
  database: prismaAdapter(db, { provider: 'postgresql', modelMapping: { user: 'ba_users', ... } }),
  plugins: [
    emailAndPassword({ requireEmailVerification: true }),
    jwt({ algorithm: 'RS256' }),
    admin({ adminRole: 'admin' }),
    captcha({ provider: 'cloudflare-turnstile', secretKey: process.env.TURNSTILE_SECRET_KEY }),
  ],
  socialProviders: {
    google: { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET },
  },
  trustedOrigins: [process.env.FRONTEND_URL],
  hooks: {
    after: [
      // after sign-up and OAuth callback: upsert app User row (replaces /users/sync)
    ]
  }
})
```

### 3.2 Mount BA handler in `backend/src/app.js`

```js
import { toNodeHandler } from 'better-auth/node'
import { auth } from './lib/auth.js'

app.all('/api/auth/*', toNodeHandler(auth))
// Must be mounted BEFORE express.json() middleware
```

Handles all auth endpoints: `/api/auth/sign-in/email`, `/api/auth/sign-up/email`, `/api/auth/callback/google`, `/api/auth/session`, `/api/auth/token` (JWT), `/api/auth/jwks`, etc.

### 3.3 Rewrite `backend/src/middleware/auth.js`

| Function | Old | New |
|---|---|---|
| Token verification | `clerkVerifyToken()` | `auth.api.verifyJWT({ token })` |
| `req.auth.userId` | Clerk user ID | BA `user.id` |
| `isAdmin(userId)` | `clerk.users.getUser()` → `publicMetadata.role` | `db.ba_users.findUnique()` → `role === 'admin'` |
| Ban check | None (Clerk didn't handle this) | `db.user.findUnique({ where: { betterAuthId } })` → `banned` |

`requireAuth`, `optionalAuth`, `requireAdmin`, `isAdmin` all remain as exports with the same signatures — only their internals change.

### 3.4 Rewrite `backend/src/routes/users.js` — `/sync` endpoint

Remove `clerk().users.getUser()`. Instead read from `db.ba_users` using `req.auth.userId`. The `syncUser` service function is updated to accept `betterAuthId` instead of `clerkId`.

The sync endpoint must also handle **existing Clerk users** returning post-migration via email-based fallback:

```
1. Find User by betterAuthId → found: return it
2. Not found: find User by email → found: update betterAuthId, return it  (auto-link)
3. Not found: create new User row
```

This means no batch migration script is needed for the `users` table — each user self-migrates on first sign-in.

Ownership checks throughout `users.js`:
- `user.clerkId === req.auth.userId` → `user.betterAuthId === req.auth.userId`

### 3.5 Update `backend/src/routes/admin.js`

- Creator lookup: `where: { clerkId: { in: creatorIds } }` → `where: { betterAuthId: { in: creatorIds } }`
- User list select: replace `clerkId: true` with `betterAuthId: true`

### 3.6 Update `backend/src/routes/ml.js`

- `checkModelLimit`: `where: { clerkId: req.auth.userId }` → `where: { betterAuthId: req.auth.userId }`
- All `createdBy` values are now BA user IDs (structurally unchanged — still `String?`)

### 3.7 Update `backend/src/routes/games.js`

- Replace `getUserByClerkId(req.auth.userId)` with `getUserByBetterAuthId(req.auth.userId)`

### 3.8 Update `backend/src/realtime/socketHandler.js`

Replace Clerk JWT verification in `resolveSocketUser`:

```js
// Remove: import { createClerkClient, verifyToken as clerkVerifyToken } from '@clerk/backend'
// Add:    import { auth } from '../lib/auth.js'

async function resolveSocketUser(token) {
  const result = await auth.api.verifyJWT({ token })
  if (!result?.user?.id) return null
  return getUserByBetterAuthId(result.user.id)
}
```

**This is the most easily missed change** — if skipped, PvP rooms break silently.

### 3.9 Update `backend/src/services/userService.js`

- Add `getUserByBetterAuthId(betterAuthId)` — `db.user.findUnique({ where: { betterAuthId } })`
- Update `syncUser()` — replace `clerkId` param with `betterAuthId`
- Keep `getUserByClerkId()` temporarily (used only by the data migration script in Phase 7)

---

## Phase 4 — Frontend Auth Context

### 4.1 New file: `frontend/src/lib/auth-client.js`

```js
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({ baseURL: '/api/auth' })

export const { useSession, signIn, signUp, signOut } = authClient
```

### 4.2 New file: `frontend/src/lib/getToken.js`

Single shared async helper replacing all ~15 `getToken()` call sites:

```js
import { authClient } from './auth-client.js'

export async function getToken() {
  try {
    const result = await authClient.getJWT()
    return result?.token ?? null
  } catch {
    return null
  }
}
```

This works in both React components and non-React contexts (Zustand store, etc.).

### 4.3 Replace all `getToken()` call sites

Delete the locally-defined `async function getToken()` in every admin page and replace with:
```js
import { getToken } from '../../lib/getToken.js'
```

| File | Instances |
|---|---|
| `AppLayout.jsx` | 1 (useAuth hook) |
| `ProfilePage.jsx` | 2 |
| `StatsPage.jsx` | 1 |
| `MLDashboardPage.jsx` | ~11 |
| `GameBoard.jsx` | 1 |
| `AIDashboardPage.jsx` | 2 |
| `LogViewerPage.jsx` | 1 |
| `pvpStore.js` | 2 (non-React — use `getToken()` directly) |
| `AdminDashboard.jsx` | local fn → import |
| `AdminGamesPage.jsx` | local fn → import |
| `AdminMLPage.jsx` | local fn → import |
| `AdminUsersPage.jsx` | local fn → import |

### 4.4 Replace `useUser()` / `useAuth()` with `useSession()`

```js
// Old (Clerk)
const { user, isSignedIn } = useUser()
const { getToken } = useAuth()
const isAdmin = user?.publicMetadata?.role === 'admin'

// New (Better Auth)
const { data: session, isPending } = useSession()
const isSignedIn = !!session && !isPending
const isAdmin = session?.user?.role === 'admin'
```

Field mapping:

| Clerk | Better Auth |
|---|---|
| `user.id` | `session.user.id` |
| `user.imageUrl` | `session.user.image` |
| `user.fullName` | `session.user.name` |
| `user.primaryEmailAddress.emailAddress` | `session.user.email` |
| `user.publicMetadata.role === 'admin'` | `session.user.role === 'admin'` |
| `isSignedIn` | `!!session && !isPending` |
| `isLoaded` | `!isPending` |

### 4.5 Update `frontend/src/main.jsx`

Remove `<ClerkProvider>`. BA requires no top-level provider — `useSession()` works standalone.

```jsx
// Before
<ClerkProvider publishableKey={CLERK_KEY}>
  <App />
</ClerkProvider>

// After
<App />
```

---

## Phase 5 — Auth UI Components

Clerk's pre-built UI (modal, `<UserButton>`) must be replicated. Use the existing CSS variable theming system so components automatically support dark/light mode.

### 5.1 New: `frontend/src/components/auth/AuthModal.jsx`

Replicates Clerk's combined sign-in/sign-up modal.

**Props:** `{ isOpen, onClose, defaultView = 'sign-in' }`

**Internal state:**
- `view`: `'sign-in' | 'sign-up' | 'verify-email'`
- `step`: `'email' | 'password'` (Clerk-style two-step sign-in)
- `email`, `password`, `confirmPassword`, `error`, `loading`

**Layout:**
```
Backdrop: fixed inset-0 z-50 bg-black/40 backdrop-blur-sm (click to close)
Card:     max-w-sm w-full rounded-2xl border shadow-2xl
          bg: var(--bg-surface)  border: var(--border-default)

  ┌─────────────────────────────────┐
  │  [Logo]  Sign in to XO Arena    │  ← header
  │  [Sign in] [Sign up]            │  ← tab row
  ├─────────────────────────────────┤
  │  [G] Continue with Google       │  ← social button
  │  ──────── or ────────           │  ← divider
  │  [Email input]                  │  ← step 1
  │  [Password input]               │  ← step 2 (after email submitted)
  │  [Continue / Sign in]           │  ← submit button
  │  Error message (if any)         │
  └─────────────────────────────────┘
```

**Sign-in flow:**
1. Step 1: user enters email → click Continue → validate email format → advance to step 2
2. Step 2: user enters password → click Sign in → call `signIn.email({ email, password })`
3. Success → `onClose()` → session updates automatically via `useSession()`

**Sign-up flow:**
- Single step: email + password + confirm password
- Call `signUp.email({ email, password, name: email.split('@')[0] })`
- Success → switch to `verify-email` view

**Verify email view:**
- "Check your email" message with inbox icon
- "Resend verification email" button

**Error display:** red text below form using `var(--color-red-600)`

**Keyboard:** `Escape` closes, `Enter` advances steps

### 5.2 New: `frontend/src/components/auth/GoogleSignInButton.jsx`

```
[SVG Google logo]  Continue with Google

Styles:
  w-full h-10 rounded-lg border
  bg: var(--bg-surface)  hover: var(--bg-surface-hover)
  border: var(--border-default)
  text: var(--text-primary)  text-sm font-medium

On click: signIn.social({ provider: 'google', callbackURL: '/play' })
```

Add the Cloudflare Turnstile captcha widget below the form. Pass the response token when calling `signIn` / `signUp`. BA's captcha plugin validates it server-side.

### 5.3 New: `frontend/src/components/auth/UserButton.jsx`

Replicates Clerk's `<UserButton>` exactly.

**Props:** `{ afterSignOutUrl = '/play' }`

**Trigger:** 32px circular avatar button
- Has image: `<img>` with `w-full h-full object-cover`, white `backgroundColor` wrapper
- No image: first letter of name, `var(--color-blue-100)` bg, `var(--color-blue-700)` text

**Popover card** (absolute-positioned below trigger):
```
min-w-[220px] rounded-xl border shadow-lg
bg: var(--bg-surface)  border: var(--border-default)

  ┌──────────────────────────────┐
  │  [Avatar 40px]               │
  │  Joe Smith                   │  ← session.user.name
  │  joe@example.com             │  ← session.user.email
  ├──────────────────────────────┤
  │  Manage account   →          │  ← link to /profile
  │  Admin Panel      ⚙          │  ← admin only, link to /admin
  ├──────────────────────────────┤
  │  Sign out                    │
  └──────────────────────────────┘
```

**Behavior:**
- Close on outside click (`useEffect` + `document.addEventListener('mousedown')`)
- Close on `Escape`
- Sign out: `signOut({ fetchOptions: { onSuccess: () => navigate(afterSignOutUrl) } })`
- Admin check: `session?.user?.role === 'admin'`

### 5.4 New: `frontend/src/components/auth/SignedIn.jsx`

```jsx
// Renders children only when session exists and is not loading
const { data: session, isPending } = useSession()
if (isPending || !session) return null
return children
```

### 5.5 New: `frontend/src/components/auth/SignedOut.jsx`

```jsx
// Renders children only when no session and not loading
const { data: session, isPending } = useSession()
if (isPending || session) return null
return children
```

### 5.6 Update `frontend/src/components/layout/AppLayout.jsx`

```js
// Remove
import { SignedIn, SignedOut, SignInButton, UserButton, useUser, useAuth } from '@clerk/clerk-react'

// Add
import { useSession } from '../../lib/auth-client.js'
import AuthModal from '../auth/AuthModal.jsx'
import UserButton from '../auth/UserButton.jsx'
import SignedIn from '../auth/SignedIn.jsx'
import SignedOut from '../auth/SignedOut.jsx'
```

```jsx
// Old
const { user, isSignedIn } = useUser()
const { getToken } = useAuth()
const isAdmin = user?.publicMetadata?.role === 'admin'

// New
const { data: session } = useSession()
const isAdmin = session?.user?.role === 'admin'
```

Replace sync `useEffect`:
```jsx
// Old: depends on isSignedIn from useUser
useEffect(() => {
  if (!isSignedIn) return
  getToken().then(token => api.users.sync(token)).catch(() => {})
}, [isSignedIn, getToken])

// New: depends on session user ID
useEffect(() => {
  if (!session?.user?.id) return
  getToken().then(token => api.users.sync(token)).catch(() => {})
}, [session?.user?.id])
```

Replace sign-in button and user button:
```jsx
// Old
<SignedOut>
  <SignInButton mode="modal"><button>Sign in</button></SignInButton>
</SignedOut>
<SignedIn>
  <UserButton afterSignOutUrl="/play">...</UserButton>
</SignedIn>

// New
const [authModalOpen, setAuthModalOpen] = useState(false)

<SignedOut>
  <button onClick={() => setAuthModalOpen(true)}>Sign in</button>
</SignedOut>
<AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
<SignedIn>
  <UserButton afterSignOutUrl="/play" />
</SignedIn>
```

### 5.7 Update `frontend/src/components/admin/AdminRoute.jsx`

```jsx
// Remove: useUser from @clerk/clerk-react
// Add:    useSession from ../../lib/auth-client.js

const { data: session, isPending } = useSession()
if (isPending) return <Spinner />
if (session?.user?.role !== 'admin') return <Navigate to="/play" replace />
return children
```

### 5.8 Update `frontend/src/pages/admin/AdminUsersPage.jsx`

The `isSelf` check:
```jsx
// Old
const isSelf = u.clerkId === currentUser?.id

// New
const isSelf = u.betterAuthId === session?.user?.id
```

---

## Phase 6 — Environment Variables

### Remove
```
CLERK_SECRET_KEY
CLERK_PUBLISHABLE_KEY
VITE_CLERK_PUBLISHABLE_KEY
```

### Add to `backend/.env`
```
BETTER_AUTH_SECRET=<random 32-byte hex>
BETTER_AUTH_URL=https://your-domain.com

# JWT key pair (auto-generated if omitted; set explicitly in production)
BETTER_AUTH_JWT_PRIVATE_KEY=<RS256 PEM>
BETTER_AUTH_JWT_PUBLIC_KEY=<RS256 PEM>

# OAuth
GOOGLE_CLIENT_ID=<...>
GOOGLE_CLIENT_SECRET=<...>

# Captcha
TURNSTILE_SECRET_KEY=<...>

# Email (for verification emails)
EMAIL_FROM=noreply@xo-arena.com
SMTP_HOST=<...>
SMTP_PORT=587
SMTP_USER=<...>
SMTP_PASS=<...>
```

### Add to `frontend/.env`
```
VITE_TURNSTILE_SITE_KEY=<...>
```

No `VITE_BETTER_AUTH_*` vars needed — the auth client uses `/api/auth` as a relative base URL, proxied by Vite to the backend in dev.

### Vite proxy (confirm in `vite.config.js`)
```js
server: {
  proxy: {
    '/api': 'http://localhost:3000',
  }
}
```

### Google OAuth redirect URI

Add to Google Cloud Console → Authorized redirect URIs:
```
https://your-domain.com/api/auth/callback/google
```
Must be done **before** cutover.

---

## Phase 7 — Data Migration

### 7.1 `users` table — auto-link strategy (no batch script needed)

Existing users have `clerkId` but `betterAuthId = NULL`. When they sign in post-migration with the same email, the `/users/sync` endpoint:
1. Looks up by `betterAuthId` → not found
2. Falls back to lookup by `email` → found
3. Sets `betterAuthId` on the existing row and returns it

Each user self-migrates on their first sign-in. No downtime or batch script required.

### 7.2 `MLModel.createdBy` and `MLPlayerProfile.userId`

These store raw Clerk IDs for existing rows. New rows store BA user IDs. Two options:

**Option A (simple):** Accept that pre-migration ML player profiles are not linked post-migration. Existing models still exist and train correctly; only the ownership attribution (who can delete/reset a model) is affected for pre-migration models with a `createdBy` that no longer maps to any user.

**Option B (thorough):** After the cutover window (1–2 weeks), run `backend/scripts/migrate-clerk-ids.js`:
```
For each MLModel where createdBy looks like a Clerk ID (user_*):
  Find User where clerkId = createdBy
  If found and user.betterAuthId is set:
    Update MLModel.createdBy = user.betterAuthId

Same for MLPlayerProfile.userId
```

### 7.3 Drop `clerkId` column

After all users have signed in at least once (confirmed via `WHERE betterAuthId IS NULL` count = 0, or after the migration script runs):

Create migration: `YYYYMMDDHHMMSS_drop_clerk_id`
```sql
ALTER TABLE "users" DROP COLUMN "clerkId";
```

Also remove `getUserByClerkId()` from `userService.js`.

---

## Phase 8 — New Files Summary

| File | Purpose |
|---|---|
| `backend/src/lib/auth.js` | Better Auth instance — all plugin config |
| `backend/scripts/migrate-clerk-ids.js` | Optional post-cutover data migration |
| `frontend/src/lib/auth-client.js` | BA browser client, re-exports hooks |
| `frontend/src/lib/getToken.js` | Shared token helper — replaces all `getToken()` call sites |
| `frontend/src/components/auth/AuthModal.jsx` | Sign-in / sign-up modal (Clerk replica) |
| `frontend/src/components/auth/GoogleSignInButton.jsx` | Social OAuth button |
| `frontend/src/components/auth/UserButton.jsx` | Avatar button + popover (Clerk replica) |
| `frontend/src/components/auth/SignedIn.jsx` | Conditional render — authenticated |
| `frontend/src/components/auth/SignedOut.jsx` | Conditional render — unauthenticated |

---

## Phase 9 — Cutover Strategy

### Pre-cutover (days before)
1. Run the additive Prisma migration (adds `ba_*` tables + `betterAuthId` column) — zero downtime
2. Add Google OAuth redirect URI to Google Cloud Console
3. Configure SMTP provider for verification emails
4. Set all new env vars in production
5. Deploy backend with BA mounted alongside Clerk — test BA sign-up/sign-in independently without removing Clerk
6. Test full flow in staging

### Cutover window (1–2 hours)
1. Deploy backend with `@clerk/backend` removed; all auth middleware points to BA
2. Deploy frontend with `@clerk/clerk-react` removed; new auth UI active
3. Smoke test: sign-in, sign-up, OAuth, admin routes, game recording, PvP room creation, ML model creation
4. Remove maintenance mode

### Post-cutover (1–2 weeks)
1. Monitor `WHERE betterAuthId IS NULL` count — should trend to zero as users sign in
2. Optionally run `migrate-clerk-ids.js` for ML profile ownership
3. Confirm zero NULL `betterAuthId` rows
4. Run `drop_clerk_id` migration
5. Remove `getUserByClerkId()` from `userService.js`
6. Remove all Clerk env vars from production

---

## Critical Files — Highest Risk of Breakage

| File | Risk | Why |
|---|---|---|
| `backend/src/realtime/socketHandler.js` | 🔴 High | Second independent JWT path — easy to miss; PvP rooms break silently |
| `backend/src/middleware/auth.js` | 🔴 High | All backend route protection flows through here |
| `backend/prisma/schema.prisma` | 🔴 High | Schema change drives everything |
| `backend/src/services/userService.js` | 🟡 Medium | `syncUser` called on every session; wrong ID breaks ownership everywhere |
| `frontend/src/store/pvpStore.js` | 🟡 Medium | Non-React context — can't use hooks; must use shared `getToken()` utility |
| `frontend/src/components/layout/AppLayout.jsx` | 🟡 Medium | Central auth integration point |

---

## Key Design Decisions

**Why keep separate `users` and `ba_users` tables?**
BA's `additionalFields` would merge auth and domain data into one table, making future auth migrations harder. Two tables keep concerns separated at the cost of one extra DB join.

**Why JWT plugin over session cookies?**
The existing pattern is stateless Bearer tokens. WebSocket transport passes `authToken` directly. Converting to cookies would require rethinking Socket.io auth. JWT preserves the architecture with minimal disruption.

**Why Cloudflare Turnstile over reCAPTCHA?**
Turnstile is the least intrusive to users (often invisible, no "click the buses" challenges), GDPR-friendly, and is a first-class BA captcha plugin option.

**Why email-based auto-link over a batch migration script for `users`?**
A batch script requires a maintenance window and access to the Clerk API export. Email-based auto-link is zero-downtime and self-healing — each user migrates themselves on first sign-in with no admin intervention.
