#!/usr/bin/env bash
# Provisions two throwaway local users for QA tests and writes credentials to qa.env.
#
# Users created (idempotent — safe to re-run):
#   qa-admin (ADMIN role)  → email qa-admin@dev.local, password qa-admin
#   qa-user                → email qa-user@dev.local,  password qa-user
#
# Requires: backend container running (docker compose up).

set -euo pipefail

cd "$(dirname "$0")/.."

OUT_FILE="qa.env"
ADMIN_USER="qa-admin"
ADMIN_PASS="qa-admin"
ADMIN_EMAIL="${ADMIN_USER}@dev.local"
USER_USER="qa-user"
USER_PASS="qa-user"
USER_EMAIL="${USER_USER}@dev.local"
USER2_USER="qa-user-2"
USER2_PASS="qa-user-2"
USER2_EMAIL="${USER2_USER}@dev.local"

echo "➜ Provisioning QA users via backend CLI (docker compose)…"

# `um create` throws on duplicate — swallow that so the script stays idempotent.
docker compose exec -T backend npm run -s um -- create "$ADMIN_USER" --admin --password "$ADMIN_PASS" --email "$ADMIN_EMAIL" 2>&1 \
  | grep -v 'already exists' || true
docker compose exec -T backend npm run -s um -- create "$USER_USER" --password "$USER_PASS" --email "$USER_EMAIL" 2>&1 \
  | grep -v 'already exists' || true
docker compose exec -T backend npm run -s um -- create "$USER2_USER" --password "$USER2_PASS" --email "$USER2_EMAIL" 2>&1 \
  | grep -v 'already exists' || true

# Ensure ADMIN role on qa-admin (no-op if already granted)
docker compose exec -T backend npm run -s um -- role "$ADMIN_USER" ADMIN 2>&1 \
  | grep -v 'already has' || true

# BetterAuth tracks its own `ba_users.role` column that powers the UI's
# AdminRoute check (reads session.user.role). The `um role ADMIN` command
# only populates our app-side `user_roles` table, which is what the API
# admin middleware uses. Both are needed for qa-admin to see the admin UI
# AND hit admin endpoints. One-shot SQL update covers the BA side.
docker compose exec -T postgres psql -U xo -d xo_arena -c \
  "UPDATE ba_users SET role = 'admin' WHERE email = '${ADMIN_EMAIL}';" >/dev/null 2>&1 || true

cat > "$OUT_FILE" <<EOF
# Local QA credentials — localhost only, not secrets.
# Regenerate with: ./scripts/setup-qa-users.sh
TEST_ADMIN_EMAIL=$ADMIN_EMAIL
TEST_ADMIN_PASSWORD=$ADMIN_PASS
TEST_USER_EMAIL=$USER_EMAIL
TEST_USER_PASSWORD=$USER_PASS
TEST_USER2_EMAIL=$USER2_EMAIL
TEST_USER2_PASSWORD=$USER2_PASS
LANDING_URL=http://localhost:5174
BACKEND_URL=http://localhost:3000
EOF

echo "✓ Wrote $OUT_FILE"
echo
echo "Next: ./scripts/run-qa.sh tournament-mixed"
