#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-3210}"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

IBKR_GATEWAY_URL="stub://ibkr-gateway" \
IBKR_ACCOUNT_ID="DU1234567" \
IBKR_API_TOKEN="stub-token" \
PORT="${PORT}" \
npm run dev >/tmp/tinyfish-remora-preflight.log 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 60); do
  if curl --silent --fail "http://127.0.0.1:${PORT}/api/runtime/ibkr/preflight?mode=paper" >/tmp/ibkr-preflight-response.json; then
    cat /tmp/ibkr-preflight-response.json
    exit 0
  fi
  sleep 1
done

echo "Failed to reach preflight endpoint; see /tmp/tinyfish-remora-preflight.log" >&2
exit 1
