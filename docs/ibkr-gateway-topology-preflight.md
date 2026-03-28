# IBKR Gateway + Proxy Contract (Safe Preflight)

This document defines the IBKR connectivity contract for `tinyfish-remora` cloud and remote execution.

## Scope

- Server-side connectivity checks only.
- No live order placement.
- No account mutation.
- Compatibility-first contract for a future IBKR execution adapter.

## Required environment variables

- `IBKR_GATEWAY_URL`: Base URL for the IBKR gateway or proxy.
- `IBKR_ACCOUNT_ID`: Account identifier expected by the app (for example, `DU...` paper account).
- `IBKR_API_TOKEN`: Bearer token used by server-side calls (required for live preflight, recommended for paper).

## Topology (cloud-safe)

`tinyfish-remora` should call a **server-side IBKR gateway or proxy**, never a desktop-local TWS session directly from the browser.

Recommended deployment path:

1. User/browser interacts with `tinyfish-remora` API routes.
2. App server calls `IBKR_GATEWAY_URL` over HTTPS.
3. Gateway/proxy holds IBKR session details and maps upstream responses into a stable JSON contract.
4. Preflight route verifies connectivity and account visibility without submitting orders.

This keeps broker credentials and network trust boundaries server-only.

## Gateway health contract

`tinyfish-remora` preflight expects a health endpoint at:

- `GET {IBKR_GATEWAY_URL}/health`

Request headers sent by the app:

- `Authorization: Bearer <IBKR_API_TOKEN>` when token is configured.
- `x-ibkr-account-id: <IBKR_ACCOUNT_ID>`.

Expected JSON shape from the gateway/proxy:

```json
{
  "accountIds": ["DU1234567"],
  "capabilities": {
    "readOnly": true,
    "supportsPreflight": true,
    "supportsOrderPreview": true
  }
}
```

Behavior notes:

- `accountIds` should include the configured `IBKR_ACCOUNT_ID`.
- `readOnly` should remain `true` for preflight-only gateway modes.
- `supportsPreflight` / `supportsOrderPreview` indicate safe pre-execution capabilities.

## New server preflight route

Route:

- `GET /api/runtime/ibkr/preflight?mode=paper|live`

Returns:

- Gateway reachability and HTTP status.
- Whether configured account is present in the gateway health response.
- Preflight capabilities and warnings.
- Missing configuration fields if setup is incomplete.

Status codes:

- `200` when preflight checks pass.
- `400` when required environment is missing.
- `502` when gateway is unreachable or fails checks.

## Safe local stub mode

Set `IBKR_GATEWAY_URL` to a stub URL to validate the full preflight flow without real IBKR connectivity:

- `stub://ibkr-gateway`
- `mock://ibkr-gateway`

In stub mode, the preflight route returns synthetic health/account data and confirms that no execution path is used.

## Validation command (stub)

```bash
scripts/validate-ibkr-preflight-stub.sh
```

This command:

- boots `next dev` with stub IBKR env vars,
- calls `/api/runtime/ibkr/preflight?mode=paper`,
- prints the JSON response,
- and exits non-zero if the preflight route cannot be reached.

## What still requires a real IBKR environment

- Verifying real gateway TLS/network reachability from deployed cloud environments.
- Confirming the production account list returned by the actual gateway/proxy.
- Validating live-specific controls (`mode=live`) and token policy against production auth.
- Any future execution adapter behavior (preview/submit/fill lifecycle).
