# In-App Feedback & Bug Report System

## Overview

A lightweight mechanism for users to submit feedback or bug reports from any page.
Admins are notified in real-time and can review, reply to, and dismiss submissions
from a dedicated inbox in the Admin panel.

**The system is designed to be pluggable** — the backend API, database schema, and
frontend components are game-agnostic. A future game can wire in the same feedback
infrastructure by pointing at the same backend and passing its own `appId`. The admin
inbox filters by `appId` so submissions from different games stay organized in one place.
The frontend components (`FeedbackButton`, `FeedbackModal`) accept an `appId` prop and
have no XO Arena-specific imports or logic, making them copy-paste portable.

**A dedicated `SUPPORT` role** allows non-admin staff to handle user feedback and basic
account actions without accessing the full admin panel. Admins grant the role from the
Users page (same toggle pattern as `BOT_ADMIN` / `TOURNAMENT_ADMIN`). Support users see
a focused, stripped-down interface — just the tools they need, nothing else.

---

## 1. User Flow

1. A small floating **feedback button** (💬 or a bug icon) sits in the bottom-right
   corner of every page, above the mobile bottom nav.
2. Clicking it opens a **modal** with:
   - A textarea: "Describe the issue or feedback"
   - An optional **"Attach screenshot"** toggle — when enabled, captures the current
     page as an image before the modal opens (so the modal itself isn't in the shot)
   - A screenshot thumbnail preview (dismissible)
   - Category selector: `Bug` · `Suggestion` · `Other`
   - Submit button
3. On submit, a success toast is shown and the modal closes.
4. Anonymous submissions are allowed (no login required), but if the user is signed in
   their identity is attached automatically.

---

## 2. Screenshot Capture

Use **`html2canvas`** (not currently a dependency — add it). Capture happens *before*
the modal mounts so the feedback UI itself doesn't appear in the image.

**Compression**: Before storing, scale the canvas down to max 800px wide at 0.7 JPEG
quality (`canvas.toDataURL('image/jpeg', 0.7)`). This keeps most screenshots under
~80–120KB, making base64-in-DB acceptable for MVP.

**Mobile**: `html2canvas` has known issues on mobile (cross-origin images, CSS
transforms, fixed positioning). **Skip screenshot capture on mobile** — detect via
`'ontouchstart' in window` or `window.innerWidth < 768`. Show a note in the modal:
*"Screenshot not available on mobile."* This is acceptable for MVP; screenshots are a
nice-to-have, not essential.

**Storage**: base64 JPEG stored in DB as `screenshotData Text?` is fine for MVP given
compressed size and infrequent usage. If the `feedback` table grows large, add a
separate migration to move `screenshotData` to Railway object storage or S3 — but
don't over-engineer now.

---

## 3. Database Schema

`appId` is a free-form string (e.g. `"xo-arena"`, `"next-game"`) that tags every
submission by source. It has no foreign key — adding a new game requires no migration,
just a new string value. The admin inbox filters on it.

```prisma
model Feedback {
  id             String           @id @default(cuid())
  appId          String           @default("xo-arena")  // which game/app submitted this
  userId         String?                                 // null for anonymous
  user           User?            @relation(fields: [userId], references: [id], onDelete: SetNull)
  category       FeedbackCategory @default(OTHER)
  status         FeedbackStatus   @default(OPEN)         // workflow state
  message        String
  pageUrl        String                                  // window.location.href at submission
  screenshotData String?          @db.Text               // base64 JPEG, nullable
  userAgent      String?
  resolutionNote String?                                 // internal staff note on resolution
  resolvedAt     DateTime?                               // set when status → RESOLVED
  resolvedById   String?                                 // staff member who resolved
  archivedAt     DateTime?                               // set when archived
  createdAt      DateTime         @default(now())
  readAt         DateTime?                               // null = unread
  replies        FeedbackReply[]

  @@index([appId])
  @@index([status])
  @@index([createdAt])
  @@index([readAt])
  @@index([archivedAt])
  @@map("feedback")
}

enum FeedbackStatus {
  OPEN        // newly received, not yet acted on
  IN_PROGRESS // being looked at
  RESOLVED    // resolved with an optional note
  WONT_FIX    // acknowledged but will not be addressed
}

model FeedbackReply {
  id         String   @id @default(cuid())
  feedbackId String
  feedback   Feedback @relation(fields: [feedbackId], references: [id], onDelete: Cascade)
  adminId    String
  message    String
  createdAt  DateTime @default(now())

  @@index([feedbackId])
  @@map("feedback_replies")
}

enum FeedbackCategory {
  BUG
  SUGGESTION
  OTHER
}
```

Migration name: `20260XXX_add_feedback`

No schema change is needed for the `SUPPORT` role — it uses the existing `UserRole`
table (same as `BOT_ADMIN`, `TOURNAMENT_ADMIN`).

---

## 4. Backend API

### Public & support-accessible endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/feedback` | public, rate-limited | Submit feedback; triggers thank-you email if user has a verified address |
| `GET` | `/api/v1/me/roles` | `requireAuth` | Returns `{ roles: string[] }` — domain roles for the current user |

The `/api/v1/me/roles` endpoint is needed because Better Auth's session only exposes
`role: 'admin'` (the BA-level role). Domain roles like `SUPPORT`, `BOT_ADMIN`, and
`TOURNAMENT_ADMIN` live in the `UserRole` table and are not in the JWT. The frontend
fetches this once on sign-in and caches it in a Zustand store.

### Admin-only endpoints (require `requireAdmin`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/admin/feedback` | List feedback (paginated, filter by appId/category/read) |
| `GET` | `/api/v1/admin/feedback/unread-count` | Returns `{ count }` — filterable by appId |
| `PATCH` | `/api/v1/admin/feedback/:id/read` | Mark as read |
| `POST` | `/api/v1/admin/feedback/:id/reply` | Add admin reply |
| `DELETE` | `/api/v1/admin/feedback/:id` | Hard delete |

### Support-accessible endpoints (require `requireSupport`)

`requireSupport` passes if the user is `ADMIN` **or** `SUPPORT` — the same escalation
pattern already used by `requireTournament`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/support/feedback` | List feedback — filterable by `appId`, `status`, `category`, `archived`, date range; sortable by `createdAt`, `status`, `category`, `appId` |
| `GET` | `/api/v1/support/feedback/unread-count` | Unread count for badge; accepts `?groupByApp=true` |
| `PATCH` | `/api/v1/support/feedback/:id/read` | Mark as read |
| `PATCH` | `/api/v1/support/feedback/:id/status` | Update status (`OPEN` / `IN_PROGRESS` / `RESOLVED` / `WONT_FIX`) + optional `resolutionNote` |
| `PATCH` | `/api/v1/support/feedback/:id/archive` | Archive (sets `archivedAt`) or unarchive (clears it) |
| `PATCH` | `/api/v1/support/feedback/archive-many` | Bulk archive — accepts `{ ids: string[] }` |
| `POST` | `/api/v1/support/feedback/:id/reply` | Add reply |
| `DELETE` | `/api/v1/support/feedback/:id` | Delete |
| `GET` | `/api/v1/support/users` | Lightweight user search (id, name, email, banned) |
| `PATCH` | `/api/v1/support/users/:id/ban` | Ban / unban a user |

Support cannot: delete users, change roles, adjust ELO, access ML/bots/AI/logs.

**Sort parameters** for `GET /api/v1/support/feedback`:
- `?sort=createdAt&dir=desc` (default) — newest first
- `?sort=status` — groups by workflow state
- `?sort=category` — groups bug reports together, etc.
- `?sort=appId` — groups by game (useful when "All" is selected)
- Combined with `?appId=`, `?status=OPEN`, `?archived=false` (default) / `?archived=true`

### Backend role changes

`backend/src/utils/roles.js`:
```js
export const VALID_ROLES = ['ADMIN', 'BOT_ADMIN', 'TOURNAMENT_ADMIN', 'SUPPORT']
```

`backend/src/middleware/auth.js` — add alongside `isAdmin` / `isTournament`:
```js
export async function isSupport(userId) { /* ADMIN or SUPPORT in userRoles */ }
export async function requireSupport(req, res, next) { /* 401/403 guard */ }
```

**Rate limiting**: No rate-limiter is currently in the codebase. Add
`express-rate-limit` (in-memory store is fine — single Railway instance for now).
Apply 3 requests per IP per 60 minutes to `POST /api/v1/feedback` only.
If Railway scales to multiple instances later, swap the store for `rate-limit-redis`
(ioredis is already a dependency).

```js
import rateLimit from 'express-rate-limit'
const feedbackLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 3 })
router.post('/feedback', feedbackLimiter, handleSubmit)
```

### Thank-you email on submission

Resend is already integrated (used for verification and password reset). After saving
the `Feedback` row, the handler fires a thank-you email **if and only if** the
submission is from an authenticated user with a verified email address. Anonymous
submissions and unverified accounts are silently skipped — no error, no retry.

```js
// Inside POST /api/v1/feedback handler, after db.feedback.create(...)
if (userId && user?.email && user?.emailVerified) {
  await resend.emails.send({
    from:    'XO Arena <support@aiarena.callidity.com>',
    to:      user.email,
    subject: 'Thanks for your feedback!',
    html:    thankYouTemplate({ name: user.displayName, category, message }),
  }).catch(err => logger.warn({ err }, 'Thank-you email failed — non-fatal'))
}
```

The `.catch()` makes it non-fatal — a Resend hiccup never fails the submission itself.

The email template (`thankYouTemplate`) lives alongside the other Resend templates.
It should be short: acknowledge the submission, mention the category, and set
expectations ("we review all feedback and will follow up if needed").

**Railway hosting**: no special configuration required. Railway runs the Node.js
process; outbound HTTPS calls to Resend's API work exactly as they do locally. The
`RESEND_API_KEY` environment variable is already set in the Railway service.

**Sending domain prerequisite**: `aiarena.callidity.com` must be added as a verified
sending domain in Resend (SPF + DKIM DNS records on the `callidity.com` registrar)
before emails from `support@aiarena.callidity.com` will deliver. Verify this is done
before implementing Phase 1 — it's a DNS propagation step that can take up to 48 hours
and is not part of the code changes.

### Support staff notifications on new submission

When a feedback submission is saved, all users with the `ADMIN` or `SUPPORT` role are
notified. Two channels are used depending on whether they are currently signed in:

**Real-time (signed-in)**: The backend emits a Socket.io event to a private
`support` room that admin/support users join on sign-in. Socket.io is already
in use (game rooms, ML, logs) so no new infrastructure is needed.

```js
// Backend: after db.feedback.create(...)
io.to('support').emit('feedback:new', {
  id:       feedback.id,
  category: feedback.category,
  appId:    feedback.appId,
  pageUrl:  feedback.pageUrl,
})
```

```js
// Frontend: in AppLayout, when isAdminOrSupport
socket.emit('support:join')   // server does socket.join('support')

