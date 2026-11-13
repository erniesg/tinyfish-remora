import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ClientPortalBroker } from "../../src/lib/purchases/broker";
import { ClientPortalReadonlyEvidence, resolveClientPortalContract } from "../../src/lib/purchases/client-portal-evidence";
import type { VerifiedListing, VerifiedTradingState } from "../../src/lib/purchases/client-portal-evidence";
import { createClientPortalTransport } from "../../src/lib/purchases/http-transport";
import { PurchaseService } from "../../src/lib/purchases/service";
import type { PurchaseContext } from "../../src/lib/purchases/service";
import { PurchaseStore } from "../../src/lib/purchases/store";
import type { MandateInput } from "../../src/lib/purchases/types";

const now = new Date("2026-06-15T14:00:00Z");
const proof: VerifiedListing = { issuer: "Offline Issuer", symbol: "OFF", conid: 123, exchange: "NYSE", currency: "USD", shareClass: "Class A", timezone: "America/New_York", source: "offline-test-listing-proof", observedAt: "2026-06-15T13:59:00Z", validUntil: "2026-06-15T15:00:00Z" };
const accountId = "TEST-OFFLINE-ONLY";
const input: MandateInput = { instrumentId: "ibkr-123-NYSE", accountId, trigger: "schedule", scheduledAt: now.toISOString(), expiresAt: "2026-06-15T20:00:00Z", timezone: "Asia/Singapore", session: "regular", shares: 2, limitPrice: 110, maxSpend: 225, buffer: 5 };
async function setup(t: { after(fn: () => Promise<void>): void }) {
  const root = path.join(os.homedir(), ".local/state/rucksack/scratch/remora-purchase-tests");
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(path.join(root, "integration-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new PurchaseStore(path.join(dir, "db.json"));
  let intent = "", filled = 0, lostResponse = false, submissions = 0, authority = true;
  let auth = true, settled = 1000;
  let state: VerifiedTradingState | null = { ...proof, accountId, permitted: true, halted: false, firstTrade: true, venueOrderSupported: true, quantitySupported: true, priceUnitVerified: true, feeBound: 5 };
  const requests: string[] = [];
  const transport = createClientPortalTransport({ baseUrl: "https://offline.invalid/v1/api", fetch: async (url, init) => {
    // The only transport is this injected function: no real network fallback.
    const u = new URL(String(url)); const endpoint = u.pathname.replace("/v1/api", "");
    requests.push(`${init?.method} ${endpoint}`);
    let response: unknown;
    if (endpoint === "/iserver/auth/status") response = { authenticated: auth, connected: true, competing: false };
    else if (endpoint === "/iserver/accounts") response = { accounts: [accountId] };
    else if (endpoint === "/iserver/secdef/search") response = [{ conid: 123, symbol: "OFF", sections: [{ secType: "STK" }] }];
    else if (endpoint === "/iserver/secdef/info") response = { conid: 123, ticker: "OFF", secType: "STK", listingExchange: "NYSE", currency: "USD" };
    else if (endpoint === `/portfolio/${accountId}/ledger`) response = { USD: { currency: "USD", settledcash: settled, cashbalance: 1000 } };
    else if (endpoint === "/iserver/marketdata/snapshot") response = [{ conid: 123, "31": "100", "84": "99", "86": "100", "6509": "RpB", _updated: now.getTime() }];
    else if (endpoint === "/contract/trading-schedule") response = { exchange_time_zone: proof.timezone, schedules: { "20260615": { liquid_hours: [{ opening: Date.parse("2026-06-15T13:30:00Z") / 1000, closing: Date.parse("2026-06-15T20:00:00Z") / 1000 }] } } };
    else if (endpoint === `/iserver/account/${accountId}/orders` && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      intent = body.orders[0].cOID; submissions++;
      assert.deepEqual(body.orders[0], { acctId: accountId, conid: 123, cOID: intent, orderType: "LMT", side: "BUY", quantity: 2, price: 110, tif: "DAY", outsideRTH: false });
      const durable = (await store.load()).purchases.find(p => p.intentId === intent)!;
      assert.equal(durable.instrumentSnapshot.shareClass, proof.shareClass);
      assert.equal(durable.accountMode, "paper");
      if (lostResponse) throw new Error("Lost offline response after acceptance");
      response = [{ order_id: "321" }];
    } else if (endpoint === "/iserver/account/orders") {
      assert.equal(u.searchParams.get("accountId"), accountId);
      response = { orders: intent ? [{ account: accountId, conid: 123, side: "BUY", currency: "USD", orderId: 321, cOID: intent }] : [] };
    } else if (endpoint === "/iserver/account/trades") response = filled ? [{ execution_id: "offline-fill-1", account: accountId, conid: "123", side: "B", order_id: 321, order_ref: intent, size: filled, price: "100", commission: "1" }] : [];
    else if (endpoint === "/iserver/account/order/status/321") response = { account: accountId, conid: 123, side: "BUY", currency: "USD", order_id: 321, order_ref: intent, order_status: filled === 2 ? "Filled" : "Submitted", cum_fill: String(filled) };
    else throw new Error(`Unexpected offline endpoint: ${endpoint}`);
    return new Response(JSON.stringify(response), { status: 200 });
  } });
  const resolution = await resolveClientPortalContract(transport, proof.issuer, proof, now);
  assert.equal(resolution.status, "resolved");
  if (resolution.status !== "resolved") throw new Error("Offline contract did not resolve");
  const context: PurchaseContext = { catalog: [resolution.instrument], account: { id: accountId, mode: "paper", currency: "USD", availableCash: 1000, cashBalances: { USD: 1000 }, authenticated: true, sessionReady: true, permissions: ["NYSE:STK"], dataEntitled: true, reasons: ["Injected offline test account only"] } };
  const readonly = new ClientPortalReadonlyEvidence(transport, accountId, { accountMode: "paper", listing: async () => proof, tradingState: async () => state });
  const service = (current = context) => new PurchaseService(store, () => new ClientPortalBroker(transport, accountId, "paper", {
    preflight: (p, i, at) => readonly.preflight(p, i, at),
    // TEST authority only. Public API/worker never constructs this broker/context.
    executionAllowed: (mode, id) => authority && mode === "paper" && id === accountId,
  }, () => now), () => now, current);
  return { store, context, service, requests, count: () => submissions,
    fill: (quantity: number) => { filled = quantity; }, lose: () => { lostResponse = true; },
    hold: () => { authority = false; }, auth: (v: boolean) => { auth = v; }, cash: (v: number) => { settled = v; },
    state: (v: Partial<VerifiedTradingState>) => { state = { ...state!, ...v }; },
  };
}

test("same durable service resolves exact contract, arms once, persists unknown intent, restarts and confirms transport-backed fill", async t => {
  const h = await setup(t), s = h.service();
  assert.equal(s.preview(input).supported, true);
  const draft = await s.create(input);
  assert.deepEqual(draft.instrumentSnapshot, h.context.catalog[0]);
  assert.equal((await s.action(draft.id, "arm")).state, "armed");
  h.lose();
  const [unknown] = await s.tick();
  assert.equal(unknown.state, "reconciliation-required"); assert.equal(unknown.reserved, 225);
  assert.equal(h.count(), 1);
  h.fill(2);
  const [complete] = await h.service().tick();
  assert.equal(complete.state, "filled"); assert.equal(complete.spent, 201);
  assert.equal(complete.executions[0].fee, 1); assert.equal(complete.reserved, 0);
  assert.equal(complete.intentId, unknown.intentId);
  await h.service().tick(); assert.equal(h.count(), 1);
  assert.equal((await h.store.load()).purchases[0].state, "filled");
});

test("deployment listing/account-mode changes cannot retarget an armed mandate; existing intent still reconciles frozen contract", async t => {
  for (const delta of [{ conid: 999 }, { exchange: "OTHER" }, { currency: "SGD" }, { shareClass: "Class B" }, { issuer: "Other Issuer" }, { symbol: "OTHER" }]) {
    const h = await setup(t), s = h.service(); const p = await s.create(input); await s.action(p.id, "arm");
    const changed = structuredClone(h.context); Object.assign(changed.catalog[0], delta);
    const [blocked] = await h.service(changed).tick();
    assert.equal(blocked.state, "blocked"); assert.match(blocked.reasons.join(" "), /Frozen/);
    assert.deepEqual(blocked.instrumentSnapshot, h.context.catalog[0]); assert.equal(blocked.reserved, 225); assert.equal(h.count(), 0);
    assert.equal((await h.service(changed).action(p.id, "arm")).state, "blocked");
  }
  const h = await setup(t), s = h.service(); const p = await s.create(input); await s.action(p.id, "arm");
  const mode = structuredClone(h.context); mode.account.mode = "live";
  assert.equal((await h.service(mode).tick())[0].state, "blocked"); assert.equal(h.count(), 0);
  await s.action(p.id, "arm"); h.lose(); await s.tick(); h.fill(2);
  const missing = structuredClone(h.context); missing.catalog = [];
  assert.equal((await h.service(missing).tick())[0].state, "filled"); assert.equal(h.count(), 1);
});

test("context copies cannot be mutated through preview/dashboard and unconfirmed issuer cannot inherit later verified listing authority", async t => {
  const h = await setup(t), s = h.service();
  s.preview(input).instrument!.conid = 999;
  const dashboard = await s.dashboard(true); dashboard.catalog[0].issuer = "Changed"; dashboard.account.mode = "live";
  const p = await s.create(input);
  assert.equal(p.instrumentSnapshot.conid, 123); assert.equal(p.instrumentSnapshot.issuer, proof.issuer); assert.equal(p.accountMode, "paper");
  const unconfirmed = structuredClone(h.context);
  unconfirmed.catalog[0] = { ...unconfirmed.catalog[0], issuer: "Anthropic", conid: null, symbol: null, listing: "unconfirmed", supportedTriggers: [], reasons: ["Unconfirmed listing"] };
  const held = h.service(unconfirmed), draft = await held.create(input);
  assert.equal((await held.action(draft.id, "arm")).state, "waiting-for-listing");
  const verified = structuredClone(h.context); verified.catalog[0].issuer = "Anthropic";
  assert.equal((await h.service(verified).action(draft.id, "arm")).state, "blocked");
  await h.service(verified).tick(); assert.equal(h.count(), 0);
});

test("real preflight holds missing critical constraints, fee bound, settled cash, authentication and authority independently", async t => {
  const cases: ((h: Awaited<ReturnType<typeof setup>>) => void)[] = [
    h => h.state({ venueOrderSupported: undefined }), h => h.state({ quantitySupported: undefined }),
    h => h.state({ priceUnitVerified: undefined }), h => h.state({ feeBound: null }),
    h => h.state({ feeBound: 6 }), h => h.state({ feeBound: -1 }),
    h => h.state({ permitted: false }), h => h.state({ validUntil: now.toISOString() }),
    h => h.cash(-1), h => h.auth(false), h => h.hold(),
  ];
  for (const change of cases) {
    const h = await setup(t), s = h.service(); const p = await s.create(input); await s.action(p.id, "arm"); change(h);
    const [blocked] = await s.tick(); assert.equal(blocked.state, "blocked"); assert.ok(blocked.reasons.length); assert.equal(h.count(), 0); assert.equal(blocked.reserved, 225);
  }
});

test("snapshot schema rejects missing/invalid identity, mode, and contract conflicts without consulting mutable catalog", async t => {
  const h = await setup(t), s = h.service(); const p = await s.create(input); await s.action(p.id, "arm"); await s.tick();
  const original = await readFile(h.store.filename, "utf8");
  const corruptions: ((p: Record<string, unknown>) => void)[] = [
    p => { delete p.instrumentSnapshot; }, p => { p.instrumentSnapshot = null; },
    p => { delete p.accountMode; }, p => { p.accountMode = "unknown"; },
    ...["id", "issuer", "symbol", "conid", "exchange", "currency", "shareClass", "timezone", "evidence", "listing", "supportedTriggers", "reasons"].map(key => (p: Record<string, unknown>) => { delete (p.instrumentSnapshot as Record<string, unknown>)[key]; }),
    p => { (p.instrumentSnapshot as Record<string, unknown>).conid = 999; },
    p => { (p.instrumentSnapshot as Record<string, unknown>).currency = "SGD"; },
    p => { (p.instrumentSnapshot as Record<string, unknown>).timezone = "invalid-zone"; },
  ];
  for (const mutate of corruptions) {
    const db = JSON.parse(original); mutate(db.purchases[0]); const damaged = JSON.stringify(db); await writeFile(h.store.filename, damaged);
    await assert.rejects(h.store.load(), /recovery required/); await assert.rejects(s.tick(), /recovery required/);
    assert.equal(await readFile(h.store.filename, "utf8"), damaged);
  }
});

test("injected balances reserve independently by frozen currency; extra USD cannot cover SGD and catalog remapping cannot net reservations", async t => {
  const h = await setup(t);
  const context = structuredClone(h.context);
  context.account.cashBalances = { USD: 1000, SGD: 225 };
  context.account.permissions.push("SGX:STK");
  context.catalog.push({ ...context.catalog[0], id: "sgd-listing", conid: 456, exchange: "SGX", currency: "SGD", timezone: "Asia/Singapore" });
  const s = h.service(context);
  const usd = await s.create(input); assert.equal((await s.action(usd.id, "arm")).state, "armed");
  const sgd = await s.create({ ...input, instrumentId: "sgd-listing" }); assert.equal((await s.action(sgd.id, "arm")).state, "armed");
  const competing = await s.create({ ...input, instrumentId: "sgd-listing" }); assert.equal((await s.action(competing.id, "arm")).state, "blocked");
  const remapped = structuredClone(context); remapped.catalog[1].currency = "USD";
  // Existing SGD reservation must still consume SGD even when its ID's new mapping says USD.
  remapped.catalog.push({ ...context.catalog[1], id: "sgd-other", conid: 789 });
  const restarted = h.service(remapped), other = await restarted.create({ ...input, instrumentId: "sgd-other" });
  assert.equal((await restarted.action(other.id, "arm")).state, "blocked");
  assert.equal((await h.store.load()).purchases.find(p => p.id === sgd.id)!.instrumentSnapshot.currency, "SGD");
});
