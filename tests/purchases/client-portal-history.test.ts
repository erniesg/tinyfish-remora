import test from "node:test";
import assert from "node:assert/strict";
import { ClientPortalBroker } from "../../src/lib/purchases/broker";
import type { ClientPortalEvidence, ClientPortalTransport } from "../../src/lib/purchases/broker";
import { catalog } from "../../src/lib/purchases/catalog";
import type { Purchase } from "../../src/lib/purchases/types";

const p: Purchase = { instrumentSnapshot: { ...catalog[0], id: "ibkr-265598-NASDAQ", evidence: "broker-verified" }, accountMode: "paper", id: "mandate", accountId: "DU-OFFLINE", instrumentId: "ibkr-265598-NASDAQ", trigger: "schedule", scheduledAt: "2026-06-15T14:00:00Z", expiresAt: "2026-06-15T20:00:00Z", timezone: "Asia/Singapore", session: "regular", shares: 2, limitPrice: 110, buffer: 5, maxSpend: 225, createdAt: "2026-06-15T13:00:00Z", state: "reconciliation-required", cancellationPolicy: "cancel-remainder-at-expiry-or-session-end", reasons: [], receipts: [], executions: [], filledShares: 0, spent: 0, reserved: 225, intentId: "offline-intent", contract: { conid: 265598, currency: "USD", exchange: "NASDAQ", evidence: "broker-verified" } };
const evidence: ClientPortalEvidence = { executionAllowed: () => false, preflight: async () => { throw new Error("not used"); } };
// Official endpoint shapes, adapted ONLY in account/reference/side and test size.
// Trade history omits currency; exact status binds currency to account/conid/ID.
const trade = { execution_id: "0000e0d5.6576fd38.01.01", symbol: "AAPL", side: "B", trade_time: "20260615-14:00:49", trade_time_r: 1781532049000, size: 2, price: "100.25", order_ref: p.intentId, exchange: "ISLAND", commission: "1.01", net_amount: 200.5, account: p.accountId, accountCode: p.accountId, sec_type: "STK", listing_exchange: "NASDAQ.NMS", conid: "265598", conidEx: "265598", order_id: 17437897932 };
const status = { account: p.accountId, average_price: "100.25", conid: 265598, cum_fill: "2.0", currency: "USD", order_id: 17437897932, order_status: "Filled", side: "BUY", total_size: "2.0" };
function fixture(changes: { trades?: unknown; status?: unknown; orders?: unknown; failStatus?: boolean } = {}) {
  const calls: string[] = [];
  const transport: ClientPortalTransport = async (method, path) => {
    assert.equal(method, "GET"); calls.push(path);
    if (path === `/iserver/account/orders?force=true&accountId=${p.accountId}`) return { orders: changes.orders ?? [] };
    if (path === "/iserver/account/trades?days=7") return changes.trades ?? [trade];
    if (path === "/iserver/account/order/status/17437897932") { if (changes.failStatus) throw new Error("official prior-session 503"); return changes.status ?? status; }
    throw new Error(`Unexpected offline path: ${path}`);
  };
  return { adapter: new ClientPortalBroker(transport, p.accountId, "paper", evidence), calls };
}
test("completed order absent from live list is discovered by cOID trade history; official string prices, quantities and commission map exactly", async () => {
  const { adapter, calls } = fixture(); const result = await adapter.reconcile(p);
  assert.equal(result?.state, "filled"); assert.equal(result?.filledShares, 2); assert.equal(result?.spent, 201.51); assert.equal(result?.feesKnown, true);
  assert.deepEqual(result?.executions, [{ id: trade.execution_id, quantity: 2, price: 100.25, fee: 1.01, currency: "USD" }]);
  assert.deepEqual(calls, [`/iserver/account/orders?force=true&accountId=${p.accountId}`, "/iserver/account/trades?days=7", "/iserver/account/order/status/17437897932"]);
});
test("execution duplicates deduplicate; conflicts and aggregate averages never create fill evidence", async () => {
  assert.equal((await fixture({ trades: [trade, trade] }).adapter.reconcile(p))?.spent, 201.51);
  assert.equal(await fixture({ trades: [trade, { ...trade, price: "100.50" }] }).adapter.reconcile(p), null);
  const missing = await fixture({ trades: [], orders: [{ ...status, order_ref: p.intentId, avgPrice: "100.25", totalFees: 1.01 }] }).adapter.reconcile(p);
  assert.equal(missing?.feesKnown, false); assert.equal(missing?.executions.length, 0);
});
test("missing/invalid commission or missing execution coverage cannot fabricate fee certainty", async () => {
  for (const commission of [undefined, null, "", "NaN", "--"]) {
    const result = await fixture({ trades: [{ ...trade, commission }] }).adapter.reconcile(p);
    assert.equal(result?.feesKnown, false, String(commission)); assert.equal(result?.executions[0].fee, null);
  }
  assert.equal((await fixture({ trades: [{ ...trade, size: 1 }] }).adapter.reconcile(p))?.feesKnown, false);
  assert.equal(await fixture({ status: { ...status, cum_fill: "NaN" } }).adapter.reconcile(p), null);
  await assert.rejects(fixture({ failStatus: true }).adapter.reconcile(p), /503/); // Service retains reservation on unavailable evidence.
});
test("exact identity rejects every absent/conflicting account, conid, BUY, currency, order or reference field", async () => {
  for (const change of [
    { account: "OTHER" }, { account: undefined }, { conid: 999 }, { conid: undefined },
    { side: "SELL" }, { side: undefined }, { currency: "SGD" }, { currency: undefined },
    { order_id: 999 }, { order_ref: "wrong" }, { cOID: "wrong" },
  ]) assert.equal(await fixture({ status: { ...status, ...change } }).adapter.reconcile(p), null, JSON.stringify(change));
  for (const change of [
    { account: "OTHER" }, { accountCode: "OTHER" }, { conid: "999" }, { side: "S" },
    { currency: "SGD" }, { order_ref: "wrong" }, { cOID: "wrong" }, { order_id: 999 },
  ]) assert.equal(await fixture({ trades: [{ ...trade, ...change }] }).adapter.reconcile({ ...p, brokerOrderId: String(trade.order_id) }), null, JSON.stringify(change));
  assert.equal(await fixture().adapter.reconcile({ ...p, accountId: "OTHER" }), null);
  assert.equal(await fixture({ trades: [trade, { ...trade, execution_id: "conflicting-reference", order_ref: "wrong" }] }).adapter.reconcile(p), null);
  assert.equal(await fixture({ orders: [{ ...status, order_ref: "wrong", account: "OTHER", side: "SELL" }] }).adapter.reconcile(p), null);
});
test("official live order cashCcy and string avgPrice shapes work without relying on totalFees", async () => {
  const live = { acct: p.accountId, account: p.accountId, conid: 265598, orderId: trade.order_id, cashCcy: "USD", filledQuantity: 2, remainingQuantity: 0, status: "Filled", avgPrice: "100.25", order_ref: p.intentId, side: "BUY" };
  assert.equal((await fixture({ orders: [live] }).adapter.reconcile(p))?.spent, 201.51);
  assert.equal((await fixture({ orders: [live], failStatus: true }).adapter.reconcile(p))?.spent, 201.51);
  assert.equal(await fixture({ orders: [live, live] }).adapter.reconcile(p), null);
  assert.equal(await fixture({ orders: [{ ...live, currency: "GBP" }] }).adapter.reconcile(p), null);
});
