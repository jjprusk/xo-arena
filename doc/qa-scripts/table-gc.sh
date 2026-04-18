#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Table GC QA — manual test suite for the background GC service (Section 7)
#
# Usage:
#   ./doc/qa-scripts/table-gc.sh <admin-bearer-token>
#
# What it tests:
#   1. FORMING tables with empty seats older than 30 min are auto-deleted
#   2. COMPLETED tables older than 24 hr are auto-deleted
#   3. ACTIVE tables idle past the configured threshold are marked COMPLETED
#   4. Tournament FORMING tables are NOT auto-deleted
#   5. Sweep log line appears in backend logs when rows are affected
#
# Requirements:
#   - Docker Compose stack is running (postgres + backend)
#   - ADMIN_TOKEN passed as $1 (copy from browser DevTools → Network → any
#     /api/v1/admin/* request → Authorization header, strip "Bearer ")
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

ADMIN_TOKEN="${1:-}"
if [[ -z "$ADMIN_TOKEN" ]]; then
  echo "Usage: $0 <admin-bearer-token>"
  exit 1
fi

API="http://localhost:3000/api/v1"
DB="postgresql://xo:xo@localhost:5432/xo_arena"
PASS=0
FAIL=0

# ── Helpers ───────────────────────────────────────────────────────────────────

psql_exec() { psql "$DB" -t -A -c "$1" 2>/dev/null; }

run_sweep() {
  curl -s -X POST "$API/admin/gc/run" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json"
}

assert_eq() {
  local label="$1" got="$2" want="$3"
  if [[ "$got" == "$want" ]]; then
    echo "  ✓ $label"
    ((PASS++))
  else
    echo "  ✗ $label  (got '$got', want '$want')"
    ((FAIL++))
  fi
}

assert_ne() {
  local label="$1" got="$2" notwant="$3"
  if [[ "$got" != "$notwant" ]]; then
    echo "  ✓ $label"
    ((PASS++))
  else
    echo "  ✗ $label  (expected not '$notwant', but got it)"
    ((FAIL++))
  fi
}

# Clean up any leftover QA rows from a previous aborted run
cleanup() {
  psql_exec "DELETE FROM tables WHERE \"displayName\" LIKE 'QA-GC-%'" > /dev/null 2>&1 || true
}
trap cleanup EXIT

# ── Test 1: Stale FORMING table (empty seats, >30 min old) ───────────────────
echo
echo "Test 1: Stale FORMING table is deleted"
cleanup

