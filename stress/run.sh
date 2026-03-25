#!/usr/bin/env bash
# Run all stress scenarios sequentially against BASE_URL (default: local dev)
# Usage:
#   ./stress/run.sh
#   BASE_URL=https://your-backend.railway.app ./stress/run.sh
#   AUTH_TOKEN=xxx ML_MODEL_IDS=id1,id2 ./stress/run.sh

set -e

BASE_URL="${BASE_URL:-http://localhost:3000}"
export BASE_URL

PASS=0
FAIL=0

run_scenario() {
  local name="$1"
  local file="$2"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Running: $name"
  echo "  Target:  $BASE_URL"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  if k6 run "$file"; then
    PASS=$((PASS + 1))
    echo "  ✓ PASSED: $name"
  else
    FAIL=$((FAIL + 1))
    echo "  ✗ FAILED: $name"
  fi
}

run_scenario "Public Read Endpoints"  stress/scenarios/api-read.js
run_scenario "AI Move Requests"       stress/scenarios/ai-moves.js
run_scenario "ML Model Export"        stress/scenarios/ml-export.js
run_scenario "Auth Sync Burst"        stress/scenarios/auth-sync.js
run_scenario "WebSocket PvP"          stress/scenarios/websocket-pvp.js

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Results: $PASS passed, $FAIL failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

[ "$FAIL" -eq 0 ]