socket.on('feedback:new', (payload) => {
  // increment unread badge, play('win') chime, show toast with link to inbox
  toast.info('New feedback received', { action: { label: 'View', onClick: () => navigate('/support') } })
})
```

The toast is shown regardless of which page the support user is currently on.

**Email (offline / not connected)**: The backend queries all users with `ADMIN` or
`SUPPORT` role and sends a notification email via Resend to each who has a verified
email address. This fires in the same handler as the thank-you email, also non-fatal.

```js
// After saving feedback, fetch support/admin emails
const staffEmails = await db.user.findMany({
  where: {
    userRoles: { some: { role: { in: ['ADMIN', 'SUPPORT'] } } },
    emailVerified: true,
  },
  select: { email: true, displayName: true },
})

await Promise.allSettled(staffEmails.map(staff =>
  resend.emails.send({
    from:    'XO Arena <support@aiarena.callidity.com>',
    to:      staff.email,
    subject: `New ${category} feedback received`,
    html:    staffAlertTemplate({ category, message, pageUrl, appId }),
  })
))
```

`Promise.allSettled` ensures one failed delivery doesn't block the others.

There is no deduplication between the real-time toast and the email — a signed-in
support user gets both. This is intentional: the email serves as a persistent record
in their inbox even if they dismiss the toast.

---

## 5. Frontend Components

The components are **game-agnostic** — they accept an `appId` prop and have no
XO Arena-specific imports. To plug them into a new game: copy the two files, install
`html2canvas`, and pass the new game's `appId`.

### `useRolesStore` (Zustand)

New lightweight store: fetches `/api/v1/me/roles` once after sign-in, caches in
memory. Exposes `hasRole(role)` and `isSupport` / `isAdminOrSupport` derived getters.
Cleared on sign-out.

```js
// frontend/src/store/rolesStore.js
const useRolesStore = create(set => ({
  roles: [],
  fetch: async (token) => { /* GET /api/v1/me/roles */ },
  clear: () => set({ roles: [] }),
  hasRole: (role) => get().roles.includes(role),
}))
```

Call `rolesStore.fetch(token)` in `AppLayout` immediately after session is confirmed.

### Route guards

**`AdminRoute`** (existing) — no change, still checks `session?.user?.role === 'admin'`.

**`SupportRoute`** (new) — allows through if user is admin OR has `SUPPORT` domain role:
```jsx
// Uses both session.user.role (for admin) and rolesStore.hasRole('SUPPORT')
if (session?.user?.role !== 'admin' && !hasRole('SUPPORT')) {
  return <Navigate to="/play" replace />
}
```

### AppLayout — support user experience

Support users (`hasRole('SUPPORT')` but not admin) see a **stripped navigation**:
- No sidebar links to Play, Gym, Puzzles, Leaderboard, Stats, etc.
- Header shows their avatar + sign-out only
- The only destination is `/support`
- They are redirected to `/support` on sign-in (not `/play`)

Detect in `AppLayout`:
```jsx
const isAdmin   = session?.user?.role === 'admin'
const isSupport = !isAdmin && rolesStore.hasRole('SUPPORT')
```

When `isSupport`: render the support layout (minimal header, no nav, no feedback
button — support staff don't submit feedback to themselves).

### `FeedbackButton` (global, in `AppLayout`)

Props: `appId` (string), `apiBase` (string, e.g. `"/api/v1"`), `hideWhenPlaying`
(bool, default `true`).

- Fixed position, bottom-right, `z-40`, above mobile bottom nav (`z-50` is the
  hamburger drawer, so use `z-40` to stay below it)
- Small rounded button with 💬 icon
- **Hide while a game is active** when `hideWhenPlaying` is true
- **Not shown to support users** (they work the inbox, they don't submit to it)

### `FeedbackModal`

Props: `appId`, `apiBase`, `open`, `onClose`.

- Standard modal overlay
- Fields: category pills, textarea (required, max 1000 chars), screenshot toggle +
  thumbnail (toggle hidden entirely on mobile — see §2)
- On submit: `POST {apiBase}/feedback` with `{ appId, ... }`, then show toast, close modal
- Capture screenshot *before* modal renders: on button click → capture → then
  `setModalOpen(true)`. The ~200ms capture delay is imperceptible.

### Admin notification badge
- Poll `/api/v1/admin/feedback/unread-count` (admin) or
  `/api/v1/support/feedback/unread-count` (support) every 60 seconds, only for
  users with the relevant role
- On new unread count > previous count, call `play('win')` from `useSoundStore` as a
  soft chime
- Badge clears when the user visits the feedback inbox

---

## 6. Admin Feedback Inbox

New page: `AdminFeedbackPage` at `/admin/feedback`

**App.jsx changes needed**:
```jsx
import AdminFeedbackPage from './pages/admin/AdminFeedbackPage.jsx'
<Route path="/admin/feedback" element={<AdminRoute><AdminFeedbackPage /></AdminRoute>} />
```

**Hamburger menu** (`AppLayout.jsx` `ADMIN_MENU_LINKS`): add `{ to: '/admin/feedback', label: 'Feedback', icon: '💬' }`

**Page layout** mirrors the Support screen inbox — same sort/filter toolbar, same
row structure, same expand-inline behaviour, same archive flow. Admins see the full
`AdminFeedbackPage` rather than `SupportPage`, but the inbox component itself
(`FeedbackInbox`) is a shared component used by both pages, parameterised by the
API base path (`/api/v1/admin/feedback` vs `/api/v1/support/feedback`).

- App selector pill row (hidden when only one app)
- Inbox / Archive tab toggle
- Sort dropdown · Filter pills · Unread toggle · Date range · Bulk select
- Row: checkbox · category badge · status badge · app badge · submitter · preview · screenshot thumb
- Expanded: full message · screenshot lightbox · status selector · resolution note · reply thread · actions
- Unread rows: blue left border

---

## 7. Dedicated Support Screen

New page: `SupportPage` at `/support`

Only accessible to users with the `SUPPORT` role (or admin). Intentionally stripped
of everything not needed for support work. The support person opens a second browser
tab to reproduce issues as a regular user.

**Route**:
```jsx
<Route path="/support" element={<SupportRoute><SupportPage /></SupportRoute>} />
```

**Page sections**:

### App Selector (persistent, top of page)

A row of app pill buttons — one per distinct `appId` in the DB, plus an "All" option:

```
[ All ]  [ xo-arena · 3 unread ]  [ word-game · 1 unread ]
```

- Selected app is highlighted and **persisted to `localStorage`** so the support user
  returns to their last focused app across page reloads and sign-ins
- Unread counts per app shown on each pill — fetched from
  `GET /api/v1/support/feedback/unread-count?groupByApp=true` which returns
  `{ counts: { 'xo-arena': 3, 'word-game': 1 } }`
- Selecting an app filters **both** the Feedback inbox and the User Lookup tab
  (user search is scoped to submissions from that app's users)
- When only one `appId` exists in the DB the selector is hidden — no clutter until
  it's needed
- The Socket.io `feedback:new` event includes `appId` so the pill badge increments
  in real-time without a poll

### Feedback Inbox (primary)

**Toolbar** (above the list):
- **Sort dropdown**: Newest · Oldest · Status · Category · App — persisted to `localStorage`
- **Filter pills**: `Open` · `In Progress` · `Resolved` · `Won't Fix` · `All` — default is `Open`
- **Unread toggle**: show unread only
- **Date range picker**: from / to
- **Select all checkbox**: checks all visible items for bulk action
- **Bulk action bar** (appears when ≥1 item checked): `Archive selected` · `Mark read` · `Mark resolved`

