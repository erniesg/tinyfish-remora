import test from "node:test";
import assert from "node:assert/strict";
import { ClientPortalBroker } from "../../src/lib/purchases/broker";
import type { ClientPortalEvidence, ClientPortalTransport, Preflight } from "../../src/lib/purchases/broker";
import { catalog } from "../../src/lib/purchases/catalog";
import type { Purchase } from "../../src/lib/purchases/types";

const p: Purchase = { instrumentSnapshot: { ...catalog[0], evidence: "broker-verified" }, accountMode: "paper", id: "mandate", accountId: "test-paper", instrumentId: "aapl-nasdaq", trigger: "schedule", scheduledAt: "2026-06-15T14:00:00Z", expiresAt: "2026-06-15T20:00:00Z", timezone: "Asia/Singapore", session: "regular", shares: 2, limitPrice: 110, buffer: 5, maxSpend: 225, createdAt: "2026-06-15T13:00:00Z", state: "armed", cancellationPolicy: "cancel-remainder-at-expiry-or-session-end", reasons: [], receipts: [], executions: [], filledShares: 0, spent: 0, reserved: 225, intentId: "durable-intent", contract: { conid: 265598, currency: "USD", exchange: "NASDAQ", evidence: "broker-verified" } };
const f: Preflight = { validUntil: "2026-06-15T14:00:30Z", sessionOpensAt: "2026-06-15T13:30:00Z", sessionClosesAt: "2026-06-15T20:00:00Z", accountId: "test-paper", accountMode: "paper", currency: "USD", availableCash: 1000, cashSettled: true, authenticated: true, sessionReady: true, permitted: true, dataEntitled: true, quote: 100, quoteAt: "2026-06-15T14:00:00Z", quoteCurrency: "USD", calendarKnown: true, open: true, firstTrade: true, halted: false, closedForDay: false, reasons: [] };
const evidence: ClientPortalEvidence = { preflight: async () => f, executionAllowed: () => false };

test("actual adapter fails closed under execution holds and forbids fixtures even with injected test authority", async () => {
  let calls = 0;
  const transport: ClientPortalTransport = async () => { calls++; throw new Error("No network"); };
  await assert.rejects(new ClientPortalBroker(transport, "test-paper", "paper", evidence).submit(p, catalog[0]), /execution held/);
  await assert.rejects(new ClientPortalBroker(transport, "test-paper", "paper", { ...evidence, executionAllowed: () => true }).submit({ ...p, instrumentSnapshot: catalog[0] }, catalog[0]), /fixture routing forbidden/);
  assert.equal(calls, 0);
});
test("dependency-injected Client Portal adapter emits bounded limit order, never confirms warnings", async () => {
  const requests: { method: string; path: string; body: unknown }[] = [];
  const transport: ClientPortalTransport = async (method, path, body) => { requests.push({ method, path, body }); return [{ id: "warning-reply-id", message: ["Confirm order?"] }]; };
  const adapter = new ClientPortalBroker(transport, "test-paper", "paper", { ...evidence, executionAllowed: (mode, account) => mode === "paper" && account === "test-paper" }, () => new Date(f.quoteAt!));
  const result = await adapter.submit(p, { ...catalog[0], evidence: "broker-verified" }, f);
  assert.equal(result.state, "unknown");
  assert.deepEqual(requests, [{ method: "POST", path: "/iserver/account/test-paper/orders", body: { orders: [{ acctId: "test-paper", conid: 265598, cOID: "durable-intent", orderType: "LMT", side: "BUY", quantity: 2, price: 110, tif: "DAY", outsideRTH: false }] } }]);
});
test("Client Portal auth/session/account evidence checked and broker authority remains explicit", async () => {
  const transport: ClientPortalTransport = async (_method, path) => path === "/iserver/auth/status" ? { authenticated: false, connected: true, competing: true } : { accounts: ["different-account"] };
  const adapter = new ClientPortalBroker(transport, "test-paper", "paper", evidence);
  const result = await adapter.preflight(p, catalog[0], new Date(f.quoteAt!));
  assert.equal(result.authenticated, false); assert.equal(result.sessionReady, false);
  assert.match(result.reasons.join(" "), /authority is held/);
});
test("Client Portal order absence stays unknown and DELETE acknowledgement is not cancellation", async () => {
  const transport: ClientPortalTransport = async () => ({ orders: [] });
  const adapter = new ClientPortalBroker(transport, "test-paper", "paper", { ...evidence, executionAllowed: () => true });
  assert.equal(await adapter.reconcile(p), null);
  assert.equal(await adapter.cancel({ ...p, brokerOrderId: "123" }), null);
});
test("Client Portal partial execution has explicit fees certainty; acceptance is not fill", async () => {
  let row: Record<string, unknown> = { account: p.accountId, conid: 265598, side: "BUY", currency: "USD", orderId: 123, cOID: p.intentId, status: "Submitted", cum_fill: "0.0" };
  let trades: Record<string, unknown>[] = [];
  const transport: ClientPortalTransport = async (_method, path) => path.includes("/trades") ? trades : path.includes("/status/") ? row : ({ orders: [row] });
  const adapter = new ClientPortalBroker(transport, "test-paper", "paper", evidence);
  assert.equal((await adapter.reconcile(p))?.state, "submitted");
  assert.equal((await adapter.reconcile(p))?.filledShares, 0);
  row = { ...row, filledQuantity: 1, cum_fill: "1.0", avgPrice: "100" };
  trades = [{ execution_id: "fill-1", order_id: 123, account: p.accountId, conid: "265598", side: "B", order_ref: p.intentId, size: 1, price: "100", commission: "1" }];
  const order = await adapter.reconcile(p);
  assert.equal(order?.state, "partially-filled"); assert.equal(order?.spent, 101); assert.equal(order?.feesKnown, true);
});
