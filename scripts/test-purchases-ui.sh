#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
root="${RUCKSACK_SCRATCH_ROOT:-$HOME/.local/state/rucksack/scratch}/remora-purchase-checks"
mkdir -p "$root"
fixture="$(mktemp -d "$root/ui.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT
export REMORA_PURCHASE_MODE=mock
export REMORA_PURCHASE_STORE="$fixture/purchases.json"
export PORT="${PORT:-3107}"
export PLAYWRIGHT_BASE_URL="http://127.0.0.1:$PORT"
# Never reuse an unrelated app/store for this isolated stateful check.
CI=1 ./node_modules/.bin/playwright test tests/purchases-ui.spec.ts --workers=1 --retries=0