# Insert a FORMING table backdated 31 minutes, no occupied seats
TABLE_ID=$(psql_exec "
  INSERT INTO tables (id, status, \"gameId\", seats, \"previewState\", \"displayName\", \"createdAt\", \"updatedAt\")
  VALUES (
    gen_random_uuid()::text,
    'FORMING',
    'xo',
    '[{\"status\":\"open\"},{\"status\":\"open\"}]'::jsonb,
    '{}'::jsonb,
    'QA-GC-forming-stale',
    NOW() - INTERVAL '31 minutes',
    NOW() - INTERVAL '31 minutes'
  )
  RETURNING id;
")

assert_ne "Row inserted" "$TABLE_ID" ""

run_sweep > /dev/null
STILL_EXISTS=$(psql_exec "SELECT COUNT(*) FROM tables WHERE id = '$TABLE_ID'")
assert_eq "Stale FORMING table deleted" "$STILL_EXISTS" "0"

# ── Test 2: Old COMPLETED table (>24 hr) ─────────────────────────────────────
echo
echo "Test 2: Old COMPLETED table is deleted"

TABLE_ID=$(psql_exec "
  INSERT INTO tables (id, status, \"gameId\", seats, \"previewState\", \"displayName\", \"createdAt\", \"updatedAt\")
  VALUES (
    gen_random_uuid()::text,
    'COMPLETED',
    'xo',
    '[]'::jsonb,
    '{}'::jsonb,
    'QA-GC-completed-old',
    NOW() - INTERVAL '25 hours',
    NOW() - INTERVAL '25 hours'
  )
  RETURNING id;
")

assert_ne "Row inserted" "$TABLE_ID" ""

run_sweep > /dev/null
STILL_EXISTS=$(psql_exec "SELECT COUNT(*) FROM tables WHERE id = '$TABLE_ID'")
assert_eq "Old COMPLETED table deleted" "$STILL_EXISTS" "0"

# ── Test 3: Idle ACTIVE table → COMPLETED ────────────────────────────────────
echo
echo "Test 3: Idle ACTIVE table is marked COMPLETED"

# Default idle threshold = 120s warn + 60s grace = 180s. Backdate by 4 minutes.
TABLE_ID=$(psql_exec "
  INSERT INTO tables (id, status, \"gameId\", seats, \"previewState\", \"displayName\", \"createdAt\", \"updatedAt\")
  VALUES (
    gen_random_uuid()::text,
    'ACTIVE',
    'xo',
    '[{\"status\":\"occupied\",\"userId\":\"qa-user-1\"},{\"status\":\"occupied\",\"userId\":\"qa-user-2\"}]'::jsonb,
    '{\"board\":[null,null,null,null,null,null,null,null,null]}'::jsonb,
    'QA-GC-active-idle',
    NOW() - INTERVAL '10 minutes',
    NOW() - INTERVAL '4 minutes'
  )
  RETURNING id;
")

assert_ne "Row inserted" "$TABLE_ID" ""

run_sweep > /dev/null
NEW_STATUS=$(psql_exec "SELECT status FROM tables WHERE id = '$TABLE_ID'")
assert_eq "Idle ACTIVE → COMPLETED" "$NEW_STATUS" "COMPLETED"

# Clean up this row (it won't be auto-deleted because it's only seconds old as COMPLETED)
psql_exec "DELETE FROM tables WHERE id = '$TABLE_ID'" > /dev/null

# ── Test 4: Tournament FORMING table is NOT deleted ───────────────────────────
echo
echo "Test 4: Tournament FORMING table is NOT deleted"

# We don't need a real tournamentId FK — tournamentId is just a String? field
TABLE_ID=$(psql_exec "
  INSERT INTO tables (id, status, \"gameId\", seats, \"previewState\", \"displayName\", \"tournamentId\", \"createdAt\", \"updatedAt\")
  VALUES (
    gen_random_uuid()::text,
    'FORMING',
    'xo',
    '[{\"status\":\"open\"},{\"status\":\"open\"}]'::jsonb,
    '{}'::jsonb,
    'QA-GC-tournament-forming',
    'qa-fake-tournament-id',
    NOW() - INTERVAL '31 minutes',
    NOW() - INTERVAL '31 minutes'
  )
  RETURNING id;
")

assert_ne "Row inserted" "$TABLE_ID" ""

run_sweep > /dev/null
STILL_EXISTS=$(psql_exec "SELECT COUNT(*) FROM tables WHERE id = '$TABLE_ID'")
assert_eq "Tournament FORMING table preserved" "$STILL_EXISTS" "1"

# Clean up
psql_exec "DELETE FROM tables WHERE id = '$TABLE_ID'" > /dev/null

# ── Test 5: Sweep log line appears when rows are affected ─────────────────────
echo
echo "Test 5: Backend logs the GC summary line"

# Seed a stale FORMING table so the sweep has something to report
psql_exec "
  INSERT INTO tables (id, status, \"gameId\", seats, \"previewState\", \"displayName\", \"createdAt\", \"updatedAt\")
  VALUES (
    gen_random_uuid()::text,
    'FORMING',
    'xo',
    '[{\"status\":\"open\"},{\"status\":\"open\"}]'::jsonb,
    '{}'::jsonb,
    'QA-GC-log-check',
    NOW() - INTERVAL '31 minutes',
    NOW() - INTERVAL '31 minutes'
  );
" > /dev/null

RESULT=$(run_sweep)
DELETED=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('deletedForming',0))" 2>/dev/null || echo "0")

# Check the log
LOG_LINE=$(docker compose logs backend --tail=30 2>/dev/null | grep "Table GC:" | tail -1)
if [[ -n "$LOG_LINE" ]]; then
  echo "  ✓ GC log line found: $LOG_LINE"
  ((PASS++))
else
  echo "  ✗ No 'Table GC:' log line found in recent backend output"
  ((FAIL++))
fi

assert_ne "Sweep returned deletedForming > 0" "$DELETED" "0"

# ── Summary ───────────────────────────────────────────────────────────────────
echo
echo "────────────────────────────────────────"
echo "Results: $PASS passed, $FAIL failed"
if [[ $FAIL -eq 0 ]]; then
  echo "ALL TESTS PASSED ✓"
  exit 0
else
  echo "SOME TESTS FAILED ✗"
  exit 1
fi
