# Deployment and observability

This guide captures a deployable baseline for `tinyfish-remora` on current `main`.

## CI behavior

GitHub Actions workflow: `.github/workflows/ci.yml`

- Runs on pushes and pull requests targeting `main`.
- Executes:
  - `npm ci`
  - `npm run lint`
  - `npm run build`
- Detects whether `@playwright/test` exists and only runs Playwright when installed.

## Runtime and container profile

- `next.config.ts` sets `output: "standalone"`.
- Multi-stage `Dockerfile` builds and ships a minimal production runtime.
- `.dockerignore` excludes local secrets and development-only artifacts.

Build and run locally:

```bash
docker build -t tinyfish-remora .
docker run --rm -p 3000:3000 --env-file .env.local tinyfish-remora
```

## Health endpoint

Path: `GET /api/health`

Behavior:

- Returns `200` with `{ status: "ok" }` when required deploy env values are present.
- Returns `503` with `{ status: "degraded" }` and a `missingEnv` list when required values are absent.
- Emits `cache-control: no-store, max-age=0` for probe correctness.

## Structured logging

Path: `src/lib/observability/logger.ts`

- Emits newline-delimited JSON via `console.log`/`warn`/`error`.
- Supports `debug`, `info`, `warn`, and `error` levels.
- Uses `LOG_LEVEL` to filter lower-priority logs.

## Environment template

`.env.example` includes names only (no secret values), including:

- Core runtime: `CI`, `NEXT_TELEMETRY_DISABLED`, `PORT`, `LOG_LEVEL`
- TinyFish integration: `TINYFISH_RUN_URL`, `REVIEW_URL`, `TINYFISH_API_KEY`
- IBKR: `IBKR_GATEWAY_URL`, `IBKR_ACCOUNT_ID`, `IBKR_API_TOKEN`
- Polymarket/Polygon: `POLYGON_PRIVATE_KEY`, `POLY_API_KEY`, `POLY_API_SECRET`, `POLY_PASSPHRASE`, `POLY_FUNDER_ADDRESS`, `POLY_WALLET_ADDRESS`

## Current intentional production gaps

This baseline does not yet include:

- External metrics backend wiring and dashboards
- Alert policies/on-call routing
- Distributed tracing export
- Secret-manager integration and rotation automation
- Multi-region/high-availability deployment topology
