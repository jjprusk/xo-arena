# XO Arena — Admin System Design

## Overview

A lightweight admin layer built on top of Clerk's native role system. Admins are designated in the Clerk dashboard; the backend enforces access via a `requireAdmin` middleware; the frontend reveals admin UI based on the user's Clerk public metadata.

No database schema changes are required for the role itself — Clerk owns the source of truth for who is an admin.

---

## Role Assignment

Admins are assigned in the **Clerk Dashboard → Users → Edit user → Public metadata**:

```json
{ "role": "admin" }
```

This metadata is signed into the session JWT and available on both sides without an extra DB lookup.

---

## Backend

### Middleware

**`backend/src/middleware/auth.js`** — add alongside existing `requireAuth`:

```js
export function requireAdmin(req, res, next) {
  if (!req.auth?.userId) return res.status(401).json({ error: 'Unauthorized' })
  const role = req.auth.sessionClaims?.metadata?.role
  if (role !== 'admin') return res.status(403).json({ error: 'Forbidden' })
  next()
}
```

Apply to any admin route:

```js
router.get('/users', requireAdmin, async (req, res, next) => { ... })
```

### Routes to create — `backend/src/routes/admin.js`

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/admin/users` | List all users (paginated, searchable) |
| `GET` | `/admin/users/:id` | Full user profile incl. email, ELO, game count |
| `PATCH` | `/admin/users/:id` | Adjust ELO, set `banned` flag, update role |
| `DELETE` | `/admin/users/:id` | Delete user and associated data |
| `GET` | `/admin/stats` | Platform-wide stats (DAU, total games, active sessions) |
| `GET` | `/admin/games` | Paginated game log across all users |
| `GET` | `/admin/games/:id` | Full move history for any game |
| `DELETE` | `/admin/games/:id` | Delete a game record |
| `PATCH` | `/admin/ml/models/:id` | Feature/unfeature a model, hard-delete any model |
| `POST` | `/admin/ml/limits` | Set global training caps (max episodes, concurrent sessions) |
| `GET` | `/admin/puzzles/flagged` | List player-flagged puzzles |
| `POST` | `/admin/puzzles` | Add a hand-crafted puzzle to the curated set |
| `DELETE` | `/admin/puzzles/:id` | Remove a puzzle |
| `POST` | `/admin/maintenance` | Toggle maintenance mode (disables new game creation) |

### Existing routes to lock down

These already exist but have **no server-side auth** — they need `requireAdmin` added immediately:

| Route file | Path |
|------------|------|
| `routes/adminAi.js` | `/admin/ai/*` |
| `routes/logs.js` | `/logs/*` |

### Banning

Add a `banned` boolean to the `User` model (migration required). The `requireAuth` middleware should check for this flag after validating the JWT:

```js
const dbUser = await db.user.findUnique({ where: { clerkId: req.auth.userId } })
if (dbUser?.banned) return res.status(403).json({ error: 'Account suspended' })
```

---

## Frontend

### Role detection

```js
// In any component:
const { user } = useUser()
const isAdmin = user?.publicMetadata?.role === 'admin'
```

### Nav link

The admin nav entry (already in the sidebar as `/admin/ai` and `/admin/logs`) should be:
- Hidden entirely for non-admins
- Grouped under a single collapsible **Admin** section in the nav

### Pages to create

| Route | Component | Purpose |
|-------|-----------|---------|
| `/admin` | `AdminDashboard` | Platform stats overview |
| `/admin/users` | `AdminUsersPage` | User table with search, sort, inline actions |
| `/admin/users/:id` | `AdminUserDetailPage` | Full user profile view for any user — same panels as the user's own Profile page (stats, credits/tier, bots, game history) plus admin-only actions (ban, ELO adjust, override limits) |
| `/admin/games` | `AdminGamesPage` | Global game log |
| `/admin/puzzles` | `AdminPuzzlesPage` | Curated puzzle management |
| `/admin/ai` | existing `AIDashboardPage` | AI metrics (already exists, needs auth gate) |
| `/admin/logs` | existing `LogViewerPage` | Log viewer (already exists, needs auth gate) |

### Route guard component

Wrap all `/admin/*` routes with a guard that redirects non-admins:

```jsx
function AdminRoute({ children }) {
  const { user, isLoaded } = useUser()
  if (!isLoaded) return <Spinner />
  if (user?.publicMetadata?.role !== 'admin') return <Navigate to="/play" replace />
  return children
}
```

Apply in `App.jsx`:

```jsx
<Route path="/admin/*" element={<AdminRoute><AdminLayout /></AdminRoute>} />
```

---

## Database changes

Only one migration is needed for the features above:

```prisma
model User {
  // ... existing fields ...
  banned    Boolean  @default(false)
  role      String   @default("user")   // "user" | "admin" — mirrors Clerk metadata
}
```

The `role` field in the DB is a convenience cache (for queries like "list all admins") — Clerk's JWT metadata remains the authoritative source for access control decisions.

---

## Feature scope by phase

### Phase 1 — Security foundation (do first)
- [ ] Add `requireAdmin` middleware
- [ ] Lock down existing `/admin/ai` and `/logs` routes
- [ ] Add frontend `AdminRoute` guard
- [ ] Add banned flag to User model + ban enforcement in `requireAuth`

### Phase 2 — User management
- [ ] `GET/PATCH/DELETE /admin/users` routes
- [ ] `AdminUsersPage` — search, view, ban, ELO adjust
- [ ] `AdminUserDetailPage` — clicking any user in the list opens their full profile; reuses existing profile components with an admin action panel appended

### Phase 3 — Observability
- [ ] `GET /admin/stats` route (DAU, total games, active ML sessions)
- [ ] `AdminDashboard` with platform metrics
- [ ] `GET /admin/games` global game log

### Phase 4 — ML governance
- [ ] Feature/unfeature models
- [ ] Global training limits
- [ ] Model hard-delete (with cascade)

### Phase 5 — Puzzle curation
- [ ] Hand-crafted puzzle storage (DB table)
- [ ] `AdminPuzzlesPage` — add/remove/flag curated puzzles
- [ ] Player-side "flag this puzzle" button