**List rows** — each item shows:
- Checkbox (left edge)
- Category badge (`Bug` / `Suggestion` / `Other`)
- Status badge (`Open` / `In Progress` / `Resolved` / `Won't Fix`) — colour-coded
- App badge (only when "All" is selected)
- Submitter name or "Anonymous" · timestamp
- Message preview (truncated to ~120 chars)
- Screenshot thumbnail if present
- Unread dot (blue) if not yet read

**Expanded item** (click row to expand inline, or open in a side panel):
- Full message text
- Screenshot lightbox
- `pageUrl` as a clickable link
- User agent string (collapsed by default)
- **Status selector** — dropdown to change `OPEN → IN_PROGRESS → RESOLVED / WONT_FIX`
- **Resolution note** — textarea, editable at any time, saved on blur or explicit
  "Save note" button. Displayed read-only once saved, with an edit pencil icon.
  Timestamped and attributed to the staff member who wrote it.
- Reply thread (Phase 4)
- Action buttons: `Mark read` · `Archive` · `Delete`

**Archive flow**:
- Archiving moves an item out of the active inbox into the archive view
- Items can be archived individually (row action) or in bulk (select + bulk bar)
- Archived items are **not deleted** — they are fully preserved with all notes and replies
- Archive view is a separate tab/toggle: `Inbox` · `Archive`
- Archive has the same sort/filter toolbar as the inbox
- Items can be unarchived (moved back to inbox) from the archive view
- Unread badge in the tab label updates in real-time via Socket.io

