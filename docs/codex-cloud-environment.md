# Codex Cloud Environment Baseline

This document defines the default Codex Cloud runtime for `tinyfish-remora`.

## Runtime

- **Node.js**: `22.13.1` (or the nearest available Node 22 runtime in Codex Cloud)
- **Package manager**: npm (lockfile committed)
- **Setup script**: `npm ci`
- **Maintenance script**: `npm ci`

## Network posture

- **Default internet access during agent phase**: **Off**
- If a task requires external access, enable the smallest domain allowlist that unblocks the task.
- Prefer safe read methods (documentation lookups, metadata fetches) over write operations.

## Standard repository bootstrap

Run from the repository root:

```bash
source ~/.nvm/nvm.sh
npm ci
```

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
- Put local values in `.env.local` only.
- Do not commit raw credentials, tokens, or private operator notes.
