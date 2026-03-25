# XO Arena — Development Workflow

## The Three Environments

| Environment | Branch | Where it runs | Who can see it |
|---|---|---|---|
| Local dev | `dev` | Your machine only | You |
| Staging | `staging` | Railway (staging env) | Anyone with the URL |
| Production | `main` | Railway (production env) | Real users |

---

## Day-to-Day Flow

### 1. Do your work
Write code, test locally with `npm run dev`. Commit and save to `dev` whenever you want a checkpoint:

```
/dev
```

This commits all changes and pushes to the `dev` branch. Nothing goes to Railway. Repeat as often as you like.

---

### 2. Promote to staging for real-world testing
When a feature is ready to test on a live server — or you want someone else to try it:

```
/stage
```

This opens a PR from `dev → staging`. Once merged, Railway auto-deploys to the staging environment. Use the Railway-provided staging URL to smoke test.

---

### 3. Promote to production
Once staging looks good:

```
/promote
```

This opens a PR from `staging → main`. Once merged, Railway auto-deploys to production.

---

## Hotfix Flow

For urgent production bugs that can't wait for the normal `dev → staging → main` cycle:

```
/hotfix
```

This will:
1. Branch off `main`
2. Ask you to describe the fix
3. Commit and open a PR directly to `main` (bypasses staging)
4. Back-merge the fix into `dev` automatically so it isn't lost on the next promote

Use sparingly — only for genuine production emergencies.

---

## Quick Reference

| Task | Command |
|---|---|
| Save work locally | `/dev` |
| Deploy to staging | `/stage` |
| Deploy to production | `/promote` |
| Emergency production fix | `/hotfix` |

---

## Rules

- **Never commit secrets** (`.env` files, API keys) — the skills will warn you
- **`/promote` checks CI** — if tests are failing on staging, it will warn you before merging
- **Staging has its own database** — test data in staging never affects production
- **`dev` is yours** — force-push, rebase, experiment freely; it never touches Railway
