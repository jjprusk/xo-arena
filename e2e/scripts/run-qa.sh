#!/usr/bin/env bash
# Run a Playwright test with qa.env loaded. Passes all args through to `npx playwright test`.
#
# Usage:
#   ./scripts/run-qa.sh tournament-mixed --headed
#   ./scripts/run-qa.sh                              # runs all tests

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f qa.env ]]; then
  echo "qa.env not found — running scripts/setup-qa-users.sh first…"
  ./scripts/setup-qa-users.sh
fi

# Export vars from qa.env into this shell.
set -a
# shellcheck disable=SC1091
source ./qa.env
set +a

exec npx playwright test --project=chromium "$@"