### User Lookup
- Search bar (by name or email)
- Scoped to selected app when one is active (filters by users who have submitted
  feedback for that app, or all users when "All" selected)
- Results show: avatar, display name, email, join date, banned status, ELO
- Actions per user: **Ban** / **Unban** (calls `PATCH /api/v1/support/users/:id/ban`)
- No: role changes, ELO edits, delete — support scope only

**Layout**:
- Minimal header (logo + "Support" label + avatar/sign-out)
- App selector row beneath header (always visible when multiple apps exist)
- Three-tab layout: `Inbox` (default) · `Archive` · `User Lookup`
- No bottom nav, no hamburger, no game-related UI

---

## 8. Admin — Granting the Support Role

In `AdminUsersPage`, add a **Support** toggle button alongside the existing
`BOT_ADMIN` / `TOURNAMENT_ADMIN` toggles:

```jsx
<RoleToggle
  active={(u.roles ?? []).includes('SUPPORT')}
  label="support"
  title={(u.roles ?? []).includes('SUPPORT') ? 'Remove support' : 'Grant support'}
  onClick={() => toggleRole(u, 'SUPPORT')}
/>
```

Badge display in the users table:
```jsx
{(u.roles ?? []).includes('SUPPORT') && <Badge color="purple">support</Badge>}
```

