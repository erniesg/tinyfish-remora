# tinyfish-remora

`tinyfish-remora` is a standalone demo for an automated trading platform built around:

- predefined TinyFish signal recipes
- autonomous strategy generation and saving
- IBKR paper/live controls
- Polymarket paper/live controls
- live event streaming, receipts, positions, and P&L

## What ships now

- Next.js App Router demo with a cinematic landing page
- local demo auth flow so the repo runs immediately
- strategy studio that generates a structured trading strategy
- venue connection forms with readiness checks
- TinyFish-style streaming run timeline over SSE
- paper/live promotion controls and live-updating demo P&L

## Product model

- Recipes collect market-relevant source data.
- Strategies turn recipe outputs into saved, versioned playbooks.
- Runs stream operator-visible events from collection through execution.
- The cockpit keeps signals, decisions, receipts, positions, and P&L in one surface.

## Run locally

1. Load Node through `nvm`:

```bash
source ~/.nvm/nvm.sh
```

2. Install dependencies:

```bash
npm ci
```

3. Start the app:

```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000).

## Demo flow

1. Open `/auth` and create a demo user.
2. Visit `/dashboard`.
3. Review the seeded IBKR paper and Polymarket paper connections.
4. Launch the parallel recipe fanout.
5. Watch the event ledger stream `STARTED`, `STREAMING_URL`, `PROGRESS`, `SIGNAL`, `REVIEW`, `DECISION`, `RECEIPT`, and `COMPLETE`.
6. Generate a new strategy from the studio, save it, and run a paper preview.
7. Toggle a saved strategy from paper to live to show the promotion gate.

## Local configuration

The repo runs in demo mode without third-party credentials. When you want to wire live services, copy `.env.example` to `.env.local` and fill in values locally.

- Clerk: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`
- Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- TinyFish: `TINYFISH_API_KEY`, `TINYFISH_RUN_URL`, `REVIEW_URL`, `OPENAI_API_KEY`
- IBKR: `IBKR_GATEWAY_URL`, `IBKR_ACCOUNT_ID`, `IBKR_API_TOKEN`
- Polymarket: `POLYGON_PRIVATE_KEY`, `POLY_API_KEY`, `POLY_API_SECRET`, `POLY_PASSPHRASE`, `POLY_FUNDER_ADDRESS`, `POLY_WALLET_ADDRESS`
- Compatibility aliases: `POLYMARKET_API_KEY`, `POLYMARKET_API_SECRET`, `POLYMARKET_PASSPHRASE`

Use these local-only files:

- `.env.local` for real credentials and secrets
- `AGENT_PRIVATE.local.md` for local operator instructions, account mappings, and private demo notes

Neither file should be committed.

## Contributor operations

For Codex Cloud setup and parallel agent workflow guidance, use:

- `docs/codex-cloud-environment.md`
- `docs/codex-parallel-worktrees.md`
