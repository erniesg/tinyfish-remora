#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
root="${RUCKSACK_SCRATCH_ROOT:-$HOME/.local/state/rucksack/scratch}/remora-purchase-checks"
mkdir -p "$root"
build="$(mktemp -d "$root/build.XXXXXX")"
trap 'rm -rf "$build"' EXIT
./node_modules/.bin/tsc --outDir "$build" --target ES2022 --module commonjs --moduleResolution node --esModuleInterop --skipLibCheck --strict src/lib/purchases/*.ts scripts/purchase-worker.ts tests/purchases/*.ts
mode="${1:-test}"
shift || true
case "$mode" in
  test) node --test "$build"/tests/purchases/*.js ;;
  worker) node "$build/scripts/purchase-worker.js" "$@" ;;
  *) echo 'Usage: bash scripts/purchases.sh [test|worker [--once]]' >&2; exit 1 ;;
esac