No other changes to the admin UI — admins continue to access the feedback inbox via
`/admin/feedback` as before.

---

## 9. Implementation Phases

### Phase 0 — DNS prerequisite (callidity.com)

Must be completed before Phase 1 code ships to production, as outbound emails will
silently fail or land in spam without verified DNS records.

1. Log in to the **callidity.com** DNS registrar / hosting control panel
2. In **Resend** (resend.com), go to Domains → Add Domain → enter `aiarena.callidity.com`
3. Resend will provide a set of DNS records to add — typically:
   - `TXT` record for SPF (e.g. `v=spf1 include:amazonses.com ~all`)
   - `CNAME` records for DKIM (two or three `_domainkey` entries)
   - Optional `MX` record if bounce handling is needed
4. Add those records at the registrar under the `aiarena.callidity.com` subdomain
5. Click **Verify** in Resend — DNS propagation can take up to 48 hours but is often
   minutes if the registrar has low TTLs
6. Confirm the domain shows **Verified** status in Resend before deploying Phase 1
7. Update the `RESEND_FROM_DOMAIN` (or equivalent) env var in Railway to
   `support@aiarena.callidity.com` if not already set

> ⚠️ Phase 1 can be developed and tested locally while DNS propagates, but do not
> merge to production until Resend shows the domain as verified.

