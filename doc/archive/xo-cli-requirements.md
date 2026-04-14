<!-- Copyright © 2026 Joe Pruskowski. All rights reserved. -->
# um — Dev User Management CLI

## Purpose

A command-line tool for managing users on a local development instance of XO Arena.
Solves the problem that email delivery is unavailable in dev (no SMTP) and OAuth
redirects don't work on localhost, making it impossible to register and verify
accounts through the normal UI flow.

**Scope:** dev/localhost only. The tool should refuse to run if `NODE_ENV=production`.

---

## Implementation

Built in **Node.js** as a script inside the `backend` package, using:
- **Prisma client** — reuse the existing instance; no separate DB layer needed
- **`commander`** — subcommand and option parsing (`-V`, `-h`, etc.)
- Same password hashing library already used by BetterAuth (to be confirmed before implementation) so hashes are accepted at sign-in
- Registered as a workspace binary: `"bin": { "um": "./src/cli/um.js" }` in `backend/package.json`

```
backend/src/cli/
  um.js              ← entry point, commander setup
  commands/
    create.js
    verify.js
    password.js
    role.js
    list.js
    delete.js
    idle.js
    session.js
  lib/
    safety.js        ← NODE_ENV production guard
```

---

## Invocation

```
um [command] [options]
```

The tool connects directly to the dev database via the same `DATABASE_URL` used by
the backend (reads `.env` from the project root or `backend/.env`).

---

## Global options

| Flag | Description |
|------|-------------|
| `-V, --version` | Print version and exit |
| `-h, --help` | Print help and exit |

---

## Commands

### `create` — Create a new user account

```
um create <username> [options]
```

Creates a full account row in both the `user` (BetterAuth) table and the app `User`
table, ready to sign in immediately.

Users are **verified by default** so they can sign in without any email step.
Pass `--noverify` to leave the account unverified (useful for testing the
verification flow itself).

| Option | Default | Description |
|--------|---------|-------------|
| `--password <pwd>` | `<username>` | Plaintext password (hashed with bcrypt before storage) |
| `--email <addr>` | `<username>@dev.local` | Email address |
| `--display-name <name>` | `<username>` | Display name shown in the UI |
| `--noverify` | — | Leave email unverified (default is verified) |
| `--admin` | — | Grant the `ADMIN` role |
| `--support` | — | Grant the `SUPPORT` role |

---

### `verify` — Set email verification state on an existing user

```
um verify <username|email> [--noverify]
```

Sets `emailVerified = true` on the BetterAuth `user` record by default. Pass
`--noverify` to set it back to `false` (useful for re-testing the verification
flow without deleting the account).

| Option | Description |
|--------|-------------|
| `--noverify` | Mark the user as unverified instead |

---

### `password` — Reset a user's password

```
um password <username|email> <new-password>
```

Hashes and updates the password in the BetterAuth `account` table. Allows signing
in again after a forgotten dev password without going through the reset flow.

---

### `role` — Grant or revoke a role

```
um role <username|email> <role> [--revoke]
```

Adds or removes an entry from `user_roles`. Valid role values mirror the `Role`
enum in the schema (e.g. `ADMIN`, `SUPPORT`, `BOT_ADMIN`).

| Option | Description |
|--------|-------------|
| `--revoke` | Remove the role instead of adding it |

---

### `list` — List users

```
um list [options]
```

Prints a table of users: id, username, email, verified, roles, created date.

| Option | Description |
|--------|-------------|
| `--limit <n>` | Max rows to show (default: 20) |
| `--unverified` | Show only unverified accounts |

---

### `delete` — Delete a user

```
um delete <username|email> [options]
```

Hard-deletes the user and all related rows (cascades). Prompts for confirmation
unless `--yes` is passed.

| Option | Description |
|--------|-------------|
| `--yes` | Skip confirmation prompt |
| `--force` | Allow deletion of admin accounts |

**Admin protection rules:**
- If the target user has the `ADMIN` role, the command aborts with an error unless
  `--force` is also provided.
- Even with `--force`, deletion of the last remaining admin account is always
  refused with no override — the system must always have at least one admin.

---

### `rename` — Change a user's username

```
um rename <username|email> <new-username>
```

Updates `username` on the app `User` record. Errors cleanly if the new username
is already taken (unique constraint) or is the same as the current one.

---

### `idle` — Backdate a user's last-active timestamp

```
um idle <username|email> <duration>
```

Sets `lastActiveAt` on the app `User` record to `now() - <duration>`, making the
system believe the user has been inactive for that long. Useful for triggering and
observing idle-timeout behaviour without waiting.

Duration is a plain number followed by a unit: `s` (seconds), `m` (minutes), or
`h` (hours). Examples: `90s`, `10m`, `2h`.

```
um idle alice 10m      # alice looks idle for 10 minutes
um idle alice 2h       # alice looks idle for 2 hours
um idle alice 0        # reset to now (mark as active)
```

---

### `session` — Invalidate all sessions for a user

```
um session <username|email> --invalidate
```

Deletes all BetterAuth session rows for the user, forcing a fresh login. Useful
when testing session expiry or permission changes that require re-auth.

---

## Output

- Success: short confirmation line, e.g. `✓ Created user "alice" (verified, ADMIN)`
- Errors: human-readable message to stderr, non-zero exit code
- `list` command: ASCII table to stdout

---

## Non-goals

- No remote/production support
- No interactive prompts (except `delete` confirmation)
- No email sending — this tool exists specifically because email is unavailable
