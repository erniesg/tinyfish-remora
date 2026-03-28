# Codex Cloud Environment Baseline

This document defines the single recommended Codex Cloud environment for `tinyfish-remora`.

## Cloud runtime

- **Node.js**: `22.x`
- **Package manager**: npm (lockfile committed)
- **Agent internet access**: **Off** by default

## One-environment recommendation

Use one reusable Codex Cloud environment for the repo and add secrets only when the active task needs them.

### Non-secret environment variables

Set these once:

```bash
CI=1
NEXT_TELEMETRY_DISABLED=1
PORT=3000
```

### Setup script

```bash
set -euo pipefail
npm ci
if grep -q '"@playwright/test"' package.json; then
  npx playwright install --with-deps chromium
fi
```

### Maintenance script

```bash
set -euo pipefail
npm ci
if grep -q '"@playwright/test"' package.json; then
  npx playwright install --with-deps chromium
fi
```

The conditional Playwright install keeps the same environment usable before and after browser-test support lands on `main`.

## Optional integration variables

Only add these when a task needs them. They are not required for the current demo-only app flow.

### TinyFish and review services

- `TINYFISH_API_KEY`
- `TINYFISH_RUN_URL`
- `REVIEW_URL`
- `OPENAI_API_KEY`

### Auth and persistence

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### IBKR

- `TRADING_GATEWAY_SHARED_SECRET`
- `IBKR_GATEWAY_URL`
- `IBKR_ACCOUNT_ID`
- `IBKR_API_TOKEN`

### Polymarket

- `POLYMARKET_GATEWAY_URL`
- `POLYGON_PRIVATE_KEY`
- `POLY_API_KEY`
- `POLY_API_SECRET`
- `POLY_PASSPHRASE`
- `POLY_FUNDER_ADDRESS`
- `POLY_WALLET_ADDRESS`

## Local bootstrap

For local terminals, not Codex Cloud:

```bash
source ~/.nvm/nvm.sh
npm ci
```

If you keep runtime service secrets in `.dev.vars` for local workers, the app runtime will also read `.dev.vars` and `.dev.vars.local` from the repo root for server-only values.

## Required validation before opening a PR

```bash
source ~/.nvm/nvm.sh
npm ci
npm run lint
npm run build
```

If Playwright tests are present on the latest `main` for your target work, also run:

```bash
npx playwright test
```

## Secret handling

- Keep `.env.example` committed with variable names only.
- Put browser-visible local values in `.env.local`.
- Put worker-style server-only values in `.dev.vars` or `.dev.vars.local` when that matches your local setup.
- Do not commit raw credentials, tokens, or private operator notes.