### Phase 1 — Core submission (backend + basic UI)
- Add `SUPPORT` to `VALID_ROLES` in `roles.js`
- Add `isSupport()` + `requireSupport()` to `auth.js`
- Add `GET /api/v1/me/roles` endpoint
- Add `express-rate-limit` to backend dependencies
- DB migration + `Feedback` (with `status`, `resolutionNote`, `resolvedAt`, `archivedAt`) + `FeedbackReply` models
- `POST /api/v1/feedback` endpoint (rate-limited, sends thank-you email to submitter + staff alert email + Socket.io event to `support` room)
- `useRolesStore` Zustand store, fetch on sign-in in `AppLayout`
- `SupportRoute` component
- `FeedbackButton` + `FeedbackModal` as game-agnostic components with `appId` prop
- `AdminFeedbackPage` with list + delete + mark-read (`/admin/feedback`)
- `SupportPage` with feedback inbox + user lookup (`/support`)
- Support toggle in `AdminUsersPage`
- Stripped layout for support users in `AppLayout`
- Routes in `App.jsx`, links in hamburger menu

### Phase 2 — Screenshots
- Add `html2canvas` to frontend dependencies
- Capture-before-open flow in `FeedbackButton` (skip on mobile)
- Screenshot JPEG compression (max 800px, quality 0.7)
- Screenshot thumbnail in modal + lightbox in admin and support inboxes

### Phase 3 — Admin/Support notifications
- `GET /api/v1/admin/feedback/unread-count` + `/api/v1/support/feedback/unread-count`
- Poll + badge in `AppLayout` for admin and support users
- Reuse `play('win')` as notification chime

