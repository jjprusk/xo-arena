#!/usr/bin/env bash
# Copyright © 2026 Joe Pruskowski. All rights reserved.
#
# Re-baseline the full XO Arena perf suite against a target env in one shot.
# Each script writes its own JSON to perf/baselines/<kind>-<env>-<timestamp>.json;
# this wrapper just calls them in sequence and prints a one-line summary at the end.
#
# Usage:
#   perf/perf-rebaseline.sh local
#   perf/perf-rebaseline.sh staging
#   perf/perf-rebaseline.sh prod
#   perf/perf-rebaseline.sh staging --skip=longtasks,inp     # cherry-pick
#   perf/perf-rebaseline.sh staging --only=bundle,backend-p95
#
# The kind labels match the filename prefix each script emits:
#   bundle, backend-p95, sse-rtt, waterfall, longtasks, perf (v2), inp
#
# Notes:
#   - bundle is local-only (measures the dist/ build) — same output regardless
#     of TARGET. Run it once per release; rerunning for staging vs prod is a
#     no-op since both are built from the same dev branch tip.
#   - Playwright-based scripts (sse-rtt, waterfall, longtasks, perf, inp)
#     need `npx playwright install chromium` to have completed at least once.
#   - Each script runs sequentially. Total wall-clock against staging is
#     ~6–10 minutes depending on cold-start / network.

set -uo pipefail

TARGET="${1:-}"
shift || true

if [[ -z "$TARGET" || "$TARGET" == "-h" || "$TARGET" == "--help" ]]; then
  sed -n '5,28p' "$0"
  exit 1
fi
case "$TARGET" in
  local|staging|prod) ;;
  *) echo "error: TARGET must be one of: local, staging, prod (got: $TARGET)" >&2; exit 1 ;;
esac

# Optional --skip / --only filters.
SKIP=""
ONLY=""
for arg in "$@"; do
  case "$arg" in
    --skip=*)  SKIP="${arg#--skip=}" ;;
    --only=*)  ONLY="${arg#--only=}" ;;
    *) echo "warn: ignoring unknown arg $arg" >&2 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Each row: <kind> <script-path> <extra-args>
# kind matches the baseline filename prefix the script emits, so --skip / --only
# can be specified using the same labels users see in the dashboard.
SCRIPTS=(
  "bundle|perf/perf-bundle.js|"
  "backend-p95|perf/perf-backend-p95.js|--target=$TARGET"
  "sse-rtt|perf/perf-sse-rtt.js|--target=$TARGET"
  "waterfall|perf/perf-waterfall.js|--target=$TARGET"
  "longtasks|perf/perf-longtasks.js|--target=$TARGET"
  "perf|perf/perf-v2.js|--target=$TARGET"
  "inp|perf/perf-inp.js|--target=$TARGET"
)

contains() {
  # contains LIST ITEM — comma-separated LIST.
  [[ ",$1," == *",$2,"* ]]
}

START_TS=$(date +%s)
SUCCEEDED=()
FAILED=()
SKIPPED=()

echo "▶ Re-baseline against $TARGET — $(date '+%Y-%m-%d %H:%M:%S')"
echo

for entry in "${SCRIPTS[@]}"; do
  IFS='|' read -r kind script extra <<< "$entry"

  if [[ -n "$ONLY" ]] && ! contains "$ONLY" "$kind"; then
    SKIPPED+=("$kind")
    continue
  fi
  if [[ -n "$SKIP" ]] && contains "$SKIP" "$kind"; then
    SKIPPED+=("$kind")
    continue
  fi

  echo "── $kind ──"
  echo "$ node $script $extra"
  if [[ -n "$extra" ]]; then
    node "$script" $extra
  else
    node "$script"
  fi
  rc=$?
  if [[ $rc -eq 0 ]]; then
    SUCCEEDED+=("$kind")
  else
    FAILED+=("$kind (exit $rc)")
  fi
  echo
done

DUR=$(( $(date +%s) - START_TS ))

echo "════════════════════════════════════════════════════════════════"
printf "  Re-baseline against %-8s done in %ds\n" "$TARGET" "$DUR"
echo "════════════════════════════════════════════════════════════════"
printf "  ✓ ok      (%d): %s\n" "${#SUCCEEDED[@]}" "${SUCCEEDED[*]:-—}"
if [[ ${#SKIPPED[@]} -gt 0 ]]; then
  printf "  ↷ skipped (%d): %s\n" "${#SKIPPED[@]}" "${SKIPPED[*]}"
fi
if [[ ${#FAILED[@]} -gt 0 ]]; then
  printf "  ✗ failed  (%d): %s\n" "${#FAILED[@]}" "${FAILED[*]}"
  exit 1
fi
echo
echo "Latest baselines (browse in admin Health → Perf Baselines):"
ls -1t perf/baselines/*-${TARGET}-*.json 2>/dev/null | head -10
