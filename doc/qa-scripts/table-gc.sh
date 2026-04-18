#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Table GC QA — manual test suite for the background GC service (Section 7)
#
# Usage (from repo root):
#   ./doc/qa-scripts/table-gc.sh
#
# No browser token needed. The script reads QA_SECRET from backend/.env.
# Requirements: Docker Compose stack running (postgres + backend)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

API="http://localhost:3000/api/v1"
DB="postgresql://xo:xo@localhost:5432/xo_arena"

QA_SECRET=$(grep '^QA_SECRET=' "$REPO_ROOT/backend/.env" 2>/dev/null | cut -d= -f2-)
if [[ -z "$QA_SECRET" ]]; then
  echo "ERROR: QA_SECRET not found in backend/.env"; exit 1
fi

PASS=0; FAIL=0

# ── Helpers ───────────────────────────────────────────────────────────────────

psql_exec() { psql "$DB" -q -t -A -c "$1" 2>/dev/null; }

run_sweep() { curl -s -X POST "$API/admin/gc/run" -H "X-QA-Secret: $QA_SECRET"; }

pass() { printf "  ✓ %s\n" "$1"; PASS=$((PASS+1)); }
fail() { printf "  ✗ %s\n" "$1"; FAIL=$((FAIL+1)); }

assert_eq() {
  local label="$1" got="$2" want="$3"
  if [[ "$got" == "$want" ]]; then pass "$label"
  else fail "$label  (got '$got', want '$want')"; fi
}

assert_ne() {
  local label="$1" got="$2" notwant="$3"
  if [[ "$got" != "$notwant" ]]; then pass "$label"
  else fail "$label  (expected not '$notwant')"; fi
}

cleanup() {
  psql_exec "DELETE FROM tables WHERE \"displayName\" LIKE 'QA-GC-%'" > /dev/null 2>&1 || true
}
trap cleanup EXIT

CREATOR_ID=$(psql_exec "SELECT id FROM users LIMIT 1;")
if [[ -z "$CREATOR_ID" ]]; then
  echo "ERROR: no users in DB — create an account before running this script"; exit 1
fi

BASE_COLS='"gameId", "minPlayers", "maxPlayers", "isPrivate", seats, "previewState", "displayName", "createdById"'
BASE_VALS="'xo', 2, 2, false, '[{\"status\":\"open\"},{\"status\":\"open\"}]'::jsonb, '{}'::jsonb"

seed_forming() {
  local name="$1" ago="$2"
  local extra_col="" extra_val=""
  if [[ "${3:-}" != "" ]]; then extra_col=', "tournamentId"'; extra_val=", '$3'"; fi
  psql_exec "
    INSERT INTO tables (id, status, $BASE_COLS $extra_col, \"createdAt\", \"updatedAt\")
    VALUES (gen_random_uuid()::text, 'FORMING', $BASE_VALS, '$name', '$CREATOR_ID' $extra_val,
      NOW() - INTERVAL '$ago', NOW() - INTERVAL '$ago') RETURNING id;"
}

seed_completed() {
  local name="$1" ago="$2"
  psql_exec "
    INSERT INTO tables (id, status, $BASE_COLS, \"createdAt\", \"updatedAt\")
    VALUES (gen_random_uuid()::text, 'COMPLETED', $BASE_VALS, '$name', '$CREATOR_ID',
      NOW() - INTERVAL '$ago', NOW() - INTERVAL '$ago') RETURNING id;"
}

seed_active() {
  local name="$1" created_ago="$2" updated_ago="$3"
  psql_exec "
    INSERT INTO tables (id, status, \"gameId\", \"minPlayers\", \"maxPlayers\", \"isPrivate\",
      seats, \"previewState\", \"displayName\", \"createdById\", \"createdAt\", \"updatedAt\")
    VALUES (gen_random_uuid()::text, 'ACTIVE', 'xo', 2, 2, false,
      '[{\"status\":\"occupied\",\"userId\":\"qa-u1\"},{\"status\":\"occupied\",\"userId\":\"qa-u2\"}]'::jsonb,
      '{\"board\":[null,null,null,null,null,null,null,null,null]}'::jsonb,
      '$name', '$CREATOR_ID',
      NOW() - INTERVAL '$created_ago', NOW() - INTERVAL '$updated_ago') RETURNING id;"
}

echo
echo "Table GC QA"
echo "==========="

# ── Test 1 ────────────────────────────────────────────────────────────────────
echo
echo "Test 1: Stale FORMING table (empty seats, >30 min) is auto-deleted"
cleanup

ID=$(seed_forming QA-GC-forming-stale "31 minutes")
assert_ne "Seeded row" "$ID" ""
run_sweep > /dev/null
assert_eq "Row deleted" "$(psql_exec "SELECT COUNT(*) FROM tables WHERE id = '$ID'")" "0"

# ── Test 2 ────────────────────────────────────────────────────────────────────
echo
echo "Test 2: Old COMPLETED table (>24 hr) is auto-deleted"

ID=$(seed_completed QA-GC-completed-old "25 hours")
assert_ne "Seeded row" "$ID" ""
run_sweep > /dev/null
assert_eq "Row deleted" "$(psql_exec "SELECT COUNT(*) FROM tables WHERE id = '$ID'")" "0"

# ── Test 3 ────────────────────────────────────────────────────────────────────
echo
echo "Test 3: Idle ACTIVE table (updatedAt >3 min ago) is marked COMPLETED"

# Default threshold: idleWarnSeconds(120) + idleGraceSeconds(60) = 180s = 3 min.
ID=$(seed_active QA-GC-active-idle "10 minutes" "4 minutes")
assert_ne "Seeded row" "$ID" ""
run_sweep > /dev/null
assert_eq "Status → COMPLETED" "$(psql_exec "SELECT status FROM tables WHERE id = '$ID'")" "COMPLETED"
psql_exec "DELETE FROM tables WHERE id = '$ID'" > /dev/null

# ── Test 4 ────────────────────────────────────────────────────────────────────
echo
echo "Test 4: Tournament FORMING table (tournamentId set) is NOT deleted"

ID=$(seed_forming QA-GC-tournament-forming "31 minutes" "qa-fake-tournament-id")
assert_ne "Seeded row" "$ID" ""
run_sweep > /dev/null
assert_eq "Row preserved" "$(psql_exec "SELECT COUNT(*) FROM tables WHERE id = '$ID'")" "1"
psql_exec "DELETE FROM tables WHERE id = '$ID'" > /dev/null

# ── Test 5 ────────────────────────────────────────────────────────────────────
echo
echo "Test 5: Sweep returns non-zero counts and logs 'Table GC:' summary"

seed_forming QA-GC-log-check "31 minutes" > /dev/null

RESULT=$(run_sweep)
DELETED=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get('deletedForming',0))" "$RESULT" 2>/dev/null || echo "0")
assert_ne "API deletedForming > 0" "$DELETED" "0"

LOG=$(docker compose -f "$REPO_ROOT/docker-compose.yml" logs backend --tail=40 2>/dev/null \
      | grep "Table GC:" | tail -1 || true)
if [[ -n "$LOG" ]]; then
  pass "Log line found: $(echo "$LOG" | sed 's/.*Table GC:/Table GC:/' | sed 's/\x1b\[[0-9;]*m//g')"
else
  fail "No 'Table GC:' line in recent backend logs"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo
echo "────────────────────────────────────────"
printf "Results: %d passed, %d failed\n" "$PASS" "$FAIL"
if [[ $FAIL -eq 0 ]]; then echo "ALL TESTS PASSED ✓"; exit 0
else echo "SOME TESTS FAILED ✗"; exit 1; fi