### Phase 4 — Replies (optional)
- Reply thread UI in both admin and support inboxes
- Trigger Resend email on reply (Resend already integrated)

### Plugging into a future game (no phases needed)
1. Point the new game's frontend at the same backend (`apiBase`)
2. Pass a new `appId` string to `FeedbackButton`
3. No migration required — `appId` is a free-form string
4. Submissions appear in both the admin inbox and support inbox immediately

---

## 10. Resolved Questions

- **Pluggability**: `appId` field on submissions (free-form string, indexed, no FK)
  makes the system game-agnostic at every layer.
- **Support role detection on frontend**: Better Auth session only exposes
  `role: 'admin'`. Domain roles need a `GET /api/v1/me/roles` endpoint + `useRolesStore`.
- **Support vs admin routing**: Support users land at `/support` (stripped UI).
  Admins access feedback at `/admin/feedback` (full admin UI). Both use the same
  underlying data, just different API paths and permission middleware.
- **Support scope**: ban/unban + feedback inbox only. No role changes, ELO, ML, bots,
  AI config, or logs.
- **Screenshot storage**: base64 JPEG (~80–120KB compressed) in DB, fine for MVP.
- **Screenshot on mobile**: skipped — `html2canvas` unreliable. Note shown in modal.
- **Anonymous submissions**: allowed. IP rate limiting (3/hr) is the spam guard.
- **Rate limiter**: add `express-rate-limit` (in-memory). Redis store available later.
- **Notification sound**: reuse `play('win')` from existing `soundStore`.
- **Thank-you email to submitter**: Resend already integrated. Non-fatal. Skipped for anonymous/unverified users.
- **Staff alert email**: sent to all admin/support users with verified emails via `Promise.allSettled` — one failure doesn't block others.
- **Real-time toast for signed-in staff**: Socket.io already in use. Backend emits `feedback:new` to a `support` room; frontend joins the room on sign-in and shows a toast + chime.
- **No deduplication between toast and email**: intentional — email serves as a persistent record even if the toast is dismissed.
- **App selector on support screen**: pill row filtered by distinct `appId` values in DB; hidden when only one app exists; selection persisted to `localStorage`; per-app unread counts via `?groupByApp=true`; incremented in real-time via Socket.io `feedback:new` payload.
- **Sorting**: server-side sort on `createdAt`, `status`, `category`, `appId` via `?sort=&dir=` params; selection persisted to `localStorage`.
- **Status workflow**: `OPEN → IN_PROGRESS → RESOLVED / WONT_FIX` — changed via inline dropdown in the expanded row. `resolvedAt` and `resolvedById` set automatically on backend when status moves to a terminal state.
- **Resolution note**: free-text internal note stored on the `Feedback` row; editable at any time; timestamped and attributed to the staff member. Separate from replies (which are user-facing in Phase 4).
- **Archive**: soft-archive via `archivedAt` timestamp — items preserved in full. Inbox and Archive are separate tabs. Bulk archive via checkbox select. Items can be unarchived. Archive has the same sort/filter toolbar as the inbox.
- **Shared `FeedbackInbox` component**: used by both `AdminFeedbackPage` and `SupportPage`, parameterised by API base path — no duplicated UI code.
- **Email replies (Phase 4)**: same Resend integration, same pattern.
- **z-index**: feedback button at `z-40`, below hamburger drawer (`z-50`).
- **Feedback button hidden for support users**: they work the inbox, don't submit to it.

---

## 11. Implementation Checklist

### Phase 0 — DNS
- [ ] Log in to callidity.com DNS registrar
- [ ] Add `aiarena.callidity.com` as a sending domain in Resend
- [ ] Copy SPF `TXT` record into DNS
- [ ] Copy DKIM `CNAME` records into DNS
- [ ] Wait for propagation and confirm **Verified** status in Resend
- [ ] Set `support@aiarena.callidity.com` as the from address in Railway env vars

