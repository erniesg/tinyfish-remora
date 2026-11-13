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
npm ci --ignore-scripts
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

## Automated share purchases — local simulation

Feature requirements: [#26](https://github.com/erniesg/tinyfish-remora/issues/26). Open **Buy shares** in the cockpit, or `/dashboard/purchases`. Preview and save a bounded mandate, then arm its local simulation. A standalone worker checks due purchases without a browser, persists intent before submission, and reconciles unknown outcomes rather than resubmitting. Saved status and order evidence come from the server, not browser storage.

In two terminals, use the **same absolute private store path**, outside the checkout:

```bash
export REMORA_PURCHASE_MODE=mock
export REMORA_PURCHASE_STORE="$HOME/.local/state/tinyfish-remora/purchases.json"
npm run dev -- --hostname 127.0.0.1
# Second terminal, with the same exports:
npm run purchases:worker
```

Mutations are loopback-only and disabled unless both variables are set. No purchase route connects to IBKR; paper/live activation is unavailable. All sample contracts, balances, calendars and fills are mocked. USD, SGD and GBP balances are separate: there is no borrowing or automatic conversion. Scheduled/opening/first-trade purchases use bounded regular-session limit orders, not guaranteed opening-auction fills. Unconfirmed listings stay blocked; first-tradability and unsupported combinations are explicit. Calendars include selected fixture holidays only, not authoritative exchange calendars.

The dashboard shows the last observed scheduling check; a recent heartbeat cannot guarantee future execution. Stop all purchases revokes mandates and requests cancellation, but never undoes fills. Resuming permits new mandates only. This is a single-host local runner, not a distributed live service. The local store uses exclusive locking and durable atomic writes. After a crashed process leaves a lock, stop all users of that store, preserve a copy, reconcile its intents, and only then remove a stale `.lock` directory; never delete the purchase database to retry an unknown order.

Validation (no broker credentials needed):

```bash
npm run test:purchases
npm run test:purchases:ui
npm run lint
npm run build
```

The isolated UI test starts its own app/store; stop another `next dev` in this checkout first. Install the Playwright Chromium runtime if absent, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an existing compatible executable. Backend tests cover delayed first trading, supported venues, stale quotes, holidays/DST, expiry/revocation, partial fills/halt/cancel, limits and restart recovery. These are deterministic mock/transport checks, **not actual IBKR paper or live proof**.

[IBKR capabilities and current official sources](docs/ibkr-purchase-capabilities.md) explain Singapore/account eligibility, daily interactive authentication, per-venue unknowns and separate manual IPO allocation. The dependency-injected Client Portal adapters and inactive server HTTP transport implement broker protocols. The purchase API/worker never construct that transport or route actual orders; HTTP failures never trigger blind retries. Listing identity, account permissions and real-time tradability require trusted evidence; absent evidence blocks execution. No funding, credentials/access, subscriptions, account changes, paid resources or deployment are authorised by this local workflow.

## Local configuration

The repo runs in demo mode without third-party credentials. When you want to wire live services, copy `.env.example` to `.env.local` and fill in values locally.

If you already keep local runtime service values in `.dev.vars` or `.dev.vars.local`, the server runtime reads those files too for non-browser secrets. Keep browser-exposed `NEXT_PUBLIC_*` values in `.env.local`.

- Clerk: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`
- Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- TinyFish: `TINYFISH_API_KEY`, `TINYFISH_RUN_URL`, `REVIEW_URL`, `OPENAI_API_KEY`
- Trading gateway auth: `REMORA_TRADING_SECRET`
- IBKR: `IBKR_GATEWAY_URL`, `IBKR_ACCOUNT_ID`, `IBKR_API_TOKEN`
- Polymarket: `POLYMARKET_GATEWAY_URL`, `POLYGON_PRIVATE_KEY`, `POLY_API_KEY`, `POLY_API_SECRET`, `POLY_PASSPHRASE`, `POLY_FUNDER_ADDRESS`, `POLY_WALLET_ADDRESS`

## Runtime integration mode

The dashboard now checks `/api/runtime/status` on load.

- `demo`: everything runs through the local timeline engine.
- `hybrid`: one or more of TinyFish, review, IBKR, or Polymarket is env-backed and the rest still fall back locally.
- `live`: all four provider seams are env-backed.

These env-backed URLs are first-party adapter endpoints, not raw third-party browser credentials:

- `TINYFISH_RUN_URL` accepts a TinyFish `skill` payload and can return collected raw signals plus an optional `streamingUrl`.
- `REVIEW_URL` accepts batched `signals` plus review constraints and can return `reviewedSignals`.
- `IBKR_GATEWAY_URL` accepts an execution intent and can return a receipt and optional position.
- `POLYMARKET_GATEWAY_URL` accepts an execution intent and can return a receipt and optional position.

Use these local-only files:

- `.env.local` for real credentials and secrets
- `.dev.vars` or `.dev.vars.local` for local runtime service secrets when you already keep worker-style local vars there
- `AGENT_PRIVATE.local.md` for local operator instructions, account mappings, and private demo notes

Neither file should be committed.

## Contributor operations

For Codex Cloud setup and parallel agent workflow guidance, use:

- `docs/codex-cloud-environment.md`
- `docs/codex-parallel-worktrees.md`