### Phase 1 — Core submission
**Backend**
- [ ] Add `SUPPORT` to `VALID_ROLES` in `backend/src/utils/roles.js`
- [ ] Add `isSupport()` + `requireSupport()` to `backend/src/middleware/auth.js`
- [ ] Add `GET /api/v1/me/roles` endpoint
- [ ] Add `express-rate-limit` to `backend/package.json`
- [ ] Write DB migration `20260XXX_add_feedback` — `Feedback` + `FeedbackReply` + `FeedbackCategory` + `FeedbackStatus` enums
- [ ] `POST /api/v1/feedback` handler — save row, send thank-you email (verified users only), send staff alert emails, emit `feedback:new` Socket.io event to `support` room
- [ ] `GET /api/v1/support/feedback` — list with `appId`, `status`, `category`, `archived`, date range filters + sort params
- [ ] `GET /api/v1/support/feedback/unread-count` — with `?groupByApp=true` support
- [ ] `PATCH /api/v1/support/feedback/:id/read`
- [ ] `PATCH /api/v1/support/feedback/:id/status` — updates `status`, `resolutionNote`, sets `resolvedAt`/`resolvedById` on terminal states
- [ ] `PATCH /api/v1/support/feedback/:id/archive` — toggle `archivedAt`
- [ ] `PATCH /api/v1/support/feedback/archive-many` — bulk archive by `ids[]`
- [ ] `DELETE /api/v1/support/feedback/:id`
- [ ] `GET /api/v1/support/users` — search by name/email
- [ ] `PATCH /api/v1/support/users/:id/ban`
- [ ] Admin mirrored endpoints under `/api/v1/admin/feedback` (same logic, `requireAdmin`)
- [ ] Socket.io: `support:join` event handler — `socket.join('support')`
- [ ] Resend thank-you email template (`thankYouTemplate`)
- [ ] Resend staff alert email template (`staffAlertTemplate`)

**Frontend**
- [ ] `frontend/src/store/rolesStore.js` — Zustand store, `GET /api/v1/me/roles`, `hasRole()`, clear on sign-out
- [ ] Call `rolesStore.fetch()` in `AppLayout` after session confirms
- [ ] `SupportRoute` component — allows admin or `hasRole('SUPPORT')`
- [ ] Stripped support layout in `AppLayout` — minimal header, no nav, redirect to `/support`
- [ ] `FeedbackButton` component — `appId` + `apiBase` props, `z-40`, hide when playing, hide for support users
- [ ] `FeedbackModal` component — category pills, textarea, submit to `POST /api/v1/feedback`
- [ ] `FeedbackInbox` shared component — parameterised by API path; app selector pills, inbox/archive tabs, sort dropdown, filter pills, unread toggle, date range, bulk select, row expand, status selector, resolution note editor, archive/unarchive/delete actions
- [ ] `AdminFeedbackPage` at `/admin/feedback` — wraps `FeedbackInbox` with admin API path
- [ ] `SupportPage` at `/support` — app selector + `FeedbackInbox` (support API path) + User Lookup tab
- [ ] Support toggle button + badge in `AdminUsersPage`
- [ ] Socket.io `feedback:new` listener in `AppLayout` — increment badge, toast, chime for admin/support users
- [ ] Routes in `App.jsx` (`/admin/feedback`, `/support`)
- [ ] Hamburger menu: add Feedback to `ADMIN_MENU_LINKS`

### Phase 2 — Screenshots
- [ ] Add `html2canvas` to `frontend/package.json`
- [ ] Capture-before-open in `FeedbackButton` — skip on mobile (`ontouchstart` detect)
- [ ] JPEG compression (max 800px wide, quality 0.7) before sending
- [ ] Screenshot thumbnail in `FeedbackModal`
- [ ] Screenshot lightbox in `FeedbackInbox` expanded row

### Phase 3 — Notifications
- [ ] Unread count badge polling (60s) in `AppLayout` for admin and support users
- [ ] Per-app unread counts (`?groupByApp=true`) populating app selector pills
- [ ] Chime on new unread (`play('win')`)

### Phase 4 — Replies
- [ ] `POST /api/v1/support/feedback/:id/reply` + admin equivalent
- [ ] Reply thread UI in `FeedbackInbox` expanded row
- [ ] Resend email to submitter on reply (verified email only)
